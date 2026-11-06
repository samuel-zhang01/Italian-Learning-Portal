"""Add private, portable navigation to verified study exports; originals stay intact.

Uses internal GoTo annotations (https://pymupdf.readthedocs.io/en/latest/page.html).
Navigation is appended so physical source page numbers and portal offsets survive.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import fcntl
from html import escape
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

import pymupdf as fitz
import export_book_pdfs as base

GENERATOR = 'link_book_pdfs.py'
VERSION = 1
DEST = base.EXPORTS / 'linked'
ROWS = 22
FOOTER = 28
GREEN = (0.08, 0.32, 0.25)


def lesson_number(title):
    match = re.search(r'\blezione[\s-]+(10|[1-9])\b', title, re.I)
    return int(match[1]) if match else None


class MediaLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in {'href', 'src'} and value:
                parsed = urlsplit(value)
                if not parsed.scheme and not parsed.netloc and parsed.path.endswith('.pdf'):
                    self.paths.add(unquote(parsed.path))


class Sources:
    """Derive lesson associations from verified manifests and actual HTML links."""
    def __init__(self, manifest, printed):
        self.verifier = base.Exporter()
        self.records = {item['path']: item for item in manifest['outputs']}
        self.records.update({item['path']: item for item in printed['books']})
        self.books = manifest['books']
        self.book_ids = [book['bookId'] for book in self.books]
        self.native = {}
        self.media_lessons = defaultdict(set)
        self.cache = {}
        self.evidence = []
        for book in self.books:
            book_id = book['bookId']
            root = base.BOOKS / book_id
            path = root / 'manifest.json'
            proof = next(item for item in manifest['sourceManifests'] if item['path'] == path.relative_to(base.ROOT).as_posix())
            self.verifier.verify(proof, root)
            self.evidence.append(proof)
            native = base.read_json(path, root)
            self.native[book_id] = native['canonicalNativeBook']['sectionOffsets']
            printed_book = next(item for item in printed['books'] if item['bookId'] == book_id)
            for activity in printed_book['activities']:
                html = activity['html']
                html_path = root / html['path']
                proof = {**html, 'path': html_path.relative_to(base.ROOT).as_posix()}
                self.verifier.verify(proof, root)
                parser = MediaLinks()
                parser.feed(html_path.read_text(encoding='utf8'))
                lesson = lesson_number(activity['section'])
                for relative in parser.paths:
                    target = (html_path.parent / relative).resolve()
                    base.private(target, root)
                    if lesson:
                        self.media_lessons[target.relative_to(base.ROOT).as_posix()].add(lesson)

    def book_for(self, path):
        return next((book for book in self.book_ids if book in path), None)

    def contexts(self, item, trail=()):
        """One (book, lessons) tuple per physical page, including shared resources."""
        path = item['path']
        if path in self.cache:
            return self.cache[path]
        if path in trail:
            raise ValueError('CyclicExportOffsets')
        book = self.book_for(path)
        contexts = [(book, ()) for _ in range(item['pages'])]

        def assign(start, end, values):
            if not 1 <= start <= end <= len(contexts) or len(values) != end - start + 1:
                raise ValueError('InvalidNavigationSourceRange')
            contexts[start - 1:end] = values

        if item.get('category') == 'byte-exact-student-book':
            for section in self.native[book]:
                lesson = lesson_number(section['section'])
                assign(section['start_page'], section['end_page'], [(book, (lesson,) if lesson else ())] * section['pages'])
        elif 'activities' in item:
            for activity in item['activities']:
                lesson = lesson_number(activity['section'])
                assign(activity['startPage'], activity['endPage'], [(book, (lesson,) if lesson else ())] * activity['pages'])
        else:
            for offset in item.get('offsets', []):
                child = self.records.get(offset['source'])
                if child:
                    if child['sha256'] != offset['sourceSHA256']:
                        raise ValueError('NavigationOffsetChecksumMismatch')
                    values = self.contexts(child, (*trail, path))
                else:
                    lessons = self.media_lessons.get(offset['source'], set())
                    # Native video sections and caption sidecars have explicit
                    # lesson names; transcript filenames are never interpreted.
                    if not lessons and '/interactive/media/' not in offset['source']:
                        lesson = lesson_number(offset['source'])
                        lessons = {lesson} if lesson else set()
                    values = [(book, tuple(sorted(lessons)))] * offset['pages']
                assign(offset['startPage'], offset['endPage'], values)
        self.cache[path] = contexts
        return contexts


def entries_from_toc(toc, contexts):
    entries, parents = [], []
    for index, (level, title, page) in enumerate(toc):
        if not 1 <= page <= len(contexts) or level < 1 or level > len(parents) + 1:
            raise ValueError('InvalidNavigationOutline')
        parents = parents[:level - 1]
        book, lessons = contexts[page - 1]
        # A grouping heading shares its first child's start page, but must not
        # inherit that child's lesson (e.g. all transcripts are not Lesson 1).
        has_children = index + 1 < len(toc) and toc[index + 1][0] > level
        if has_children and lesson_number(title) is None:
            lessons = ()
        entries.append({'title': title, 'detail': ' / '.join(parents[-2:]),
                        'target': page - 1, 'book': book, 'lessons': lessons})
        parents.append(title)
    return entries


def navigation_plan(toc, contexts, title):
    entries = entries_from_toc(toc, contexts)
    groups = defaultdict(list)
    for entry in entries:
        for lesson in entry['lessons']:
            groups[(entry['book'], lesson)].append(entry)
    home = [{'title': 'Start reading / Inizia a leggere', 'detail': title, 'target': 0},
            {'title': 'All sections / Tutte le sezioni', 'detail': 'Clickable full contents', 'target': None}]
    for entry in entries:
        if not entry['detail']:
            home.append({**entry, 'detail': 'Section / Sezione'})
    hubs = {}
    for book, lesson in sorted(groups):
        label = f"Plus {book.rsplit('-', 1)[-1]} · Lezione {lesson}"
        hubs[(book, lesson)] = {'title': label, 'rows': groups[(book, lesson)]}
        home.append({'title': label, 'detail': 'Book, exercises and available lesson resources', 'target': None, 'hub': (book, lesson)})
    menus = [{'title': 'Study navigation / Indice', 'rows': home}, *hubs.values(),
             {'title': 'All sections / Tutte le sezioni', 'rows': entries}]
    next_page = len(contexts)
    for menu in menus:
        menu['start'] = next_page
        menu['count'] = max(1, math.ceil(len(menu['rows']) / ROWS))
        next_page += menu['count']
    home[1]['target'] = menus[-1]['start']
    for row in home:
        if 'hub' in row:
            row['target'] = hubs[row['hub']]['start']
    return menus, {key: value['start'] for key, value in hubs.items()}


def fit_text(text, width, size, font):
    if font.text_length(text, fontsize=size) <= width:
        return text
    while text and font.text_length(text + '…', fontsize=size) > width:
        text = text[:-1]
    return text + '…'


def text(page, point, value, size=10, color=GREEN):
    page.insert_font(fontname='NavSans', fontfile=str(base.FONT))
    page.insert_text(point, value, fontname='NavSans', fontsize=size, color=color)


def button(page, rect, label, target, size=9):
    page.draw_rect(rect, color=None, fill=(0.92, 0.96, 0.94))
    text(page, (rect.x0 + 7, rect.y0 + rect.height / 2 + size / 3), label, size)
    page.insert_link({'kind': fitz.LINK_GOTO, 'from': rect, 'page': target, 'to': fitz.Point(0, 0)})


def add_navigation(document, contexts, title):
    original_toc = document.get_toc()
    menus, hubs = navigation_plan(original_toc, contexts, title)
    first = len(contexts)
    font = fitz.Font(fontfile=str(base.FONT))
    for menu in menus:
        for _ in range(menu['count']):
            document.new_page(width=595, height=842)
    for number, (book, lessons) in enumerate(contexts):
        page = document[number]
        box = page.mediabox
        if page.rotation or page.cropbox != box or box.x0 or box.y0 or box.width < 400:
            raise ValueError('UnsupportedNavigationPageGeometry')
        # Lower the PDF bottom boundary, leaving the original top and content
        # coordinates unchanged. Navigation occupies new paper below the source.
        page.set_mediabox(fitz.Rect(0, -FOOTER, box.width, box.height))
        button(page, fitz.Rect(12, box.height + 4, 136, box.height + 24), 'Contents / Indice', first)
        if len(lessons) == 1 and (book, lessons[0]) in hubs:
            label = f'Lezione {lessons[0]} · Resources'
            button(page, fitz.Rect(144, box.height + 4, 294, box.height + 24), label, hubs[(book, lessons[0])])
        text(page, (box.width - 96, box.height + 18), f'PDF {number + 1}', 8)
    for menu in menus:
        for index in range(menu['count']):
            page = document[menu['start'] + index]
            text(page, (36, 42), fit_text(menu['title'], 523, 19, font), 19)
            text(page, (36, 64), fit_text(title, 523, 9, font), 9)
            text(page, (36, 84), 'Tap a row to jump. Contents and lesson resources are below each source page.', 8)
            rows = menu['rows'][index * ROWS:(index + 1) * ROWS]
            for position, row in enumerate(rows):
                y = 106 + position * 30
                rect = fitz.Rect(36, y, 559, y + 28)
                page.draw_rect(rect, color=None, fill=(0.94, 0.97, 0.95) if position % 2 == 0 else (1, 1, 1))
                text(page, (43, y + 11), fit_text(row['title'], 450, 9, font), 9)
                text(page, (43, y + 23), fit_text(row.get('detail', ''), 450, 7, font), 7, (0.35, 0.40, 0.37))
                text(page, (510, y + 16), str(row['target'] + 1), 9)
                page.insert_link({'kind': fitz.LINK_GOTO, 'from': rect, 'page': row['target'], 'to': fitz.Point(0, 0)})
            button(page, fitz.Rect(36, 784, 172, 810), 'Contents / Indice', first)
            if index:
                button(page, fitz.Rect(185, 784, 315, 810), 'Previous / Indietro', page.number - 1)
            if index + 1 < menu['count']:
                button(page, fitz.Rect(328, 784, 458, 810), 'Next / Avanti', page.number + 1)
            text(page, (36, 829), f'{index + 1} / {menu["count"]} · Source PDF page numbers are unchanged. Navigation is appended.', 8)
    nav_toc = [[1, 'Study navigation / Indice', first + 1]]
    nav_toc += [[2, menu['title'], menu['start'] + 1] for menu in menus[1:]]
    document.set_toc(nav_toc + original_toc)
    document.set_pagemode('UseOutlines')
    return {'contentsPage': first + 1, 'navigationPages': document.page_count - first,
            'lessonMenus': len(hubs), 'contentsEntries': len(original_toc)}


def validate(document):
    base.pdf_safety(document)
    count = 0
    for page in document:
        for link in page.get_links():
            if link['kind'] != fitz.LINK_GOTO or not 0 <= link.get('page', -1) < document.page_count:
                raise ValueError('OnlyValidInternalNavigationAllowed')
            if link['from'].is_empty or not page.rect.contains(link['from']):
                raise ValueError('NavigationHitAreaOutsidePage')
            count += 1
    return count


def build(source, target, contexts, title):
    base.private(source, base.EXPORTS)
    with fitz.open(source) as original, fitz.open() as document:
        if original.page_count != len(contexts):
            raise ValueError('NavigationContextPageMismatch')
        document.insert_pdf(original, links=False, annots=False, widgets=False)
        document.set_toc(original.get_toc())
        # Scrub BEFORE adding the new, explicitly internal navigation.
        document.scrub(attached_files=True, embedded_files=True, javascript=True,
                       metadata=True, redactions=False, hidden_text=False, clean_pages=False,
                       remove_links=True, reset_fields=True, reset_responses=True,
                       thumbnails=True, xml_metadata=True)
        details = add_navigation(document, contexts, title)
        document.set_metadata({'title': title + ' · Linked edition', 'author': 'Private study archive',
                               'creator': GENERATOR, 'subject': 'Internal study navigation; original physical page numbers retained.'})
        with base.temporary_output(target) as temporary:
            document.save(temporary, garbage=3, deflate=True, no_new_id=True)
            with fitz.open(temporary) as saved:
                details['internalLinks'] = validate(saved)
                if saved.page_count != document.page_count:
                    raise ValueError('NavigationSavePageMismatch')
        return base.record(target, pages=document.page_count, sourcePages=original.page_count, **details)


def write_index(outputs):
    rows = []
    for item in outputs:
        name = Path(item['path']).name
        rows.append(f'<tr><td><a href="{escape(name)}#page={item["contentsPage"]}">{escape(name.removesuffix(".pdf"))}</a></td>'
                    f'<td>{item["sourcePages"]} + {item["navigationPages"]}</td><td>{item["internalLinks"]:,}</td></tr>')
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Linked study PDFs</title><style>body{font:17px/1.6 system-ui;max-width:1100px;margin:3rem auto;padding:0 1rem;background:#faf8f0;color:#20382e}a{color:#165d47}td,th{padding:.7rem;text-align:left;border-bottom:1px solid #ddd}table{width:100%;border-collapse:collapse}td:first-child{overflow-wrap:anywhere}</style>
<h1>Linked study PDFs</h1><p>Open a PDF at its clickable contents. Use <b>Contents / Indice</b> below any page, or <b>Lezione · Resources</b> to switch between material for that lesson.</p>
<p>Navigation stays inside each PDF and works offline. Existing source page numbers are unchanged; menus are appended and controls sit in an added bottom margin. The sidebar also starts with Study navigation / Indice.</p>
<p>Lesson menus use verified section metadata and actual resource links in the captured activities. Shared transcripts can appear in several lesson menus. Guides, solutions and resources without a verified lesson association remain in All sections. Audio/video binaries remain in the private archive.</p>
<table><thead><tr><th>Linked PDF</th><th>Source + navigation pages</th><th>Links</th></tr></thead><tbody>'''
    html += ''.join(rows) + '</tbody></table><p><a href="../index.html">Original exports</a> · <a href="navigation-manifest.json">Navigation evidence</a></p><p>These editions are private and Git-ignored. The original PDF/caption ZIP is unchanged and does not include these linked copies.</p></html>\n'
    with base.temporary_output(DEST / 'index.html') as temporary:
        temporary.write_text(html, encoding='utf8')


def update_catalogue(outputs, previous):
    path = base.ROOT / 'app/learning/pdf-bundles.json'
    catalogue = json.loads(path.read_text())
    old_hashes = {item['sha256'] for item in previous.get('outputs', [])}
    existing = {item['sha256']: item for item in catalogue}
    canonical = {spec['sha256']: {'sourceId': 'src-' + spec['sha256'][:12],
                                 'sha256': spec['sha256'], 'pages': spec['main'], 'offset': 0}
                 for spec in base.SPECS.values()}
    additions = []
    for item in outputs:
        source_hash = item['source']['sha256']
        mapping = existing.get(source_hash)
        sources = mapping['sources'] if mapping else [canonical[source_hash]] if source_hash in canonical else []
        if sources:
            additions.append({'sha256': item['sha256'], 'pages': item['pages'], 'sources': sources})
    catalogue = [item for item in catalogue if item['sha256'] not in old_hashes | {x['sha256'] for x in additions}]
    catalogue += additions
    if len(catalogue) > 32:
        raise ValueError('PortalBundleLimitExceeded')
    path.write_text(json.dumps(catalogue, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--update-catalogue', action='store_true', help='Also register the linked files with the local-PDF portal catalogue')
    args = parser.parse_args()
    os.umask(0o077)
    base.private(DEST, base.EXPORTS)
    DEST.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (base.EXPORTS / '.pdf-export.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(args)


def run(args):
    export_path = base.EXPORTS / 'export-manifest.json'
    print_path = base.EXPORTS / 'interactive-print-manifest.json'
    manifest = base.read_json(export_path, base.EXPORTS)
    printed = base.read_json(print_path, base.EXPORTS)
    if manifest.get('generator') != base.GENERATOR or manifest.get('status') != 'complete-accessible-pdf-exports':
        raise ValueError('CompleteVerifiedExportsRequired')
    verifier = base.Exporter()
    proof = next(item for item in manifest['sourceManifests'] if item['path'] == print_path.relative_to(base.ROOT).as_posix())
    verifier.verify(proof, base.EXPORTS)
    sources = Sources(manifest, printed)
    previous_path = DEST / 'navigation-manifest.json'
    previous = base.read_json(previous_path, DEST) if previous_path.exists() else {}
    if previous and previous.get('generator') != GENERATOR:
        raise ValueError('ManualNavigationManifestPreserved')
    prior = {item['source']['path']: item for item in previous.get('outputs', [])}
    items = [item for item in sources.records.values() if item['path'].endswith('.pdf')]
    evidence = [base.record(export_path), base.record(print_path), *sources.evidence]
    outputs = []
    import hashlib
    for item in items:
        source = verifier.verify(item, base.EXPORTS)
        contexts = sources.contexts(item)
        key = hashlib.sha256(json.dumps({'version': VERSION, 'source': item['sha256'], 'contexts': contexts}, sort_keys=True).encode()).hexdigest()
        target = DEST / source.name
        base.private(target, DEST)
        old = prior.get(item['path'])
        if old and old.get('buildKey') == key and target.is_file() and base.digest(target) == old['sha256']:
            result = old
        else:
            if target.exists() and not old:
                raise ValueError('UnmanagedLinkedPDFPreserved')
            if target.exists() and base.digest(target) != old['sha256']:
                raise ValueError('ModifiedLinkedPDFPreserved')
            title = source.stem.replace('nuovo-espresso-plus-', 'Plus ').replace('-', ' ')
            result = build(source, target, contexts, title)
            result.update(source={key: item[key] for key in ['path', 'sha256', 'bytes', 'pages']}, buildKey=key)
        outputs.append(result)
        # Retain evidence for completed files if a long build is interrupted.
        pending = [old for path, old in prior.items() if path not in {value['source']['path'] for value in outputs}]
        base.write_json(previous_path, {'generator': GENERATOR, 'version': VERSION,
                                       'status': 'building', 'outputs': outputs + pending})
        print(json.dumps({'file': source.name, 'links': result['internalLinks'], 'lessonMenus': result['lessonMenus'], 'navigationPages': result['navigationPages']}), flush=True)
    for item in [*evidence, *verifier.inputs.values(), *sources.verifier.inputs.values()]:
        if base.digest(base.ROOT / item['path']) != item['sha256']:
            raise ValueError('NavigationInputChanged')
    write_index(outputs)
    # Refresh generated indexes, then record their manifest's final hash.
    manifest['indexes'] = base.write_readme(manifest, (base.EXPORTS / 'italian-study-pdf-export-kit.zip').exists())
    base.write_json(export_path, manifest)
    evidence[0] = base.record(export_path)
    report = {'generator': GENERATOR, 'version': VERSION, 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'status': 'complete',
              'inputs': evidence, 'outputs': outputs, 'sourceFilesUnchanged': True,
              'linkType': 'internal-GoTo-only', 'sourcePageNumbersUnchanged': True,
              'mediaLinks': 'Lesson transcript associations come from verified captured HTML links; no filename guessing.'}
    if args.update_catalogue:
        update_catalogue(outputs, previous)
    base.write_json(previous_path, report)
    audit = {key: value for key, value in report.items() if key not in {'inputs', 'outputs'}}
    audit['outputs'] = [{key: item[key] for key in ['path', 'sha256', 'pages', 'sourcePages', 'contentsPage', 'navigationPages', 'lessonMenus', 'internalLinks']} for item in outputs]
    (base.ROOT / 'docs/pdf-navigation-audit.json').write_text(json.dumps(audit, indent=2) + '\n')


if __name__ == '__main__':
    main()

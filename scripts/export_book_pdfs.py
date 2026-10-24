"""Build private, verified study PDF exports without modifying source files."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
from html import escape
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit
import zipfile

import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / 'materials' / 'books'
EXPORTS = BOOKS / 'exports'
GENERATOR = 'export_book_pdfs.py'
FONT = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
SPECS = {
    'nuovo-espresso-plus-1': {'main': 240, 'reference': 416, 'transcriptPDFs': 103, 'guide': 117, 'solutions': 39, 'sha256': '1647be2784c9c94c554074a6d4cae04c0ac234edf30c0f2f73df3ca871ccebbf'},
    'nuovo-espresso-plus-2': {'main': 263, 'reference': 535, 'transcriptPDFs': 301, 'guide': 166, 'solutions': 86, 'sha256': '580f7558db569cd21b352abd1dcea29b012fb43098ebedd5746a3910e3b784c4'},
}


def private(path: Path, base: Path):
    if not path.is_relative_to(base) or path.resolve() != path:
        raise ValueError('PrivateNonSymlinkPathRequired')
    return path


def digest(path: Path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def record(path: Path, **extra):
    return {'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path), **extra}


def read_json(path: Path, base: Path):
    private(path, base)
    if not path.is_file() or path.stat().st_size > 50 * 1024 * 1024:
        raise ValueError('BoundedManifestRequired')
    return json.loads(path.read_text(encoding='utf8'))


def ignored(path: Path):
    private(path, EXPORTS)
    if subprocess.run(['git', 'check-ignore', '--quiet', str(path)], cwd=ROOT, check=False).returncode:
        raise ValueError('ExportMustRemainGitIgnored')


@contextmanager
def temporary_output(path: Path):
    ignored(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.stem[:50] + '-', suffix=path.suffix, dir=path.parent)
    os.close(fd)
    temporary = Path(temporary)
    try:
        yield temporary
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path: Path, value):
    with temporary_output(path) as temporary:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def natural(value):
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r'(\d+)', value)]


def pdf_safety(document):
    """New exports carry only page content and internal bookmarks."""
    if document.embfile_count():
        raise ValueError('UnexpectedEmbeddedFiles')
    for xref in range(1, document.xref_length()):
        try:
            keys = set(document.xref_get_keys(xref))
        except RuntimeError:
            continue
        if keys & {'JS', 'JavaScript', 'OpenAction', 'AA', 'RichMediaContent', 'RichMediaSettings', 'EmbeddedFiles', 'EF', 'AF'}:
            raise ValueError('ActivePDFObjectRejected')
        if document.xref_get_key(xref, 'S') in [('name', '/Launch'), ('name', '/SubmitForm'), ('name', '/GoToR'), ('name', '/JavaScript')]:
            raise ValueError('ActivePDFActionRejected')


def save_pdf(document, path: Path, title: str):
    document.scrub(attached_files=True, embedded_files=True, javascript=True, metadata=True,
                   redactions=False, hidden_text=False, clean_pages=False, remove_links=True,
                   reset_fields=True, reset_responses=True, thumbnails=True, xml_metadata=True)
    document.set_metadata({'title': title, 'author': 'Private study archive', 'creator': GENERATOR,
                           'subject': 'Private accessible-source study export. PLUS 2 has 263 accessible main-book pages; publisher page 264 is unavailable and not inferred.'})
    pdf_safety(document)
    with temporary_output(path) as temporary:
        document.save(temporary, garbage=3, deflate=True, no_new_id=True)
        with fitz.open(temporary) as saved:
            if saved.page_count != document.page_count:
                raise ValueError('SavedPDFPageCountMismatch')
            pdf_safety(saved)


class Exporter:
    def __init__(self):
        self.inputs = {}
        self.outputs = []
        self.caption_sources = []
        self.previous = {}
        previous = EXPORTS / 'export-manifest.json'
        if previous.exists():
            value = read_json(previous, EXPORTS)
            if value.get('generator') != GENERATOR:
                raise ValueError('ExistingManualExportManifestPreserved')
            self.previous = {item['path']: item for item in value.get('outputs', [])}

    def verify(self, item, base: Path):
        path = private(ROOT / item['path'], base)
        key = item['path']
        if key not in self.inputs:
            if not path.is_file() or path.stat().st_size > 4 * 1024**3:
                raise ValueError('BoundedVerifiedInputRequired')
            found = record(path)
            if found['sha256'] != item['sha256'] or found['bytes'] != item['bytes']:
                raise ValueError('InputChecksumMismatch')
            self.inputs[key] = {**found, 'mtimeNS': path.stat().st_mtime_ns}
        found = self.inputs[key]
        if found['sha256'] != item['sha256'] or found['bytes'] != item['bytes']:
            raise ValueError('ConflictingInputEvidence')
        return path

    def pdf(self, item, base: Path):
        path = self.verify(item, base)
        with fitz.open(path) as document:
            if document.needs_pass or not document.is_pdf:
                raise ValueError('OrdinaryVerifiedPDFRequired')
            pages = document.page_count
        if item.get('pages') is not None and item['pages'] != pages:
            raise ValueError('InputPDFPageCountMismatch')
        return {**item, 'pages': pages}

    def cached(self, name, payload):
        path = EXPORTS / name
        key = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        previous = self.previous.get(path.relative_to(ROOT).as_posix())
        if previous and previous.get('buildKey') == key and path.is_file():
            private(path, EXPORTS)
            if path.stat().st_size == previous['bytes'] and digest(path) == previous['sha256']:
                self.outputs.append(previous)
                return previous, key
        return None, key

    def copied(self, source, name, category, base: Path):
        path = self.verify(source, base)
        cached, key = self.cached(name, {'method': 'byte-exact-copy-v1', 'source': source})
        if cached:
            return cached
        target = EXPORTS / name
        with temporary_output(target) as temporary:
            shutil.copyfile(path, temporary)
            if digest(temporary) != source['sha256']:
                raise ValueError('ByteExactCopyFailed')
        output = record(target, category=category, buildKey=key, inputs=[source], byteExact=True)
        if source.get('pages') is not None:
            output['pages'] = source['pages']
        self.outputs.append(output)
        return output

    def assembled(self, name, title, groups, expected=None, category='assembled-pdf'):
        payload = {'method': 'page-preserving-bookmarked-assembly-v1', 'groups': groups, 'title': title}
        cached, key = self.cached(name, payload)
        if cached:
            return cached
        output = fitz.open()
        toc, offsets, inputs = [], [], []
        try:
            for group in groups:
                group_start = output.page_count + 1
                toc.append([1, group['title'], group_start])
                for item in group['files']:
                    source = self.pdf(item, EXPORTS if (ROOT / item['path']).is_relative_to(EXPORTS) else BOOKS)
                    start = output.page_count + 1
                    with fitz.open(ROOT / source['path']) as document:
                        output.insert_pdf(document, links=False, annots=False, widgets=False)
                        if len(group['files']) > 1 or item.get('label'):
                            toc.append([2, item.get('label') or Path(item['path']).stem, start])
                            child_level = 3
                        else:
                            child_level = 2
                        children = item.get('bookmarks')
                        if not isinstance(children, list):
                            children = [{'level': entry[0], 'title': entry[1], 'page': entry[2]} for entry in document.get_toc() if entry[2] > 0]
                        for entry in children:
                            if 1 <= entry['page'] <= source['pages']:
                                toc.append([child_level + entry.get('level', 1) - 1, entry['title'], start + entry['page'] - 1])
                    offsets.append({'group': group['title'], 'title': item.get('label') or group['title'], 'source': source['path'], 'sourceSHA256': source['sha256'], 'startPage': start, 'endPage': output.page_count, 'pages': source['pages']})
                    inputs.append({key: source[key] for key in ['path', 'sha256', 'bytes', 'pages']})
                if output.page_count < group_start:
                    raise ValueError('EmptyPDFGroup')
            if expected is not None and output.page_count != expected:
                raise ValueError('AssembledExtentMismatch')
            output.set_toc(toc)
            target = EXPORTS / name
            save_pdf(output, target, title)
            result = record(target, category=category, pages=output.page_count, bookmarks=len(toc), offsets=offsets, inputs=inputs, buildKey=key)
            self.outputs.append(result)
            return result
        finally:
            output.close()

    def captions(self, book_id, manifest):
        captures = manifest['interactive']['captionDerivatives']
        if len(captures) != 40 or len({item['derivedFrom']['path'] for item in captures}) != 40:
            raise ValueError('FortyVerifiedCaptionSourcesRequired')
        inventory = manifest['interactive']['sourceInventory']
        titles = {item['slug']: item for item in inventory}
        order = {item['slug']: index for index, item in enumerate(inventory)}
        captures = sorted(captures, key=lambda item: (order.get(Path(item['path']).parent.name, 9999), natural(Path(item['path']).name)))
        media = {item['path']: item for item in manifest['interactive']['media']['files']}
        caption_parts = []
        for index, item in enumerate(captures, 1):
            plain = self.verify(item, BOOKS / book_id)
            original = item['derivedFrom']
            raw = self.verify(original, BOOKS / book_id)
            if original['path'] not in media or media[original['path']]['sha256'] != original['sha256']:
                raise ValueError('CaptionOriginalNotInVerifiedMedia')
            slug = Path(item['path']).parent.name
            details = titles.get(slug, {'title': slug, 'section': ''})
            stem = f'{index:03}-{slug}'
            raw_copy = self.copied(original, f'source-captions/{book_id}/{stem}{raw.suffix}', 'caption-original', BOOKS / book_id)
            text_copy = self.copied(item, f'source-captions/{book_id}/{stem}.txt', 'caption-text', BOOKS / book_id)
            source_name = unquote(Path(urlsplit(media[original['path']].get('source', '')).path).name) or raw.name
            part = {'number': index, 'title': details['title'], 'section': details['section'], 'sourceName': source_name, 'original': original, 'plain': item, 'originalCopy': raw_copy['path'], 'plainCopy': text_copy['path'], 'format': item.get('format', 'source-caption'), 'warnings': item.get('warnings', []), 'recoveredUntimedBlocks': item.get('recoveredUntimedBlocks', 0), 'noncanonicalTimingCues': item.get('noncanonicalTimingCues', 0)}
            self.caption_sources.append({'bookId': book_id, **part})
            caption_parts.append((part, plain.read_text(encoding='utf8')))
        cached, key = self.cached(f'{book_id}-source-captions.pdf', {'method': 'verified-caption-typesetting-v1', 'parts': [part for part, _ in caption_parts]})
        if cached:
            return cached
        if not FONT.is_file():
            raise ValueError('UnicodeStudyFontRequired')
        document = fitz.open()
        font = fitz.Font(fontfile=str(FONT))
        toc, offsets = [], []
        for part, text in caption_parts:
            start = document.page_count + 1
            warnings = sorted({warning.get('code', 'source-format-warning') for warning in part['warnings']})
            note = 'Source format: ' + part['format']
            if warnings:
                note += '. Source warnings: ' + ', '.join(warnings)
            note += '. Source order retained; no timestamps invented.'
            title = f"{manifest['title']} - source transcript {part['number']:02}"
            body_lines = wrapped_lines(text, font, 10.5, 499)
            extracted = []
            while body_lines:
                page = document.new_page(width=595, height=842)
                page.insert_font(fontname='StudySans', fontfile=str(FONT))
                page.insert_text((48, 43), title, fontname='StudySans', fontsize=13)
                header = f"{part['section']} / {part['title']}\n{part['sourceName']}\n{note}\nOriginal SHA-256: {part['original']['sha256']}"
                header_lines = wrapped_lines(header, font, 8, 499)
                y = 64
                for line in header_lines:
                    page.insert_text((48, y), line, fontname='StudySans', fontsize=8)
                    y += 12
                y += 15
                body_top = y - 12
                capacity = max(1, int((790 - y) // 15))
                lines, body_lines = body_lines[:capacity], body_lines[capacity:]
                for line in lines:
                    if line:
                        page.insert_text((48, y), line, fontname='StudySans', fontsize=10.5)
                    y += 15
                extracted.append(page.get_text('text', clip=fitz.Rect(45, body_top, 553, y + 2), sort=True))
                page.insert_text((48, 817), f"Private source transcript | {part['number']:02} | exported page {document.page_count}", fontname='StudySans', fontsize=8)
            if compact(''.join(extracted)) != compact(text):
                raise ValueError('CaptionPDFTextCoverageMismatch')
            toc.append([1, f"{part['number']:02} - {part['title']} - {part['sourceName']}", start])
            offsets.append({'title': part['title'], 'source': part['plain']['path'], 'sourceSHA256': part['plain']['sha256'], 'startPage': start, 'endPage': document.page_count, 'pages': document.page_count - start + 1, 'format': part['format'], 'warnings': part['warnings'], 'textCoverageIgnoringWhitespace': True})
        document.set_toc(toc)
        target = EXPORTS / f'{book_id}-source-captions.pdf'
        save_pdf(document, target, f"{manifest['title']} - supplied source captions and transcripts")
        result = record(target, category='source-caption-pdf', pages=document.page_count, bookmarks=len(toc), offsets=offsets, buildKey=key, inputs=[part['plain'] for part, _ in caption_parts])
        document.close()
        self.outputs.append(result)
        return result


def compact(value):
    return re.sub(r'\s+', '', value)


def wrapped_lines(text, font, size, width):
    lines = []
    for paragraph in text.split('\n'):
        if not paragraph.strip():
            lines.append('')
            continue
        current = ''
        for word in paragraph.split():
            candidate = (current + ' ' + word).strip()
            if current and font.text_length(candidate, fontsize=size) > width:
                lines.append(current)
                current = ''
            for character in word:
                if font.text_length(current + character, fontsize=size) > width:
                    lines.append(current)
                    current = ''
                current += character
            if current:
                current += ' '
        lines.append(current.rstrip())
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-interactive', action='store_true', help='Build student, reference and source transcript PDFs before interactive printing finishes')
    parser.add_argument('--no-zip', action='store_true', help='Skip the PDF/caption ZIP download kit')
    args = parser.parse_args()
    os.umask(0o077)
    private(EXPORTS, BOOKS)
    EXPORTS.mkdir(parents=True, exist_ok=True, mode=0o700)
    ignored(EXPORTS / 'export-manifest.json')
    with (EXPORTS / '.pdf-export.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run_exports(args)


def run_exports(args):
    exporter = Exporter()
    source_manifests, books = [], []
    print_manifest = None
    if not args.skip_interactive:
        print_path = EXPORTS / 'interactive-print-manifest.json'
        print_manifest = read_json(print_path, EXPORTS)
        if print_manifest.get('pathBase') != 'repository-root':
            raise ValueError('RepositoryRelativeInteractivePathsRequired')
        source_manifests.append(record(print_path))
    for book_id, spec in SPECS.items():
        manifest_path = BOOKS / book_id / 'manifest.json'
        manifest = read_json(manifest_path, BOOKS / book_id)
        if manifest.get('generator') != 'summarize_book_imports.py' or not manifest.get('status', '').startswith('verified') or manifest.get('integrityFailures'):
            raise ValueError('FinalVerifiedBookManifestRequired')
        source_manifests.append(record(manifest_path))
        canonical = exporter.pdf(manifest['canonicalNativeBook'], BOOKS / book_id)
        if canonical['pages'] != spec['main'] or canonical['sha256'] != spec['sha256']:
            raise ValueError('ApprovedCanonicalBookRequired')
        with fitz.open(ROOT / canonical['path']) as document:
            pdf_safety(document)
        student = exporter.copied(canonical, f'{book_id}-student-book.pdf', 'byte-exact-student-book', BOOKS / book_id)
        student['bookId'] = book_id
        bookmarks = [{'level': 1, 'title': item['section'], 'page': item['start_page']} for item in canonical['sectionOffsets']]
        student_part = {**student, 'bookmarks': bookmarks}
        native = manifest['native']['derivedSectionPDFs']
        videos = sorted([item for item in native if re.fullmatch(r'lezione-\d+-videocorso.pdf', Path(item['path']).name)], key=lambda item: natural(Path(item['path']).name))
        solutions = sorted([item for item in native if Path(item['path']).name in ['soluzioni-lezioni.pdf', 'soluzioni-esercizi.pdf']], key=lambda item: Path(item['path']).name != 'soluzioni-lezioni.pdf')
        guides = manifest['publisherAndReaderSupplements']['teacherGuides']
        if len(videos) != 10 or sum(item['pages'] for item in videos) != 20 or sum(item['pages'] for item in solutions) != spec['solutions'] or len(guides) != 1 or guides[0]['pages'] != spec['guide']:
            raise ValueError('ReferenceSourceInventoryMismatch')
        groups = [{'title': 'Student book', 'files': [student_part]}, {'title': 'Video worksheets', 'files': videos}, {'title': 'Lesson solutions', 'files': [solutions[0]]}, {'title': 'Workbook solutions', 'files': [solutions[1]]}, {'title': 'Teacher guide', 'files': guides}]
        reference = exporter.assembled(f'{book_id}-reference-pack.pdf', manifest['title'] + ' - private reference pack', groups, spec['reference'], 'reference-pack')
        captions = exporter.captions(book_id, manifest)
        pdf_transcripts = sorted([item for item in manifest['interactive']['media']['files'] if item.get('mime') == 'application/pdf'], key=lambda item: natural(Path(urlsplit(item.get('source', '')).path).name))
        pdf_transcripts = [{**exporter.pdf(item, BOOKS / book_id), 'label': unquote(Path(urlsplit(item.get('source', '')).path).name)} for item in pdf_transcripts]
        if sum(item['pages'] for item in pdf_transcripts) != spec['transcriptPDFs']:
            raise ValueError('SuppliedPDFTranscriptExtentMismatch')
        transcripts = exporter.assembled(f'{book_id}-supplied-transcripts.pdf', manifest['title'] + ' - supplied transcripts', [{'title': 'Supplied audio transcript PDFs', 'files': pdf_transcripts}, {'title': 'Supplied video captions and transcripts', 'files': [captions]}], spec['transcriptPDFs'] + captions['pages'], 'supplied-transcripts')
        book = {'bookId': book_id, 'title': manifest['title'], 'student': student, 'reference': reference, 'captions': captions, 'transcripts': transcripts, 'publisherPages': canonical['expectedPublisherPages'], 'accessiblePages': canonical['pages'], 'extentNote': canonical.get('extent_note'), 'sourceGaps': manifest.get('gaps', []), 'mediaOmissions': manifest['interactive']['media'].get('omissions', [])}
        if print_manifest:
            matches = [item for item in print_manifest.get('books', []) if item.get('bookId') == book_id]
            if len(matches) != 1:
                raise ValueError('OneVerifiedInteractivePrintPerBookRequired')
            interactive = exporter.pdf(matches[0], EXPORTS)
            evidence = {item['path']: item for item in manifest['evidenceManifests']}
            inventory_path = manifest['interactive']['inventory']
            media_path = f'materials/books/{book_id}/interactive/media/manifest.json'
            if interactive.get('observedActivities') != manifest['interactive']['discoveredActivities'] or interactive.get('sourceStudyPages') != manifest['interactive']['capturedPages']:
                raise ValueError('InteractiveActivityInventoryMismatch')
            if interactive.get('sourceInventorySHA256') != evidence[inventory_path]['sha256'] or interactive.get('sourceMediaManifestSHA256') != evidence[media_path]['sha256']:
                raise ValueError('InteractivePrintSourceEvidenceMismatch')
            book['interactive'] = {key: interactive[key] for key in ['path', 'sha256', 'bytes', 'pages']}
            book['complete'] = exporter.assembled(f'{book_id}-complete-study-pack.pdf', manifest['title'] + ' - accessible PDF study pack', [{'title': 'Reference pack', 'files': [reference]}, {'title': 'Supplied transcripts', 'files': [transcripts]}, {'title': 'Printable interactive activities', 'files': [interactive]}], reference['pages'] + transcripts['pages'] + interactive['pages'], 'accessible-complete-study-pack')
        books.append(book)
        print(json.dumps({'bookId': book_id, 'studentPages': student['pages'], 'referencePages': reference['pages'], 'sourceTranscriptPDFPages': spec['transcriptPDFs'], 'captionPages': captions['pages'], 'transcriptPackPages': transcripts['pages'], 'completePages': book.get('complete', {}).get('pages')}), flush=True)
    combined = exporter.assembled('combined-student-books.pdf', 'Nuovo Espresso Plus 1 and 2 - accessible student books', [{'title': book['title'], 'files': [{**book['student'], 'bookmarks': [{'level': 1, 'title': item['title'], 'page': item['page']} for item in [{'title': entry['section'], 'page': entry['start_page']} for entry in read_json(BOOKS / book['bookId'] / 'manifest.json', BOOKS / book['bookId'])['canonicalNativeBook']['sectionOffsets']]]}]} for book in books], 503, 'combined-student-books')
    if print_manifest:
        exporter.assembled('combined-complete-study-pack.pdf', 'Nuovo Espresso Plus 1 and 2 - accessible PDF study packs', [{'title': book['title'], 'files': [book['complete']]} for book in books], sum(book['complete']['pages'] for book in books), 'combined-accessible-complete-study-pack')
    for item in source_manifests:
        if digest(ROOT / item['path']) != item['sha256']:
            raise ValueError('SourceManifestChangedDuringExport')
    for item in exporter.inputs.values():
        path = ROOT / item['path']
        if path.stat().st_mtime_ns != item['mtimeNS'] and digest(path) != item['sha256']:
            raise ValueError('VerifiedInputChangedDuringExport')
    manifest = {'schemaVersion': 1, 'generator': GENERATOR, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'pathBase': 'repository-root', 'status': 'complete-accessible-pdf-exports' if print_manifest else 'student-reference-transcript-exports-interactive-pending', 'books': books, 'combinedStudent': combined, 'sourceManifests': source_manifests, 'verifiedInputs': [{key: value for key, value in item.items() if key != 'mtimeNS'} for item in exporter.inputs.values()], 'outputs': exporter.outputs, 'captionSources': exporter.caption_sources, 'limits': ['Private licensed study-source exports; all outputs remain Git-ignored.', 'PLUS 2 contains 263 accessible student pages. Publisher page 264 is unavailable and has not been invented.', 'Reference and complete packs include private source solutions and teacher guides.', 'PDF packs overlap: student pages are also included in reference and complete packs.', 'Audio/video binaries remain in the private source archive; printed activities use source labels. Unavailable media is not fabricated.', 'Supplied captions retain explicit source-format warnings. No timing has been invented; plain supplied transcripts are labelled accordingly.']}
    manifest['indexes'] = write_readme(manifest, not args.no_zip)
    write_json(EXPORTS / 'export-manifest.json', manifest)
    if not args.no_zip:
        kit = EXPORTS / 'italian-study-pdf-export-kit.zip'
        paths = {ROOT / item['path'] for item in exporter.outputs}
        if print_manifest:
            paths |= {ROOT / book['interactive']['path'] for book in books}
            paths.add(EXPORTS / 'interactive-print-manifest.json')
        paths |= {EXPORTS / 'export-manifest.json', EXPORTS / 'README.md', EXPORTS / 'index.html'}
        with temporary_output(kit) as temporary:
            with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                for path in sorted(paths):
                    private(path, EXPORTS)
                    archive.write(path, path.relative_to(EXPORTS).as_posix())
            with zipfile.ZipFile(temporary) as archive:
                if archive.testzip():
                    raise ValueError('ExportKitCRCFailure')
        write_json(EXPORTS / 'export-kit-manifest.json', {'generator': GENERATOR, 'kit': record(kit), 'files': len(paths), 'excludes': ['_print-cache', 'audio/video binaries', 'browser/session data']})
    print(json.dumps({'status': manifest['status'], 'combinedStudentPages': combined['pages'], 'combinedStudentSHA256': combined['sha256'], 'outputs': len(exporter.outputs), 'zip': not args.no_zip}), flush=True)


def write_readme(manifest, with_zip):
    lines = ['# Private PDF study exports', '', 'All files stay local and Git-ignored. The individual student PDFs are byte-exact renamed copies of the approved canonical PDFs. Combined/reference PDFs preserve page content and add internal bookmarks.', '', '| Book | Student | Reference | Supplied transcripts | Complete PDF study pack |', '| --- | --- | --- | --- | --- |']
    for book in manifest['books']:
        def link(item):
            return f"[{item['pages']} pages]({Path(item['path']).name})" if item else 'Waiting for interactive print'
        lines.append(f"| {book['title']} | {link(book['student'])} | {link(book['reference'])} | {link(book['transcripts'])} | {link(book.get('complete'))} |")
    lines += ['', '[Combined student books: 503 pages](combined-student-books.pdf). PLUS 2 supplies 263 accessible student pages; the publisher lists 264. The missing page is not inferred or padded.', '', 'Reference packs add video worksheets, lesson/workbook solutions and the teacher guide. Transcript packs include every verified source transcript PDF plus all 40 source caption/transcript sidecars per book. Exact original captions and exact derived text are copied under `source-captions/`; the manifest records hashes and source-format warnings, including supplied untimed prose.', '', 'Complete study packs add printable interactive activities. Audio/video binaries and source access gaps remain described in the private archive; source labels in print do not embed or invent unavailable media.', '', '[Export manifest and page offsets](export-manifest.json).']
    if manifest['status'] == 'complete-accessible-pdf-exports':
        lines += ['', '[Combined complete PDF study pack](combined-complete-study-pack.pdf).']
    if with_zip:
        lines += ['', '[Download PDF/caption export kit](italian-study-pdf-export-kit.zip). The kit excludes print cache, browser state and large audio/video binaries. Its byte count and checksum are in [kit manifest](export-kit-manifest.json).']
    with temporary_output(EXPORTS / 'README.md') as temporary:
        temporary.write_text('\n'.join(lines) + '\n', encoding='utf8')
    rows = []
    for book in manifest['books']:
        cells = []
        for name in ['student', 'reference', 'transcripts', 'complete']:
            item = book.get(name)
            cells.append(f'<td><a href="{escape(Path(item["path"]).name, quote=True)}" download>{item["pages"]} pages</a></td>' if item else '<td>Interactive print pending</td>')
        rows.append('<tr><th scope="row">' + escape(book['title']) + '</th>' + ''.join(cells) + '</tr>')
    extra = '<p><a href="combined-complete-study-pack.pdf" download>Combined complete PDF study pack</a></p>' if manifest['status'] == 'complete-accessible-pdf-exports' else ''
    kit = '<p><a href="italian-study-pdf-export-kit.zip" download>Download the PDF and caption ZIP kit</a></p>' if with_zip else ''
    html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'none\'; connect-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Private PDF study exports</title><style>body{font:17px/1.6 system-ui,sans-serif;max-width:1100px;margin:3rem auto;padding:0 1.2rem;color:#20382e;background:#faf8f0}h1{font-size:2rem}table{border-collapse:collapse;width:100%;background:#fff}th,td{padding:.8rem;text-align:left;border-bottom:1px solid #ddd}a{color:#165d47}small{color:#526259}</style></head><body><h1>Private PDF study exports</h1><p>Download the accessible student books, private reference material and supplied transcripts. These files remain local and Git-ignored.</p><p><a href="combined-student-books.pdf" download>Combined student books: 503 pages</a></p><table><thead><tr><th>Book</th><th>Student</th><th>Reference</th><th>Transcripts</th><th>Complete PDF pack</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table>' + extra + kit + '<p>PLUS 2 contains 263 accessible student pages. The publisher lists 264; the unavailable page has not been invented. Reference packs include source solutions and teacher guides. PDF packs overlap.</p><p>Original captions and exact plain-text derivatives are in <a href="source-captions/">source-captions/</a>. Supplied untimed prose and source timing defects retain explicit warnings. No new timing or unavailable media has been created.</p><p><a href="export-manifest.json">Checksums, provenance and page offsets</a> · <a href="README.md">Export notes</a></p><small>Audio and video binaries remain in the private source archive. They and the temporary print cache are excluded from this PDF/caption ZIP kit.</small></body></html>'
    with temporary_output(EXPORTS / 'index.html') as temporary:
        temporary.write_text(html + '\n', encoding='utf8')
    return [record(EXPORTS / 'README.md'), record(EXPORTS / 'index.html')]


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        safe = str(error) if re.fullmatch(r'[A-Z][A-Za-z]+', str(error)) else type(error).__name__
        print(json.dumps({'status': 'export-failed', 'reason': safe}), flush=True)
        raise SystemExit(1)

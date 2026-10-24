"""Verify private book imports and optionally write a private archive index."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import tempfile

import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / 'materials' / 'books'
INCOMING = ROOT / 'data' / 'incoming' / 'books'
GENERATOR = 'summarize_book_imports.py'


def confined(path: Path, base: Path):
    if not path.is_relative_to(base) or path.resolve() != path:
        raise ValueError('PrivatePathRequired')
    return path


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path, base: Path, default=None):
    confined(path, base)
    if not path.exists():
        return default
    if not path.is_file() or path.stat().st_size > 50 * 1024 * 1024:
        raise ValueError('InvalidOrUnboundedManifest')
    return json.loads(path.read_text(encoding='utf8'))


def atomic_json(path: Path, value, base: Path):
    atomic_text(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n', base)


def atomic_text(path: Path, value: str, base: Path):
    confined(path, base)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(value)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class OfflineHTMLAudit(HTMLParser):
    """Count unsafe structures without recording their contents or values."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.problems = Counter()
        self.policy = False
        self.local_media = set()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in {'script', 'style', 'link', 'base', 'form', 'iframe', 'object', 'embed', 'button', 'input', 'textarea', 'select'}:
            self.problems['active-or-response-element'] += 1
        for key, value in attrs:
            if key.startswith('on') or key.startswith('data-') or key in {'id', 'class', 'value', 'checked', 'selected', 'contenteditable', 'style', 'srcdoc', 'autoplay', 'srcset'} or (key == 'name' and tag != 'meta'):
                self.problems['state-or-identity-attribute'] += 1
            if key in {'src', 'poster', 'href', 'srcset', 'action'} and value:
                value = value.strip()
                local_media = re.fullmatch(r'\.\./media/[0-9a-f]{24}\.[a-z0-9]{1,5}', value)
                attachment = tag == 'a' and key == 'href' and local_media and value.endswith('.pdf')
                media = key in {'src', 'poster'} and tag in {'img', 'audio', 'video', 'source', 'track'} and local_media
                inline_media = key == 'src' and tag in {'img', 'audio', 'video', 'source'} and re.match(r'^data:(?:image|audio|video)/', value, re.I)
                if not (attachment or media or inline_media):
                    self.problems['remote-or-unresolved-reference'] += 1
                elif local_media:
                    self.local_media.add(value)
        if tag == 'meta' and attributes.get('http-equiv', '').lower() == 'content-security-policy':
            content = attributes.get('content', '')
            self.policy = all(item in content for item in ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "form-action 'none'"])
        if tag == 'meta' and attributes.get('http-equiv', '').lower() == 'refresh':
            self.problems['automatic-navigation'] += 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_comment(self, _data):
        self.problems['source-comment'] += 1


def summarize(book_id: str):
    source = confined(BOOKS / book_id, BOOKS)
    incoming = confined(INCOMING / book_id, INCOMING)
    evidence = []
    failures, gaps = [], []
    verified = {}

    def reference(path, base, expected_sha=None, expected_bytes=None):
        confined(path, base)
        relative = path.relative_to(ROOT).as_posix()
        if relative in verified:
            item = verified[relative]
        elif not path.is_file():
            failures.append({'file': relative, 'reason': 'missing-file'})
            return None
        else:
            item = {'path': relative, 'bytes': path.stat().st_size, 'sha256': sha256(path)}
            verified[relative] = item
        if (expected_sha is not None and item['sha256'] != expected_sha) or (expected_bytes is not None and item['bytes'] != expected_bytes):
            failures.append({'file': relative, 'reason': 'checksum-or-size-mismatch'})
        return item

    def document(name, base, default=None):
        path = base / name
        result = read_json(path, base, default)
        if path.is_file():
            entry = reference(path, base)
            if entry:
                evidence.append(entry)
        return result

    native = document('native/conversion-manifest.json', incoming, {})
    full = native.get('complete_book', {})
    native_files = native.get('files', [])
    if not isinstance(native_files, list) or len(native_files) > 300:
        raise ValueError('InvalidNativeInventory')
    originals, converted = [], []
    for item in native_files:
        original = reference(source / item['source'], source, item['source_sha256'], item['source_bytes'])
        pdf = reference(source / item['pdf'], source, item['pdf_sha256'], item['pdf_bytes'])
        if pdf:
            with fitz.open(ROOT / pdf['path']) as document_pdf:
                if document_pdf.page_count != item['pages']:
                    failures.append({'file': pdf['path'], 'reason': 'pdf-page-count-mismatch'})
        originals.append({**(original or {}), 'pages': item['pages']})
        converted.append({**(pdf or {}), 'pages': item['pages']})
    canonical = None
    if full.get('path'):
        canonical = reference(source / full['path'], source, full['sha256'], full['bytes'])
        if canonical:
            with fitz.open(ROOT / canonical['path']) as pdf:
                if pdf.page_count != full['pages']:
                    failures.append({'file': canonical['path'], 'reason': 'canonical-page-count-mismatch'})
            canonical.update({key: full.get(key) for key in ['status', 'pages', 'expectedPublisherPages', 'expectedReaderPages', 'publisher_extent_discrepancy_pages', 'extent_note']})
            canonical['expectedPublisherPages'] = full.get('expectedPublisherPages', full.get('expected_pages'))
            canonical['expectedReaderPages'] = full.get('expectedReaderPages', full.get('pages'))
            canonical['publisher_extent_discrepancy_pages'] = full.get('publisher_extent_discrepancy_pages', (canonical['expectedPublisherPages'] or canonical['pages']) - canonical['pages'])
            canonical['sectionOffsets'] = full.get('section_offsets', [])
    else:
        gaps.append({'kind': 'main-book', 'reason': full.get('reason', 'not-assembled')})
    if full.get('publisher_extent_discrepancy_pages'):
        gaps.append({'kind': 'publisher-extent-discrepancy', 'publisherPages': full.get('expectedPublisherPages'), 'accessiblePages': full.get('pages'), 'note': full.get('extent_note'), 'unknownPageWasNotInvented': True})
    text = document('native/complete-book-pages.json', incoming, {})
    if canonical and ([page.get('page') for page in text.get('pages', [])] != list(range(1, canonical['pages'] + 1)) or text.get('derived_pdf_sha256') != canonical['sha256']):
        failures.append({'file': 'native/complete-book-pages.json', 'reason': 'whole-book-text-order-or-source-mismatch'})
    document('native/source-pages.json', incoming, [])
    document('native/complete-book-manifest.json', incoming, {})
    reader = document('reader-manifest.json', source, {})

    interactive = document('interactive-manifest.json', source, {})
    activities = interactive.get('activities', [])
    if not isinstance(activities, list) or len(activities) > 1000:
        raise ValueError('InvalidInteractiveInventory')
    inventory = interactive.get('inventory', [])
    discovered = interactive.get('discoveredActivities')
    if not isinstance(inventory, list) or len(inventory) > 1000:
        raise ValueError('InvalidInteractiveSourceInventory')
    inventory_by_slug = {}
    for item in inventory:
        slug = item.get('slug', '')
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,158}[a-z0-9]|[a-z0-9]', slug) or slug in inventory_by_slug:
            raise ValueError('InvalidOrDuplicateInventoryActivity')
        inventory_by_slug[slug] = item
    if interactive and (type(discovered) is not int or discovered != len(inventory)):
        failures.append({'reason': 'interactive-source-inventory-count-mismatch'})
    activity_summaries, html_issues, caption_derivatives = [], [], []
    captured_pages = text_complete = fully_captured = 0
    observed_media = {}
    attempted_slugs, html_media = set(), []
    for activity in activities:
        activity_slug = activity.get('slug', '')
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,158}[a-z0-9]|[a-z0-9]', activity_slug):
            raise ValueError('InvalidActivityFolder')
        if activity_slug in attempted_slugs:
            raise ValueError('DuplicateAttemptedActivity')
        attempted_slugs.add(activity_slug)
        expected_source = inventory_by_slug.get(activity_slug)
        if not expected_source or any(activity.get(key) != expected_source.get(key) for key in ['title', 'section']):
            failures.append({'activity': activity_slug, 'reason': 'activity-not-in-source-inventory'})
        pages, expected = activity.get('pages', []), activity.get('expectedPages')
        files = activity.get('files', [])
        pairs = set()
        for item in files:
            found = reference(source / item['path'], source, item.get('sha256'), item.get('bytes'))
            if found:
                pairs.add(found['path'])
                if found['path'].endswith('.html'):
                    parser = OfflineHTMLAudit()
                    parser.feed((ROOT / found['path']).read_text(encoding='utf8'))
                    if not parser.policy:
                        parser.problems['missing-offline-csp'] += 1
                    if parser.problems:
                        html_issues.append({'file': found['path'], 'issues': dict(parser.problems)})
                    html_media.extend({'file': found['path'], 'media': value} for value in parser.local_media)
        for item in activity.get('captionFiles', []):
            found = reference(source / item['path'], source, item.get('sha256'), item.get('bytes'))
            original = item.get('derivedFrom', {})
            original_found = reference(source / original['path'], source, original.get('sha256'), original.get('bytes')) if original.get('path') else None
            if found and original_found:
                caption_derivatives.append({**found, 'derivedFrom': original_found, 'cues': item.get('cues'), 'words': item.get('words'), 'format': item.get('format'), 'warnings': item.get('warnings', []), 'recoveredUntimedBlocks': item.get('recoveredUntimedBlocks', 0), 'noncanonicalTimingCues': item.get('noncanonicalTimingCues', 0)})
            else:
                failures.append({'activity': activity_slug, 'reason': 'caption-derivative-source-missing'})
        required_files = {f'materials/books/{book_id}/interactive/{activity_slug}/{filename}' for page in pages for filename in [page.get('html', ''), page.get('text', '')]}
        required_files |= {f'materials/books/{book_id}/interactive/{activity_slug}/content.{suffix}' for suffix in ['html', 'txt']}
        complete = type(expected) is int and expected > 0 and [page.get('page') for page in pages] == list(range(1, expected + 1)) and required_files.issubset(pairs)
        captured_pages += len(pages)
        text_complete += int(complete)
        fully_captured += int(complete and activity.get('status') == 'captured')
        if not complete:
            gaps.append({'kind': 'interactive-activity', 'activity': activity_slug, 'status': activity.get('status'), 'capturedPages': len(pages), 'expectedPages': expected})
        pending_transcripts = [item for item in activity.get('needsRenderedTranscript', []) if item.get('status') != 'preserved-rendered-page']
        if pending_transcripts:
            gaps.append({'kind': 'rendered-transcript-review', 'activity': activity_slug, 'pages': pending_transcripts})
        if activity.get('staticAttempt', {}).get('status') == 'incomplete':
            gaps.append({'kind': 'static-alternative-incomplete-rendered-preserved', 'activity': activity_slug, 'reason': activity['staticAttempt'].get('reason')})
        if activity.get('missingEditorAudioURIs'):
            gaps.append({'kind': 'source-audio-uri-missing', 'activity': activity_slug, 'count': activity['missingEditorAudioURIs']})
        for item in activity.get('media', []):
            key = item.get('source') or f'unresolved:{activity_slug}:{len(observed_media)}'
            if observed_media.get(key, {}).get('status') != 'downloaded':
                observed_media[key] = item
        activity_summaries.append({'title': activity.get('title'), 'section': activity.get('section'), 'slug': activity_slug, 'status': activity.get('status'), 'textPagesComplete': complete, 'pages': len(pages), 'expectedPages': expected, 'manifest': f'materials/books/{book_id}/interactive/{activity_slug}/manifest.json'})
        reference(source / 'interactive' / activity_slug / 'manifest.json', source)
    media_manifest = document('interactive/media/manifest.json', source, {})
    for item in media_manifest.get('files', []):
        if item.get('source'):
            observed_media[item['source']] = item
    media, omitted_media = [], []
    for item in observed_media.values():
        if item.get('status') == 'downloaded':
            found = reference(source / 'interactive' / item['file'], source, item.get('sha256'), item.get('bytes'))
            if found:
                media.append({**found, 'mime': item.get('mime'), 'source': item.get('source')})
        else:
            omitted_media.append({key: item.get(key) for key in ['source', 'status', 'mime', 'error'] if key in item})
    saved_media = {item['path'] for item in media}
    for item in html_media:
        target = (ROOT / item['file']).parent / item['media']
        target = target.resolve()
        if not target.is_relative_to(source / 'interactive' / 'media') or target.relative_to(ROOT).as_posix() not in saved_media:
            failures.append({'file': item['file'], 'reason': 'html-media-not-in-verified-inventory'})
    unattempted = sorted(set(inventory_by_slug) - attempted_slugs)
    if unattempted:
        gaps.append({'kind': 'interactive-unattempted-activities', 'count': len(unattempted), 'activities': unattempted})
    if not isinstance(discovered, int) or discovered != text_complete:
        gaps.append({'kind': 'interactive-inventory', 'discovered': discovered, 'textComplete': text_complete, 'attempted': len(activities)})
    if omitted_media:
        gaps.append({'kind': 'observed-media', 'omitted': len(omitted_media)})

    publisher = document('originals/publisher/manifest.json', source, {})
    supplements, guides, audio, reader_attachments = [], [], [], []
    for item in publisher.get('files', []):
        found = reference(source / 'originals/publisher' / item['filename'], source, item.get('sha256'), item.get('bytes'))
        if found:
            supplement = {**found, 'category': item.get('category'), 'pages': item.get('physical_pages')}
            supplements.append(supplement)
            if item.get('category') == 'teacher-guide':
                guides.append(supplement)
            if item.get('category', '').startswith('audio-'):
                audio.append({**supplement, 'mp3Tracks': item.get('audio_files', 0)})
    attachments = document('reader-attachments/source-pages.json', incoming, [])
    for item in attachments:
        found = reference(source / 'originals/reader-attachments' / item['path'], source, item.get('sha256'))
        if found:
            attachment = {**found, 'category': 'authorized-reader-attachment', 'pages': len(item.get('pages', []))}
            reader_attachments.append(attachment)
            if re.search(r'guid[ae]', item['path'], re.I):
                guides.append({**attachment, 'category': 'authorized-reader-teacher-guide'})
    if html_issues:
        failures.append({'reason': 'offline-html-audit', 'files': len(html_issues)})
    summary = {'schemaVersion': 1, 'generator': GENERATOR, 'bookId': book_id, 'title': interactive.get('bookTitle') or reader.get('title') or book_id, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'status': 'integrity-failures' if failures else 'verified-with-gaps' if gaps else 'verified-observed-inventory', 'scope': 'Private authorized study-source archive. Native book pages, observed interactive study pages and observed downloadable media are separate representations. No learner answers, browser state, cookies or session exports belong in this archive.', 'canonicalNativeBook': canonical, 'native': {'sections': len(native_files), 'sectionPages': sum(item['pages'] for item in native_files), 'originalBytes': sum(item.get('bytes', 0) for item in originals), 'originals': originals, 'derivedSectionPDFs': converted, 'sectionText': f'data/incoming/books/{book_id}/native/source-pages.json', 'wholeBookText': f'data/incoming/books/{book_id}/native/complete-book-pages.json', 'textCharacters': sum(len(page.get('text', '')) for page in text.get('pages', []))}, 'interactive': {'inventory': f'materials/books/{book_id}/interactive-manifest.json', 'discoveredActivities': discovered, 'attemptedActivities': len(activities), 'textCompleteActivities': text_complete, 'fullyCapturedActivities': fully_captured, 'capturedPages': captured_pages, 'activities': activity_summaries, 'media': {'downloadedFiles': len(media), 'bytes': sum(item['bytes'] for item in media), 'mimeCounts': dict(Counter(item.get('mime') or 'unknown' for item in media)), 'files': media, 'omissions': omitted_media}, 'htmlAuditIssues': html_issues}, 'publisherAndReaderSupplements': {'files': supplements, 'teacherGuides': guides, 'audioArchives': audio, 'archivedMP3Tracks': sum(item['mp3Tracks'] for item in audio), 'audioTranscribed': False, 'publisherAccessObservations': [{'category': item.get('category'), 'status': item.get('status'), 'alternateAvailable': bool(item.get('alternate_authorized_source'))} for item in publisher.get('omissions', [])]}, 'evidenceManifests': evidence, 'verifiedFiles': len(verified), 'integrityFailures': failures, 'gaps': gaps, 'limits': ['Coverage is measured against observed source inventories, not every possible remote publisher asset.', 'Native section PDFs and the assembled book duplicate content and must not be added together as distinct textbook pages.', 'HTML pages contain blank response placeholders and are study references; captured files do not grade writing.', 'Media absent from observed study DOM is not claimed archived. No audio transcription was performed.']}
    summary['publisherAndReaderSupplements']['readerAttachments'] = reader_attachments
    summary['native']['listedReaderSections'] = len(reader.get('sections', []))
    summary['interactive']['sourceInventory'] = [{key: item.get(key) for key in ['section', 'title', 'slug']} for item in inventory]
    summary['interactive']['unattemptedActivities'] = unattempted
    summary['interactive']['responseSlots'] = dict(sum((Counter(page.get('slots', {})) for activity in activities for page in activity.get('pages', [])), Counter()))
    summary['interactive']['captionDerivatives'] = caption_derivatives
    summary['interactive']['captionSourceRecovery'] = {'filesWithWarnings': sum(bool(item['warnings']) for item in caption_derivatives), 'recoveredUntimedBlocks': sum(item['recoveredUntimedBlocks'] for item in caption_derivatives), 'noncanonicalTimingCues': sum(item['noncanonicalTimingCues'] for item in caption_derivatives), 'suppliedPlainTranscripts': sum(item['format'] == 'supplied-plain-transcript' for item in caption_derivatives)}
    summary['interactive']['editorAudioPlayers'] = sum(item.get('editorAudioPlayers', 0) for item in activities)
    summary['interactive']['missingEditorAudioURIs'] = sum(item.get('missingEditorAudioURIs', 0) for item in activities)
    return summary


def finalize(summary):
    book_id = summary['bookId']
    if summary['integrityFailures']:
        raise ValueError('ResolveIntegrityFailuresBeforeFinalizing')
    for evidence in summary['evidenceManifests']:
        if sha256(ROOT / evidence['path']) != evidence['sha256']:
            raise ValueError('EvidenceChangedDuringSummary')
    target = BOOKS / book_id / 'manifest.json'
    previous = read_json(target, BOOKS, {})
    if previous and previous.get('generator') != GENERATOR:
        raise ValueError('ExistingManualBookManifestPreserved')
    for output in [target, INCOMING / book_id / 'import-summary.json', BOOKS / 'README.md']:
        confined(output, BOOKS if output.is_relative_to(BOOKS) else INCOMING)
        if subprocess.run(['git', 'check-ignore', '--quiet', str(output)], cwd=ROOT, check=False).returncode:
            raise ValueError('FinalArchiveIndexMustBeGitIgnored')
    atomic_json(target, summary, BOOKS)
    atomic_json(INCOMING / book_id / 'import-summary.json', summary, INCOMING)


def write_readme(book_ids):
    entries = []
    for book_id in sorted(set(book_ids) | {'nuovo-espresso-plus-1', 'nuovo-espresso-plus-2'}):
        item = read_json(BOOKS / book_id / 'manifest.json', BOOKS, {})
        if item.get('generator') == GENERATOR:
            entries.append(item)
    lines = ['<!-- parliamo-book-import-index:start -->', '# Private study archive', '', 'These sources and derived files remain local and Git-ignored. Publish only the original companion course in `site-dist/`.', '', '| Book | Accessible native book | Publisher extent | Native sections | Interactive study capture | Index |', '| --- | ---: | ---: | ---: | --- | --- |']
    for item in entries:
        book, canonical, interactive = item['bookId'], item.get('canonicalNativeBook') or {}, item['interactive']
        pdf = canonical.get('path', '')
        relative = Path(pdf).relative_to('materials/books').as_posix() if pdf else ''
        page_link = f"[{canonical.get('pages')} pages]({relative})" if relative else 'Not assembled'
        lines.append(f"| {item['title']} | {page_link} | {canonical.get('expectedPublisherPages', 'Unknown')} | {item['native']['sections']} | {interactive['textCompleteActivities']}/{interactive['discoveredActivities']} observed activities; {interactive['capturedPages']} pages | [Manifest]({book}/manifest.json) |")
    lines += ['', 'Each manifest links the preserved native assets, page-preserving text, sanitized HTML, media, guides and audio archives, with checksums and explicit gaps. Media and native section totals include overlapping representations.', '', 'PLUS 2 exposes 263 native main-book pages while the publisher lists 264. The absent page is not inferred or padded; the manifest retains the evidence and uncertainty.', '', 'Responses are blank in captured HTML. Source worksheets and solution keys remain private; the portal uses original bilingual companion practice.', '<!-- parliamo-book-import-index:end -->', '']
    path = BOOKS / 'README.md'
    confined(path, BOOKS)
    existing = path.read_text(encoding='utf8') if path.is_file() else ''
    block = '\n'.join(lines)
    pattern = r'<!-- parliamo-book-import-index:start -->[\s\S]*?<!-- parliamo-book-import-index:end -->\n?'
    content = re.sub(pattern, lambda _: block, existing) if re.search(pattern, existing) else existing.rstrip() + ('\n\n' if existing else '') + block
    atomic_text(path, content, BOOKS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--book-id', action='append', required=True, help='Repeat for both imported book IDs')
    parser.add_argument('--finalize', action='store_true', help='Write private per-book manifests and README after capture is finished')
    args = parser.parse_args()
    if len(args.book_id) > 10 or any(len(value) > 160 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value) for value in args.book_id):
        parser.error('Use bounded stable book identifiers.')
    failed = False
    for book_id in dict.fromkeys(args.book_id):
        try:
            summary = summarize(book_id)
            if args.finalize:
                finalize(summary)
            print(json.dumps({'bookId': book_id, 'status': summary['status'], 'nativeSections': summary['native']['sections'], 'nativePages': summary['native']['sectionPages'], 'accessibleMainPages': (summary['canonicalNativeBook'] or {}).get('pages'), 'interactiveActivities': summary['interactive']['textCompleteActivities'], 'discoveredActivities': summary['interactive']['discoveredActivities'], 'interactivePages': summary['interactive']['capturedPages'], 'mediaFiles': summary['interactive']['media']['downloadedFiles'], 'integrityFailures': len(summary['integrityFailures']), 'gaps': len(summary['gaps']), 'finalized': args.finalize}))
            failed |= bool(summary['integrityFailures'])
        except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
            print(json.dumps({'bookId': book_id, 'error': type(error).__name__, 'status': 'not-finalized'}))
            failed = True
    if args.finalize and not failed:
        write_readme(args.book_id)
    return failed


if __name__ == '__main__':
    raise SystemExit(main())

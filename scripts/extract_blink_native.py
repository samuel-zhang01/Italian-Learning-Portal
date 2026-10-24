"""Convert ordinary unencrypted XPS reader assets into private PDFs and native text."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import zipfile

import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / 'materials' / 'books'
INCOMING = ROOT / 'data' / 'incoming' / 'books'


def confined(path: Path, base: Path):
    if not path.is_relative_to(base) or path.resolve() != path:
        raise ValueError('PrivatePathRequired')
    return path


def atomic_write(path: Path, data: bytes, base: Path):
    confined(path, base)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_json(path: Path, base: Path, fallback):
    confined(path, base)
    if not path.is_file():
        return fallback
    if path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('ReportSizeLimit')
    try:
        return json.loads(path.read_text(encoding='utf8'))
    except (ValueError, UnicodeError):
        return fallback


def validate_xps(payload: bytes):
    if not 0 < len(payload) <= 500 * 1024 * 1024:
        raise ValueError('ArchiveSizeLimit')
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = archive.infolist()
        if len(members) > 50000 or sum(item.file_size for item in members) > 1024 * 1024 * 1024:
            raise ValueError('ArchiveSizeLimit')
        names = set()
        for item in members:
            name = PurePosixPath(item.filename)
            if item.flag_bits & 1:
                raise ValueError('EncryptedArchiveRejected')
            if name.is_absolute() or '..' in name.parts or '\\' in item.filename or item.filename in names or ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError('UnsafeArchiveMember')
            names.add(item.filename)
            if item.file_size > 100 * 1024 * 1024:
                raise ValueError('ArchiveMemberSizeLimit')
        required = {'[Content_Types].xml', 'FixedDocumentSequence.fdseq', 'Document/FixedDocument.fdoc'}
        page_names = [name for name in names if re.fullmatch(r'Pages/[1-9]\d*\.xaml', name)]
        if not required.issubset(names) or not 1 <= len(page_names) <= 2000:
            raise ValueError('UnexpectedXPSLayout')
        positions = sorted(int(Path(name).stem) for name in page_names)
        if positions != list(range(1, len(page_names) + 1)):
            raise ValueError('NonsequentialXPSPages')
        if archive.testzip() is not None:
            raise ValueError('ArchiveCRCFailure')
        return {'entries': len(members), 'unencrypted': True, 'uncompressed_bytes': sum(item.file_size for item in members), 'xps_pages': len(page_names)}


def render_check(native, converted):
    results = []
    for index in sorted({0, native.page_count // 2, native.page_count - 1}):
        original = native[index].get_pixmap(matrix=fitz.Matrix(.5, .5), colorspace=fitz.csRGB, alpha=False)
        result = converted[index].get_pixmap(matrix=fitz.Matrix(.5, .5), colorspace=fitz.csRGB, alpha=False)
        if (original.width, original.height) != (result.width, result.height):
            raise ValueError('ConvertedRenderDimensionsDiffer')
        mean_error = sum(abs(a - b) for a, b in zip(original.samples, result.samples)) / max(1, len(original.samples))
        if mean_error > 8:
            raise ValueError('ConvertedRenderDifferenceRequiresReview')
        results.append({'page': index + 1, 'mean_absolute_rgb_difference': round(mean_error, 4), 'scale': .5})
    return results


def main_section(title):
    if not isinstance(title, str):
        return None
    title = ' '.join(title.casefold().split())
    for kind, pattern in [('lesson', r'lezione (10|[1-9])\s*\|.+'), ('workbook', r'esercizi lezione (10|[1-9])'), ('review', r'facciamo il punto ([1-4])')]:
        match = re.fullmatch(pattern, title)
        if match:
            return kind, int(match[1])
    if title == 'grammatica':
        return 'grammar', 0
    if title.startswith('intro') and 'mappa' in title:
        return 'intro', 0
    return None


def assemble_book(book_id, source, output, reader, conversions, records, reader_extent=None, extent_note=None):
    publisher_extent = {'nuovo-espresso-plus-1': 240, 'nuovo-espresso-plus-2': 264}.get(book_id)
    if reader_extent is not None and (type(reader_extent) is not int or not 1 <= reader_extent <= 2000 or not isinstance(extent_note, str) or not extent_note.strip() or len(extent_note) > 2000):
        raise ValueError('ReaderExtentRequiresBoundedExplicitNote')
    expected = reader_extent if reader_extent is not None else publisher_extent
    discrepancy = publisher_extent - expected if publisher_extent is not None and expected is not None else None
    required = {('intro', 0), ('grammar', 0)} | {(kind, number) for kind, count in [('lesson', 10), ('review', 4), ('workbook', 10)] for number in range(1, count + 1)}
    contents = reader.get('contents', []) if isinstance(reader, dict) else []
    selected = [(main_section(title), title) for title in contents if main_section(title)]
    section_map = {}
    for section in reader.get('sections', []) if isinstance(reader, dict) else []:
        key = main_section(section.get('title')) if isinstance(section, dict) else None
        if key:
            if key in section_map:
                raise ValueError('DuplicateMainSectionIdentifier')
            section_map[key] = section
    by_slug = {Path(item['source']).stem: item for item in conversions}
    text_by_source = {item['path']: item for item in records}
    report = {'bookId': book_id, 'status': 'incomplete', 'expected_pages': expected, 'expectedPublisherPages': publisher_extent, 'expectedReaderPages': expected, 'publisher_extent_discrepancy_pages': discrepancy, 'reader_extent_override': reader_extent is not None, 'extent_note': extent_note, 'scope': 'Main book only: intro/map, ten lessons, four checkpoints, ten workbook sections and grammar. Excludes videocorso, solutions and teacher guide.', 'printed_page_labels_verified': False}
    if expected is None or len(selected) != 26 or {key for key, _ in selected} != required:
        return {**report, 'reason': 'MainBookContentsInventoryIncomplete'}
    missing, ordered = [], []
    for key, title in selected:
        section = section_map.get(key, {})
        item = by_slug.get(section.get('slug'))
        if not item:
            missing.append(title)
        else:
            ordered.append((section, item))
    total = sum(item['pages'] for _, item in ordered)
    report.update({'available_sections': len(ordered), 'required_sections': 26, 'available_pages': total, 'missing_sections': missing})
    if missing or total != expected:
        return {**report, 'reason': 'MissingSections' if missing else 'MainBookPageCountMismatch'}
    filename = f'{book_id}-accessible-reader-book-{expected}-pages.pdf' if discrepancy else f'{book_id}-complete-book.pdf'
    target = confined(source / 'originals' / 'reader-native-pdf' / filename, source)
    fingerprint = hashlib.sha256(json.dumps([(item['source_sha256'], item['pdf_sha256'], item['pages']) for _, item in ordered]).encode()).hexdigest()
    if discrepancy:
        fingerprint = hashlib.sha256((fingerprint + '\n' + extent_note).encode()).hexdigest()
    previous = read_json(output / 'complete-book-manifest.json', output, {})
    reusable = isinstance(previous, dict) and previous.get('assembly_fingerprint') == fingerprint and target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == previous.get('sha256')
    offsets, pages, start = [], [], 1
    for section, item in ordered:
        offsets.append({'section': section['title'], 'section_slug': section['slug'], 'source': item['source'], 'section_pdf': item['pdf'], 'start_page': start, 'end_page': start + item['pages'] - 1, 'pages': item['pages']})
        for page in text_by_source[item['source']]['pages']:
            pages.append({**page, 'page': start + page['page'] - 1, 'section': section['slug'], 'section_page': page['page'], 'source': item['source']})
        start += item['pages']
    if not reusable:
        with fitz.open() as combined:
            for _, item in ordered:
                with fitz.open(confined(source / item['pdf'], source)) as section_pdf:
                    combined.insert_pdf(section_pdf)
            if combined.page_count != expected:
                raise ValueError('AssembledBookPageCountMismatch')
            title = f'{book_id} — complete accessible reader book ({expected} pages; publisher extent {publisher_extent})' if discrepancy else f'{book_id} — complete book (derived native XPS conversion)'
            subject = 'Main book assembled in reader contents order from standard unencrypted XPS conversions. Original archives retained privately. Printed page labels remain unverified.'
            if discrepancy:
                subject += f' Explicit extent discrepancy: {extent_note}'
            combined.set_metadata({'title': title, 'subject': subject})
            combined.set_toc([[1, item['section'], item['start_page']] for item in offsets])
            atomic_write(target, combined.tobytes(garbage=3, deflate=True), source)
    with fitz.open(target) as combined:
        if combined.page_count != expected:
            raise ValueError('SavedCompleteBookPageCountMismatch')
    report.update({'status': 'complete-accessible-reader' if discrepancy else 'complete', 'path': target.relative_to(source).as_posix(), 'pages': expected, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'assembly_fingerprint': fingerprint, 'derived_from': 'ordinary-unencrypted-reader-xps', 'section_offsets': offsets})
    text_report = {'bookId': book_id, 'derived_pdf': report['path'], 'derived_pdf_sha256': report['sha256'], 'expectedPublisherPages': publisher_extent, 'expectedReaderPages': expected, 'publisher_extent_discrepancy_pages': discrepancy, 'extent_note': extent_note, 'scope': 'Native text in assembled PDF physical page order. Section-local positions and source archives are retained. Printed labels require visual verification.', 'section_offsets': offsets, 'pages': pages}
    atomic_write(output / 'complete-book-pages.json', (json.dumps(text_report, ensure_ascii=False, indent=2) + '\n').encode('utf8'), output)
    return report


def extract(book_id: str, source: Path, output: Path, assemble=False, verbose=False, reader_extent=None, extent_note=None):
    # Library diagnostics may contain document internals; exceptions are
    # reported below with bounded reason codes instead of raw parser output.
    fitz.TOOLS.mupdf_display_errors(False)
    fitz.TOOLS.mupdf_display_warnings(False)
    fitz.set_messages(stream=io.StringIO())
    native_folder = confined(source / 'originals' / 'reader-native', source)
    pdf_folder = confined(source / 'originals' / 'reader-native-pdf', source)
    if not native_folder.is_dir():
        raise ValueError('NativeReaderFolderMissing')
    files = sorted(path for path in native_folder.iterdir() if path.suffix == '.bpdf')
    if not 1 <= len(files) <= 300:
        raise ValueError('ChooseBetweenOneAnd300NativeAssets')
    previous = read_json(output / 'conversion-manifest.json', output, {})
    old_files = {item['source']: item for item in previous.get('files', []) if isinstance(item, dict) and 'source' in item} if isinstance(previous, dict) else {}
    reader = read_json(source / 'reader-manifest.json', source, {})
    sections = {item['slug']: item for item in reader.get('sections', []) if isinstance(item, dict) and 'slug' in item} if isinstance(reader, dict) else {}
    records, conversions, failures = [], [], []
    for path in files:
        try:
            confined(path, native_folder)
            if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', path.stem) or len(path.stem) > 160 or path.stat().st_size > 500 * 1024 * 1024:
                raise ValueError('InvalidNativeAssetNameOrSize')
            payload = path.read_bytes()
            archive = validate_xps(payload)
            digest = hashlib.sha256(payload).hexdigest()
            relative = path.relative_to(source).as_posix()
            target = confined(pdf_folder / (path.stem + '.pdf'), source)
            old = old_files.get(relative, {})
            with fitz.open(stream=payload, filetype='xps') as native:
                if native.needs_pass or native.is_encrypted:
                    raise ValueError('EncryptedDocumentRejected')
                if native.page_count != archive['xps_pages']:
                    raise ValueError('NativePageCountMismatch')
                pages = [{'page': index + 1, 'method': 'native-xps-text', 'ocr_used': False, 'printed_page_label': None, 'needs_visual_review': len(re.sub(r'\W', '', page.get_text())) < 100, 'text': page.get_text().strip()} for index, page in enumerate(native)]
                reusable = old.get('source_sha256') == digest and target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == old.get('pdf_sha256')
                if not reusable:
                    with fitz.open(stream=native.convert_to_pdf(), filetype='pdf') as converted:
                        if converted.page_count != native.page_count:
                            raise ValueError('ConvertedPageCountMismatch')
                        checks = render_check(native, converted)
                        converted.set_metadata({'title': f'{book_id} — {path.stem} (native XPS conversion)', 'subject': 'Derived by standard conversion of an unencrypted XPS reader archive. Original retained. Section-local page positions; printed book labels unverified.'})
                        atomic_write(target, converted.tobytes(garbage=3, deflate=True), source)
                else:
                    checks = old.get('native_to_pdf_render_checks', [])
                with fitz.open(target) as converted:
                    if converted.page_count != native.page_count:
                        raise ValueError('SavedPDFPageCountMismatch')
                pdf_digest = hashlib.sha256(target.read_bytes()).hexdigest()
                section = sections.get(path.stem, {})
                expected = section.get('expectedPages')
                conversions.append({'source': relative, 'source_sha256': digest, 'source_bytes': len(payload), 'format': 'unencrypted-xps-archive', 'archive': archive, 'pdf': target.relative_to(source).as_posix(), 'pdf_sha256': pdf_digest, 'pdf_bytes': target.stat().st_size, 'pages': native.page_count, 'reader_expected_pages': expected, 'reader_page_count_matches': expected == native.page_count if expected is not None else None, 'native_to_pdf_render_checks': checks, 'printed_page_labels_verified': False})
                records.append({'path': relative, 'sha256': digest, 'derived_pdf': target.relative_to(source).as_posix(), 'derived_pdf_sha256': pdf_digest, 'pages': pages})
                if verbose:
                    print(json.dumps({'bookId': book_id, 'asset': path.stem, 'pages': native.page_count, 'native_text_characters': sum(len(page['text']) for page in pages), 'pdf_reused': reusable}), flush=True)
        except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
            reason = str(error) if type(error) is ValueError and re.fullmatch(r'[A-Za-z]{1,80}', str(error)) else type(error).__name__
            failures.append({'source': path.name, 'error': reason})
            print(json.dumps({'bookId': book_id, 'asset': path.stem, 'error': reason}), flush=True)
    changed = [path.name for path in files] != sorted(path.name for path in native_folder.iterdir() if path.suffix == '.bpdf')
    manifest = {'bookId': book_id, 'method': 'Standard PyMuPDF XPS conversion and native text extraction; no decryption, OCR, or archive extraction.', 'scope': 'Only files present in this snapshot of originals/reader-native. Each PDF retains section-local page order. Printed textbook labels require verification.', 'source_listing_changed_during_processing': changed, 'files': conversions, 'failures': failures}
    if assemble:
        assembled = assemble_book(book_id, source, output, reader, conversions, records, reader_extent, extent_note)
        manifest['complete_book'] = assembled
        atomic_write(output / 'complete-book-manifest.json', (json.dumps(assembled, ensure_ascii=False, indent=2) + '\n').encode('utf8'), output)
    changed = [path.name for path in files] != sorted(path.name for path in native_folder.iterdir() if path.suffix == '.bpdf')
    manifest['source_listing_changed_during_processing'] = changed
    atomic_write(output / 'source-pages.json', (json.dumps(records, ensure_ascii=False, indent=2) + '\n').encode('utf8'), output)
    atomic_write(output / 'conversion-manifest.json', (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf8'), output)
    print(json.dumps({'bookId': book_id, 'converted_assets': len(conversions), 'pages': sum(item['pages'] for item in conversions), 'failures': len(failures), 'source_listing_changed_during_processing': changed, 'complete_book_status': manifest.get('complete_book', {}).get('status'), 'report': (output / 'source-pages.json').relative_to(ROOT).as_posix()}))
    return bool(failures)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--book-id', required=True)
    parser.add_argument('--assemble-book', action='store_true', help='Assemble the main book only when all 26 sections and exact expected page count are verified')
    parser.add_argument('--expected-reader-pages', type=int, help='Explicit accessible-reader extent when it differs from the publisher listing; requires --extent-note')
    parser.add_argument('--extent-note', help='Evidence and limits of an explicitly accepted reader/publisher extent discrepancy')
    parser.add_argument('--verbose', action='store_true', help='Print per-asset conversion summaries')
    args = parser.parse_args()
    if len(args.book_id) > 160 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.book_id):
        parser.error('Choose a stable bounded book identifier.')
    if args.expected_reader_pages is not None and (not args.assemble_book or not 1 <= args.expected_reader_pages <= 2000 or not args.extent_note or not args.extent_note.strip() or len(args.extent_note) > 2000):
        parser.error('An explicit reader extent requires --assemble-book, a bounded page count and --extent-note.')
    try:
        source = confined(BOOKS / args.book_id, BOOKS)
        output = confined(INCOMING / args.book_id / 'native', INCOMING)
        output.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(confined(output / '.extract.lock', output), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'a+b') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                parser.error('A native extraction of this book is already running.')
            return extract(args.book_id, source, output, args.assemble_book, args.verbose, args.expected_reader_pages, args.extent_note)
    except (OSError, ValueError) as error:
        parser.error(str(error) if type(error) is ValueError else 'A private study file could not be accessed.')


if __name__ == '__main__':
    raise SystemExit(main())

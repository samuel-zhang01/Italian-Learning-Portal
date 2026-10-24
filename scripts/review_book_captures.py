"""OCR checksum-verified reader captures into private text and searchable PDFs."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / 'materials' / 'books'
INCOMING = ROOT / 'data' / 'incoming' / 'books'
OCR_VERSION = 'rendered-page-ocr-v2:ita+eng'


def confined(path: Path, base: Path):
    if not path.is_relative_to(base) or path.resolve() != path:
        raise ValueError('Study paths must remain in regular private folders without symlinks.')
    return path


def optional_json(path: Path, base: Path):
    confined(path, base)
    if not path.is_file():
        return {}
    if path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError('Private report exceeds the bounded review size.')
    try:
        return json.loads(path.read_text(encoding='utf8'))
    except (json.JSONDecodeError, UnicodeError):
        return {}


def atomic_json(path: Path, value):
    confined(path, INCOMING)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--book-id', required=True)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--pdf', action='store_true', help='Also assemble searchable PDFs for captured sections')
    args = parser.parse_args()
    if len(args.book_id) > 160 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.book_id):
        parser.error('Use a stable book folder identifier.')
    try:
        source = confined(BOOKS / args.book_id, BOOKS)
        output = confined(INCOMING / args.book_id, INCOMING)
        output.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock_path = confined(output / '.review.lock', output)
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'a+b') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                parser.error('A review of this book is already running; retry when it finishes.')
            return review_snapshot(args, parser, source, output)
    except (ValueError, OSError):
        parser.error('Invalid manifest or a study path outside the regular private folders.')


def review_snapshot(args, parser, source: Path, output: Path):
    manifest_path = source / 'reader-manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > 5 * 1024 * 1024:
        parser.error('A regular reader manifest is required.')
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or manifest.get('bookId') != args.book_id:
        parser.error('Manifest belongs to another book.')
    if not isinstance(manifest.get('title'), str) or not manifest['title'].strip() or len(manifest['title']) > 300:
        parser.error('A bounded book title is required.')
    sections = manifest.get('sections', [])
    if not isinstance(sections, list) or len(sections) > 300:
        parser.error('Use a bounded list of reader sections.')
    previous_report = optional_json(output / 'reader-pages.json', output)
    previous_pdfs = optional_json(output / 'searchable-pdfs.json', output)
    old_pages = previous_report.get('pages', []) if isinstance(previous_report, dict) else []
    old_pages = old_pages if isinstance(old_pages, list) else []
    old_pdfs = {item['path']: item for item in previous_pdfs if isinstance(item, dict) and 'path' in item} if isinstance(previous_pdfs, list) else {}
    jobs, slugs, images = [], set(), set()
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get('slug'), str) or len(section['slug']) > 160 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', section['slug']) or section['slug'] in slugs:
            parser.error('Invalid section folder.')
        slugs.add(section['slug'])
        if not isinstance(section.get('title'), str) or len(section['title']) > 300 or not isinstance(section.get('pages', []), list):
            parser.error('Invalid section metadata.')
        expected = section.get('expectedPages')
        if expected is not None and (type(expected) is not int or not 1 <= expected <= 2000):
            parser.error('Invalid expected section page count.')
        numbers = set()
        for page in section.get('pages', []):
            if not isinstance(page, dict) or type(page.get('page')) is not int or not 1 <= page['page'] <= 2000 or page['page'] in numbers:
                parser.error('Page positions must be bounded and unique within each section.')
            numbers.add(page['page'])
            if not isinstance(page.get('file'), str) or len(page['file']) > 400 or not isinstance(page.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', page['sha256']):
                parser.error('Invalid capture path or checksum.')
            image = confined(source / page['file'], source / 'pages')
            if not image.is_file() or image.suffix != '.png' or image in images or not 0 < image.stat().st_size <= 50 * 1024 * 1024:
                parser.error('Capture path is outside the book page folder.')
            images.add(image)
            if page.get('bytes', image.stat().st_size) != image.stat().st_size:
                parser.error('A reader capture byte count changed.')
            if hashlib.sha256(image.read_bytes()).hexdigest() != page['sha256']:
                parser.error('A reader capture checksum changed; recapture before reviewing.')
            prefix = output / 'ocr' / section['slug'] / f"page-{page['page']:03d}"
            confined(prefix, output)
            for suffix in ['.json', '.txt', '.pdf']:
                confined(prefix.with_suffix(suffix), output)
            jobs.append((section, page, image, prefix))
            if len(jobs) > 2000:
                parser.error('Choose at most 2000 captured pages.')
    if not 1 <= len(jobs) <= 2000:
        parser.error('Choose a reader manifest with between 1 and 2000 captured pages.')

    def review_page(job):
        section, page, image, prefix = job
        prefix.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        cache = prefix.with_suffix('.json')
        cached = optional_json(cache, output)
        cached = cached if isinstance(cached, dict) else {}
        text_path = prefix.with_suffix('.txt')
        pdf_path = prefix.with_suffix('.pdf')
        payload = image.read_bytes()
        if len(payload) > 50 * 1024 * 1024 or hashlib.sha256(payload).hexdigest() != page['sha256'] or not payload.startswith(b'\x89PNG\r\n\x1a\n'):
            return {'section': section['slug'], 'page': page['page'], 'error': 'CaptureChecksumOrFormatChanged'}
        suffixes = ['.txt'] + (['.pdf'] if args.pdf else [])
        artifacts = cached.get('artifacts', {})
        reusable = cached.get('sha256') == page['sha256'] and cached.get('ocr_version') == OCR_VERSION and isinstance(artifacts, dict)
        for suffix in suffixes:
            artifact = confined(prefix.with_suffix(suffix), output)
            metadata = artifacts.get(suffix, {}) if isinstance(artifacts, dict) else {}
            reusable = reusable and isinstance(metadata, dict) and artifact.is_file() and artifact.stat().st_size == metadata.get('bytes') and hashlib.sha256(artifact.read_bytes()).hexdigest() == metadata.get('sha256')
        if not reusable:
            # Tesseract sees only this checksum-verified study image, never a browser profile.
            with tempfile.TemporaryDirectory(prefix='.ocr-work-', dir=prefix.parent) as temporary:
                target = Path(temporary) / 'page'
                snapshot = Path(temporary) / 'capture.png'
                snapshot.write_bytes(payload)
                try:
                    result = subprocess.run(['tesseract', str(snapshot), str(target), '-l', 'ita+eng', 'txt'] + (['pdf'] if args.pdf else []), capture_output=True, timeout=180)
                except (OSError, subprocess.SubprocessError) as error:
                    return {'section': section['slug'], 'page': page['page'], 'error': type(error).__name__}
                if result.returncode:
                    return {'section': section['slug'], 'page': page['page'], 'error': 'OCRFailed'}
                artifacts = {}
                for suffix in suffixes:
                    contents = target.with_suffix(suffix).read_bytes()
                    with tempfile.NamedTemporaryFile(dir=prefix.parent, delete=False) as handle:
                        handle.write(contents)
                        temporary_output = Path(handle.name)
                    temporary_output.replace(prefix.with_suffix(suffix))
                    artifacts[suffix] = {'sha256': hashlib.sha256(contents).hexdigest(), 'bytes': len(contents)}
            atomic_json(cache, {'sha256': page['sha256'], 'ocr_version': OCR_VERSION, 'artifacts': artifacts})
        text = text_path.read_text()
        return {'section': section['slug'], 'section_title': section['title'], 'page': page['page'], 'capture': page['file'], 'sha256': page['sha256'], 'method': 'rendered-page-ocr', 'ocr_unverified': True, 'printed_page_label': None, 'needs_visual_review': len(re.sub(r'\W', '', text)) < 100, 'text': text.strip()}

    def review(job):
        try:
            return review_page(job)
        except (OSError, UnicodeError, ValueError, subprocess.SubprocessError) as error:
            section, page, _, _ = job
            return {'section': section['slug'], 'page': page['page'], 'error': type(error).__name__}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        records = list(pool.map(review, jobs))
    report = {'bookId': args.book_id, 'title': manifest['title'], 'source_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(), 'source_manifest_updated_at': manifest.get('updatedAt'), 'scope': 'Only captures listed in this reader-manifest snapshot; these are not publisher PDF originals. OCR may contain errors. Positions are section-local; printed book labels require visual verification.', 'pages': records}
    generated = []
    if args.pdf:
        import pymupdf as fitz
        for section in sections:
            pages = [item for item in records if item['section'] == section['slug']]
            if not pages or any('error' in item for item in pages):
                continue
            folder = confined(source / 'originals' / 'reader-captures', source)
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            target = confined(folder / f"{section['slug']}.pdf", source)
            relative = target.relative_to(source).as_posix()
            previous = old_pdfs.get(relative, {})
            fingerprints = sorted((item['page'], item['sha256']) for item in pages)
            old_fingerprints = sorted((item['page'], item['sha256']) for item in old_pages if isinstance(item, dict) and item.get('section') == section['slug'] and 'error' not in item)
            unchanged = fingerprints == old_fingerprints and target.is_file() and previous.get('pages') == len(pages) and hashlib.sha256(target.read_bytes()).hexdigest() == previous.get('sha256')
            if unchanged:
                try:
                    with fitz.open(target) as existing:
                        unchanged = existing.page_count == len(pages)
                except (RuntimeError, ValueError):
                    unchanged = False
            if unchanged:
                expected = section.get('expectedPages')
                generated.append({**previous, 'section_slug': section['slug'], 'bytes': target.stat().st_size, 'section_complete': section.get('status') == 'captured' and [item['page'] for item in sorted(pages, key=lambda item: item['page'])] == list(range(1, (expected or 0) + 1)), 'ocr_unverified': True, 'printed_page_labels_verified': False})
                continue
            document = fitz.open()
            for page in sorted(pages, key=lambda item: item['page']):
                with fitz.open(output / 'ocr' / section['slug'] / f"page-{page['page']:03d}.pdf") as single:
                    if single.page_count != 1:
                        parser.error('Each reader capture must produce exactly one searchable PDF page.')
                    document.insert_pdf(single)
            with tempfile.NamedTemporaryFile(dir=folder, suffix='.pdf', delete=False) as handle:
                temporary = Path(handle.name)
            try:
                document.set_metadata({'title': f"{manifest['title']} — {section['title']} (reader captures)", 'subject': 'Derived searchable PDF from rendered reader captures; OCR unverified; section-local positions; printed book labels unverified'})
                document.save(temporary, garbage=3, deflate=True)
                temporary.replace(target)
            finally:
                document.close()
                temporary.unlink(missing_ok=True)
            expected = section.get('expectedPages')
            generated.append({'section': section['title'], 'section_slug': section['slug'], 'path': relative, 'pages': len(pages), 'expected_pages': expected, 'section_complete': section.get('status') == 'captured' and [item['page'] for item in sorted(pages, key=lambda item: item['page'])] == list(range(1, (expected or 0) + 1)), 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'derived_from': 'rendered-reader-captures', 'ocr_unverified': True, 'printed_page_labels_verified': False})
        atomic_json(output / 'searchable-pdfs.json', generated)
    report['manifest_changed_during_review'] = manifest_path.read_bytes() != manifest_bytes
    atomic_json(output / 'reader-pages.json', report)
    failures = sum('error' in item for item in records)
    print(json.dumps({'bookId': args.book_id, 'reviewed_captures': len(records), 'ocr_failures': failures, 'sparse_pages': sum(item.get('needs_visual_review', False) for item in records), 'searchable_pdfs': len(generated), 'complete_sections': sum(item['section_complete'] for item in generated), 'manifest_changed_during_review': report['manifest_changed_during_review'], 'report': (output / 'reader-pages.json').relative_to(ROOT).as_posix()}))
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())

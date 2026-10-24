"""Synthetic checks for private PDF assembly; no real book text is used."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import pymupdf as fitz

MODULE = Path(__file__).resolve().parents[1] / 'scripts' / 'export_book_pdfs.py'
SPEC = importlib.util.spec_from_file_location('book_pdf_exports', MODULE)
exports = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exports)


class ExportPDFTests(unittest.TestCase):
    def setUp(self):
        exports.EXPORTS.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='_synthetic-test-', dir=exports.EXPORTS)
        self.folder = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def source(self, name, text):
        path = self.folder / name
        with fitz.open() as document:
            page = document.new_page()
            page.insert_text((50, 50), text)
            page.insert_link({'kind': fitz.LINK_URI, 'uri': 'https://example.invalid', 'from': fitz.Rect(50, 70, 200, 100)})
            document.set_toc([[1, 'Source section', 1]])
            document.save(path)
        return exports.record(path, pages=1)

    def name(self, value):
        return (self.folder / value).relative_to(exports.EXPORTS).as_posix()

    def test_composed_packs_keep_page_order_and_nested_bookmarks_without_changing_inputs(self):
        first, second = self.source('first.pdf', 'First source'), self.source('second.pdf', 'Second source')
        exporter = exports.Exporter()
        pack = exporter.assembled(self.name('pack.pdf'), 'Pack', [{'title': 'First', 'files': [first]}, {'title': 'Second', 'files': [second]}], 2)
        # Own export records contain a bookmark count; source outlines are read
        # from their PDF when that export becomes an input to another pack.
        combined = exporter.assembled(self.name('combined.pdf'), 'Combined', [{'title': 'Reference', 'files': [pack]}], 2)
        with fitz.open(exports.ROOT / combined['path']) as document:
            self.assertEqual(document.page_count, 2)
            self.assertIn('First source', document[0].get_text())
            self.assertIn('Second source', document[1].get_text())
            self.assertGreaterEqual(len(document.get_toc()), 5)
            self.assertTrue(all(not page.get_links() for page in document))
            exports.pdf_safety(document)
        self.assertEqual(exports.digest(exports.ROOT / first['path']), first['sha256'])
        self.assertEqual(exports.digest(exports.ROOT / second['path']), second['sha256'])

    def test_exact_copy_and_bad_evidence_or_symlinks(self):
        source = self.source('source.pdf', 'Synthetic content')
        exporter = exports.Exporter()
        copy = exporter.copied(source, self.name('renamed.pdf'), 'student-copy', exports.EXPORTS)
        self.assertEqual(copy['sha256'], source['sha256'])
        self.assertEqual((exports.ROOT / copy['path']).read_bytes(), (exports.ROOT / source['path']).read_bytes())
        with self.assertRaises(ValueError):
            exporter.verify({**source, 'sha256': '0' * 64}, exports.EXPORTS)
        link = self.folder / 'link.pdf'
        link.symlink_to(exports.ROOT / source['path'])
        with self.assertRaises(ValueError):
            exports.private(link, exports.EXPORTS)

    def test_active_pdf_catalog_actions_are_rejected(self):
        with fitz.open() as document:
            document.new_page()
            action = document.get_new_xref()
            document.update_object(action, '<< /S /JavaScript /JS (void 0) >>')
            document.xref_set_key(document.pdf_catalog(), 'OpenAction', f'{action} 0 R')
            with self.assertRaises(ValueError):
                exports.pdf_safety(document)

    def test_unicode_wrapping_retains_every_nonspace_character(self):
        font = fitz.Font(fontfile=str(exports.FONT))
        text = 'È già qui: città, perché, università.\nUna frase abbastanza lunga con parole semplici.'
        lines = exports.wrapped_lines(text, font, 10.5, 100)
        self.assertEqual(exports.compact(''.join(lines)), exports.compact(text))
        self.assertTrue(all(font.text_length(line, fontsize=10.5) <= 100.01 for line in lines))


if __name__ == '__main__':
    unittest.main()

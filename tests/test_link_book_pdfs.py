"""Synthetic navigation checks; no copyrighted source text is used."""
from pathlib import Path
import sys
import tempfile
import unittest

import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import link_book_pdfs as nav


class LinkedPDFTests(unittest.TestCase):
    def setUp(self):
        nav.base.EXPORTS.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='_navigation-test-', dir=nav.base.EXPORTS)
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def source(self):
        source = self.folder / 'source.pdf'
        with fitz.open() as document:
            for value in ['First lesson', 'Workbook exercise', 'Transcript', 'Unmapped guide']:
                page = document.new_page(width=595, height=842)
                page.insert_text((40, 50), value)
                page.draw_rect(fitz.Rect(0, 800, 595, 842), fill=(0.5, 0.2, 0.1))
                page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(40, 60, 200, 80), 'uri': 'https://example.invalid'})
            document.set_toc([[1, 'Student book', 1], [2, 'Lezione 1 | Example', 1],
                              [2, 'Esercizi LEZIONE 1', 2], [1, 'Transcripts', 3],
                              [2, 'Track 99.pdf', 3], [1, 'Teacher guide', 4]])
            document.save(source)
        return source

    def test_round_trip_targets_source_pixels_and_text_and_page_numbers(self):
        source = self.source()
        before = nav.base.digest(source)
        contexts = [('plus-1', (1,))] * 3 + [('plus-1', ())]
        target = self.folder / 'linked.pdf'
        result = nav.build(source, target, contexts, 'Synthetic study pack')
        self.assertEqual(result['contentsPage'], 5)
        self.assertEqual(result['lessonMenus'], 1)
        with fitz.open(source) as original, fitz.open(target) as linked:
            for number in range(4):
                old, new = original[number], linked[number]
                self.assertEqual(old.get_text(), new.get_text(clip=old.rect))
                # Even source content at the bottom edge stays pixel-identical.
                self.assertEqual(old.get_pixmap().samples, new.get_pixmap(clip=old.rect).samples)
                self.assertEqual(new.rect.height, old.rect.height + nav.FOOTER)
                links = new.get_links()
                self.assertEqual(links[0]['page'], 4)
                self.assertGreaterEqual(links[0]['from'].y0, old.rect.height)
            lesson_hub = linked[0].get_links()[1]['page']
            targets = {link['page'] for link in linked[lesson_hub].get_links()}
            self.assertTrue({0, 1, 2}.issubset(targets))
            self.assertNotIn(3, targets)
            self.assertEqual(len(linked[3].get_links()), 1)
            self.assertTrue(all(link['kind'] == fitz.LINK_GOTO for page in linked for link in page.get_links()))
            self.assertEqual(nav.validate(linked), result['internalLinks'])
            for entry in original.get_toc():
                self.assertIn(entry, linked.get_toc())
        self.assertEqual(nav.base.digest(source), before)

    def test_shared_transcripts_are_in_each_verified_lesson_menu(self):
        contexts = [('plus-1', (1, 2)), ('plus-2', (1,))]
        menus, hubs = nav.navigation_plan([[1, 'Shared transcript', 1], [1, 'Other book', 2]], contexts, 'Combined')
        self.assertEqual(set(hubs), {('plus-1', 1), ('plus-1', 2), ('plus-2', 1)})
        for key in [('plus-1', 1), ('plus-1', 2)]:
            menu = next(menu for menu in menus if menu['start'] == hubs[key])
            self.assertEqual(menu['rows'][0]['target'], 0)

    def test_paginated_menus_all_link_back_and_forward_and_cover_every_row(self):
        contexts = [('plus-1', (1,))] * 60
        with fitz.open() as document:
            for _ in contexts:
                document.new_page(width=595, height=842)
            document.set_toc([[1, f'Lezione 1 activity {number}', number] for number in range(1, 61)])
            result = nav.add_navigation(document, contexts, 'Many activities')
            # Reopen to inspect newly written annotations.
            with fitz.open(stream=document.tobytes(), filetype='pdf') as saved:
                nav.validate(saved)
                for page in list(saved)[60:]:
                    self.assertIn(60, {link['page'] for link in page.get_links()})
                self.assertGreater(result['navigationPages'], 6)
                toc_start = next(item[2] - 1 for item in saved.get_toc() if item[1] == 'All sections / Tutte le sezioni')
                targets = {link['page'] for number in range(toc_start, len(saved)) for link in saved[number].get_links()}
                self.assertTrue(set(range(60)).issubset(targets))

    def test_group_headings_do_not_inherit_first_child_lesson(self):
        entries = nav.entries_from_toc([[1, 'All transcripts', 1], [2, 'Track 500.pdf', 1]], [('plus-1', (2,))])
        self.assertEqual(entries[0]['lessons'], ())
        self.assertEqual(entries[1]['lessons'], (2,))
        self.assertIsNone(nav.lesson_number('NEPLUS1_01-1.pdf'))
        self.assertIsNone(nav.lesson_number('Facciamo il punto 1'))
        self.assertEqual(nav.lesson_number('Esercizi LEZIONE 10'), 10)
        self.assertIsNone(nav.lesson_number('Lezione 100'))

    def test_external_links_invalid_destinations_and_unsupported_geometry_fail(self):
        with fitz.open(self.source()) as document:
            with self.assertRaises(ValueError):
                nav.validate(document)
        with fitz.open() as document:
            document.new_page(width=595, height=842).set_rotation(90)
            document.set_toc([[1, 'Section', 1]])
            with self.assertRaises(ValueError):
                nav.add_navigation(document, [('plus-1', ())], 'Rotated')
        with self.assertRaises(ValueError):
            nav.entries_from_toc([[1, 'Outside PDF', 2]], [('plus-1', ())])

    def test_provenance_ranges_and_shared_resource_associations(self):
        sources = nav.Sources.__new__(nav.Sources)
        sources.book_ids = ['plus-1']
        sources.cache = {}
        sources.native = {'plus-1': [{'section': 'Lezione 1', 'start_page': 1, 'end_page': 2, 'pages': 2}]}
        sources.media_lessons = {'private/interactive/media/track.pdf': {1, 2}}
        student = {'path': 'plus-1-student.pdf', 'category': 'byte-exact-student-book', 'pages': 2, 'sha256': 'a'}
        pack = {'path': 'plus-1-pack.pdf', 'pages': 3, 'offsets': [
            {'source': student['path'], 'sourceSHA256': 'a', 'startPage': 1, 'endPage': 2, 'pages': 2},
            {'source': 'private/interactive/media/track.pdf', 'startPage': 3, 'endPage': 3, 'pages': 1}]}
        sources.records = {student['path']: student}
        self.assertEqual(sources.contexts(pack), [('plus-1', (1,)), ('plus-1', (1,)), ('plus-1', (1, 2))])
        pack['path'] = 'plus-1-invalid.pdf'
        pack['offsets'][0]['sourceSHA256'] = 'wrong'
        with self.assertRaises(ValueError):
            sources.contexts(pack)


if __name__ == '__main__':
    unittest.main()

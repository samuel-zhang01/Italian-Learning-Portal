# Private archive companions

The private study archive has bilingual companions beside its original files. Open
`Organised/Companion_Index_EN-IT.html` to browse them and `Organised/vocab.csv` for
the simple Italian, word type and English meaning list.

The 12 November 2026 review covers 70 native files: 67 teaching/reference files
and three administrative documents. There are 168 companions: 70 PDFs, 70 HTML
guides, 13 presentations, 14 Word documents and one workbook. The teaching
coverage includes 1,037 source pages/slides and 413 explained exercise items or
groups. The vocabulary CSV has 2,900 unique word/meaning entries.

Original files and their names are preserved so existing source references keep
working. Every native PDF, presentation, Word document and workbook receives a
PDF and searchable HTML guide. Presentations, Word documents and the glossary
also receive a companion in their native format. The original pages are
interleaved with English and Italian explanations, exercise methods, new worked
examples, self-checks and a complete file glossary. Grammar references appear
once at the end of each guide. Native presentation annotations remain editable;
the original slides are retained as images, and the original decks remain
available. The hotel deck's supplied video is embedded in its native companion.

Independent homework uses parallel examples with different details. Missing
external audio and source ambiguities are identified; they are not replaced with
invented transcripts or answer keys. Administrative documents receive a short
reference note. Certificate contents are neither copied nor analysed. Older
generated HTML notes are listed separately from verified class sources.

The reviewed content and checksum inventory live under ignored
`data/incoming/archive-companions/`. Rendering caches and visual QA stay under
ignored `work/archive-companions/`. All generated study files stay under ignored
`Organised/`. None of these directories belongs in `site-dist/` or Git.

The private renderers use an isolated runtime:

```bash
python3 -m pip install --target work/archive-companions/python-runtime -r scripts/archive-companion-requirements.txt
npm install --prefix work/archive-companions/node-runtime --no-package-lock pptxgenjs@4.0.1
python3 scripts/build_archive_companions.py --resume
python3 scripts/build_archive_vocabulary.py
python3 scripts/check_archive_companions.py --native --resume --index
```

The QA helper uses the installed PPTX skill's LibreOffice wrapper and validator.
It verifies original checksums, complete page coverage, both exercise languages,
interleaved source text, output hashes and page bounds. It renders every native
Office companion and produces contact sheets for every presentation slide.
Visual inspection of those images remains a separate required step.

All 13 final presentation decks passed schema, rendering, text-retention and
visual checks, covering 2,851 slides. All 14 Word companions opened and rendered.
Original checksums, workbook cells and embedded video bytes were preserved.
The index and a representative HTML guide passed seven phone/desktop layout
checks; all index links resolved. The retained evidence is
`data/incoming/archive-companions/final-acceptance.json`, with detailed visual
audits under that private folder and `work/archive-companions/`.

The material-review helper excludes generated `__Companion_EN-IT` files from
future source imports. Its archive selection matches the 66 original teaching
PDF/PPTX/DOCX files; the vocabulary builder reads the workbook directly.

Source images retain inherited table clipping and overlapping headings. The
companion's separate grammar references remain readable. Vocabulary references
can contain general dictionary senses; the review does not claim that every
possible contextual sense was manually checked.

Rebuilding replaces generated companions. Back up any personal edits to those
generated files first; original class documents are never changed. Resume only
reuses outputs whose content, renderer, grammar references and hashes match.

---
name: new-material
description: Review new Italian class PDFs or presentations in this repository and extend Parliamo’s bilingual daily lessons, source catalogue and learning path. Use for /new-material, a new lesson upload, or a requested source refresh in the Italian Learning Portal. Not a general PDF summarizer or homework answer generator.
---

# New Italian material

Work in this repository (identified by `app/learning/curriculum.json`). The portal helps the learner use and remember their class material. It is a companion, not a copy of the PDFs. Preserve this purpose when a new lesson changes the course direction.

## Read the material before designing practice

New files normally arrive in `materials/inbox/`; the existing archive is under `Organised/Organised/`. These folders are private and Git-ignored. Never publish the archive, extracted text, class member details, or course certificates. Do not scan outside the explicitly supplied study folder.

Run `python3 scripts/review_materials.py --source materials/inbox` (or a bounded course subfolder). The helper writes page-preserving extracts and checksums under ignored `data/incoming/`. It does not modify the curriculum. Read the relevant pages, not just filenames. Low-text pages are flagged; rerun with `--ocr` when needed, then visually inspect unclear tables or images. PDF indexes count from the first physical page, including covers and blank pages. Presentation references use slide numbers. For presentations, apply the available pptx skill.

Use the actual edition and sequence. The current sources use **Nuovo Espresso Plus 1** for Courses 1–2 and introduce **Plus 2** for Course 3. Do not carry over the original-edition page plan in `app/study-plan.ts`. A syllabus listing a topic is not proof that a supplied lesson teaches it. Distinguish class source material from generated companion notes, OCR guesses and original portal explanations. Preserve independent homework; create parallel practice with new details instead of filling in submitted assignments.

## Extend the learning journey

The maintained daily app is `app/learning/portal.tsx`; curriculum data is `app/learning/curriculum.json`, its types are in `types.ts`, and scheduling/persistence are in `engine.ts`. `app/legacy-portal.tsx`, the database seed and the old 56-day plan are retained historical/local features, not the public daily course.

Add or refine small missions that teach one usable outcome in approximately five minutes:

- A clear goal and short explanation in both English and Italian.
- At least two original examples and useful vocabulary, each translated.
- Two bounded recall questions with accepted answers and useful bilingual feedback.
- A distinct delayed-recall question and a short personal-production prompt.
- A possible original answer and two self-check criteria. Production is self-assessed, not claimed as automatically graded.
- Exact source file IDs and verified pages/slides. The source catalogue records filename, relative path, course, SHA-256 and physical page count.

Read adjacent lessons to choose prerequisites and placement. Extend the relevant course; revise planning filters/types if a new course number is needed. Avoid padding the journey with duplicate revision disguised as new material. Keep IDs stable: browser progress, drafts and review schedules depend on them. Existing backups must continue to load; if a schema change is necessary, implement and test an explicit migration. Never erase progress to fit new content. Record covered topics and any remaining source gaps in `docs/material-review.json`.

The UI switches fully between EN and IT; examples can also show English translations. Avoid adding English-only feedback or Italian-only navigation. Questions requiring Italian should retain Italian target text in either UI language. Check accents, agreement, auxiliary choice and reasonable answer variants. Never normalize `è` to `e`.

## Validate the actual student journey

Run `npm run typecheck`, `npm run test:daily`, `npm run build:daily` and the repository’s maintained checks when their inputs change. Check the new lesson in both languages, at phone width, with a wrong answer and a reload mid-lesson. Verify completion, source references, notebook evidence and delayed recall. The reusable browser audit is `scripts/audit_learning_browser.mjs` (requires browser-view); it uses isolated test data. Record actual findings and fixes in `docs/student-audit.json`, separating tested paths from limitations.

Finish with the lesson/source changes and verification results. Deploy only when the current task or persistent session authorization includes publishing. For the requested custom domain, follow the repository README’s daily-site deployment notes and the authenticate skill. Publish only `site-dist/`, never the repository root or private materials. Preserve the separate historical Sites identity in `.openai/hosting.json`.

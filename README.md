# Parliamo

A little Italian, every day. Parliamo turns the supplied class materials into short, original practice: notice an idea, retrieve it, then use it in your own Italian.

Production: **https://italian.samuelzhang.co.uk**

## Learn

- **36 five-minute lessons** across foundations, everyday Italian and the two supplied Level 2 revision lessons.
- Fully switchable English and Italian navigation, explanations, feedback and planning. English example translations can be hidden independently.
- Two recall checks per lesson, an original writing/speaking prompt and a self-check. First attempts remain visible after corrections; writing is self-assessed, not automatically graded.
- A flexible **5, 10 or 15 minute** daily budget, chosen study days and a rolling seven-day plan. Missed days do not create a penalty or erase work.
- Delayed recall after one day, then three, seven and fourteen days when successful. A missed recall returns the following day. Reviews count as two estimated minutes; lessons count as five. These are effort estimates, not measured time.
- A notebook of the learner’s own Italian, browser-local progress, mid-lesson drafts, and validated JSON backup export/import.
- Exact file/page references and optional local PDF connections. Connected PDFs are opened locally and are never uploaded.

The portal is a companion to the PDFs, not a worksheet clone or a completed homework service. Original class assignments requiring independent work remain for the student to complete. The material review identified **Nuovo Espresso Plus 1** in Courses 1–2 and **Plus 2** in Course 3; the old original-edition textbook page plan is no longer the main journey.

## Run locally

Node.js 22.22 or newer:

```bash
npm ci
npm run dev:daily
```

Open http://127.0.0.1:3000. The daily app is a static React/Vite site and needs no accounts, API keys or database.

```bash
npm run typecheck
npm run test:daily
npm run lint
npm run build:daily
```

`site-dist/` is the complete deployable daily site. Only that directory should be published. It contains no course PDFs, extracted source text, credentials, database or learner records.

The maintained Vinext commands (`npm run local`, `npm run build`, `npm test`) also remain available. They now render the daily portal at the root. Historical practice code is retained in `app/legacy-portal.tsx`, `app/study-plan.ts`, `db/` and `drizzle/`; the legacy database APIs are **not deployed** on the public static host. The older Sites project in `.openai/hosting.json` is a separate publication and is not modified by the custom-domain deployment.

## Saving and privacy

Progress is stored under `parliamo-daily-v1` in this browser’s localStorage. No account or progress API is used by the daily app. Different browsers and origins have separate progress; clearing site data removes it. Export a backup from **Progress** to move or preserve it, then restore it on the other device. Imports are validated and require an explicit replacement action in the UI.

If browser storage is unavailable, an explicit warning appears and the current session can continue in memory. A corrupt stored record is preserved for recovery instead of overwritten. Existing legacy localStorage and `.wrangler/state/` learner databases are untouched; they are not automatically translated into the new scoring system. Preserve `backups/local-data/` and the existing local launcher’s backups.

Listening uses the browser/device speech service with `it-IT`, when available. It is synthetic pronunciation support, not recorded class audio or an assessed listening exam. Writing and speaking checklists are self-assessments, not certification of fluency or CEFR level.

## Add another lesson PDF

Put new files in **`materials/inbox/`**, then invoke **`/new-material`** or **`$new-material`** in this repository. The repository-scoped skill is [`.agents/skills/new-material/SKILL.md`](.agents/skills/new-material/SKILL.md). A client may need to rescan repository skills before listing a newly added skill; naming its file directly also works.

The skill reads the actual material, checks its edition and place in the course, creates original bilingual micro-lessons, preserves progress IDs, verifies the journey, and publishes only when the active request authorizes deployment. Dropping a PDF does not silently modify the course.

The page-preserving helper requires Poppler (`pdftotext`). OCR additionally uses Tesseract with Italian/English language data and, for presentations, LibreOffice:

```bash
python3 scripts/review_materials.py --source materials/inbox
python3 scripts/review_materials.py --source materials/inbox --ocr
```

Reports go to ignored `data/incoming/source-pages.json`; low-text or OCR pages are flagged for visual checking. The helper accepts only study folders under this repository’s `materials/` or `Organised/`, skips hidden files, symlinks and course-admin folders, and leaves existing reports intact for an empty inbox. The earlier `scripts/audit_course_archive.py` remains available for broader document inventory.

## Validation and audits

- `tests/learning.test.mjs` checks source bounds, translation coverage, Italian accent handling, scheduling, recall scoring, duplicate completion and backup validation.
- `scripts/audit_learning_browser.mjs` runs student journeys in isolated browser contexts. It requires a running browser-view runtime and the daily preview; use `PARLIAMO_URL` to choose a preview and `PARLIAMO_CDP_URL` for a different private CDP endpoint. It never reads another browser profile’s data.
- `docs/material-review.json` records source review, curriculum corrections and coverage limits.
- `docs/student-audit.json` records adversarial student scenarios, observed defects and fixes.

```bash
node scripts/audit_learning_browser.mjs
node scripts/audit_storage_browser.mjs
```

Screenshots and temporary test outputs go to ignored `work/`. Source PDFs, `Organised.zip`, the extracted archive and runtime state stay out of Git and deployment bundles.

## Custom-domain release

The daily site is served by the existing VPS reverse proxy as static files at `/data/italian/current`. Release directories are under `/data/italian/releases/` inside that container’s existing data mount. Its dedicated nginx configuration is `/data/nginx/custom/italian.conf`; it does not expose the legacy progress endpoints. A certificate for `italian.samuelzhang.co.uk` is managed through the existing Certbot installation, with a scoped renewal job in `/etc/cron.d/parliamo-certificate`.

Use the global `authenticate` skill for authorized infrastructure work. Build and verify locally first, transfer only `site-dist/` into a new release directory, switch the `current` symlink atomically, then verify public HTTPS and the asset responses. Retain the previous release for rollback. Do not package the repository root, raw materials or local learner data. The domain and certificate are already provisioned; ordinary content releases do not need to recreate them.

The source repository contains application code and original practice. Third-party course material and textbook rights remain separate. No explicit software licence is declared.

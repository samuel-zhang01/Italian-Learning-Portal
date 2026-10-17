# Parliamo!

Parliamo is Samuel's private, local-first Italian A1 learning portal: a dated 56-day completion and consolidation plan built around the original 2014 edition of *Nuovo Espresso 1*, the archived Imperial College lessons, and an original practice library.

The [public source repository](https://github.com/samuel-zhang01/Italian-Learning-Portal) contains the app, curriculum and generated workbooks. Each installation keeps its own learner progress. This is a single-learner application intended for local use; its progress API does not provide authentication or separate user accounts.

## Quick start

With Node.js 22.13 or newer installed:

```bash
git clone https://github.com/samuel-zhang01/Italian-Learning-Portal.git
cd Italian-Learning-Portal
npm ci
npm run local
```

Open [http://localhost:3000](http://localhost:3000). The server binds to this computer only. The macOS launcher below also opens the browser and makes daily database backups.

## Start it on this Mac

Double-click **`Start Parliamo.command`**. The launcher prepares the app on first use, starts it only on this computer, and opens [http://localhost:3000](http://localhost:3000) in the default browser. Keep the Terminal window open while studying; press Control-C or close that window to stop.

Requirements:

- macOS
- Node.js 22.13 or newer (a local Codex runtime is used automatically when available)
- Internet only for the first dependency install and optional external source links; day-to-day lesson content and tracking run locally

## Cost and privacy

- Local mode does not publish, call Sites, require ChatGPT sign-in, or need an OpenAI API key.
- The launcher removes any inherited `OPENAI_API_KEY` and explicitly disables metered AI feedback. Speaking feedback uses the included local rubric.
- Progress is stored in a local Cloudflare D1/SQLite development database under `.wrangler/state/` and mirrored in this browser's local cache.
- On each launch, the learner database is backed up at most once per day with SQLite's consistent-backup command, then integrity-checked in `backups/local-data/`. These backups stay on this Mac and are ignored by Git.
- Nothing in `npm run local` deploys the project. The previously published Sites copy is separate and is not changed by local use.

### Restore a local backup

Stop Parliamo first. Keep the current `.wrangler/state/` folder as an extra safety copy, find the learner database (the hashed `.sqlite` file beside `metadata.sqlite`), and replace it with the chosen dated file from `backups/local-data/`. Start Parliamo again and confirm the dashboard counts. Never replace `metadata.sqlite`; the launcher deliberately excludes it from learner-data backups.

## What is included

- A start-date-aware 8-week plan with 56 daily agendas and exact student-book, workbook, review, test, and grammar page references.
- Persistent task checklists, actual minutes, confidence, checkpoint scores, reflection notes, and projected pace.
- Twenty-eight archived lesson hubs and an original practice bank covering grammar, listening, speaking, reading, writing, vocabulary, and interaction.
- Spaced vocabulary review, readings, preposition drills, and three production-focused games.
- Separate CEFR evidence lanes for listening, reading, spoken interaction, spoken production, and writing.
- Italian immersion and bilingual Italian-English modes, plus an accessible guided tour that can be reopened from the header.

Textbook scans, class archives, recordings and learner databases are not included in the public repository. The curriculum contains original practice and references to the source materials.

## Developer commands

Run these from the workspace root, which contains `package.json`. On Linux, use `npm run local` directly; the double-click launcher is for macOS.

```bash
npm ci
npm run local
npm run lint
npm run typecheck
npm test
```

- `npm run local`: private local server at `127.0.0.1:3000`
- `npm run dev`: development server using Vinext defaults
- `npm run build`: verify the production build
- `npm run typecheck`: check the application and build configuration types
- `npm test`: build and verify the 56-day curriculum source contracts
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Adding study materials

Drop new PDFs, documents, notes, audio, or archives into **`materials/inbox/`**. Group them in folders by course or topic if useful. This folder is ignored by Git and is outside `public/`, so its files are not served by the app. Adding files does not change the curriculum automatically; they can be reviewed and incorporated in a separate pass.

The optional archive tool inventories files and extracts text from PDF, DOCX, PPTX, XLSX, HTML, EML, Markdown, and text files. Audio and ZIP archives are inventoried only; unpack course archives into the inbox before extracting their contents.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
.venv/bin/python scripts/audit_course_archive.py
```

Use Python 3.10 or newer. The tool scans `materials/inbox/` by default; `--source materials/inbox/course-name` limits it to one course. Hidden files and symbolic links are skipped. Reports go to `data/incoming/`, separate from the preserved `data/archive-*.json` reports. Each run replaces the incoming reports; an empty inbox leaves them untouched.

## Project layout

- `app/`: portal screens, study plan, and API routes
- `db/` and `drizzle/`: curriculum seed, database schema, and migrations
- `public/downloads/`: the two workbooks used by the app
- `materials/inbox/`: new source materials awaiting review
- `scripts/`: archive inventory and workbook generation tools
- `tests/`: curriculum source checks
- `build/`, `worker/`, and `.openai/`: required build and hosting configuration
- `.wrangler/state/` and `backups/local-data/`: local progress and database backups; preserve these

`dist/`, `.vinext/`, `tmp/`, and `output/` are generated files and are ignored by Git. The workbook generator writes to `output/pdf/` and copies the final PDFs into `public/downloads/`; it currently requires the macOS Arial and Georgia fonts.

## Source and licence status

The source is public on GitHub. No explicit licence is declared for this repository. The linked textbook and course resources remain separate from the app's original practice content.

## Curriculum sources

- [ALMA Edizioni: official original-edition index](https://www.almaedizioni.it/wp-content/uploads/2019/10/nesp1_indice-intro.pdf)
- [ALMA Edizioni: official teacher guide](https://www.almaedizioni.it/wp-content/uploads/2019/10/NE1_guida_totale.pdf)
- [Council of Europe: CEFR self-assessment grid](https://www.coe.int/en/web/common-European-framework-reference-languages/table-2-cefr-3.3-common-reference-levels-self-assessment-grid)

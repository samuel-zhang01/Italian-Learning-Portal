# Parliamo!

Parliamo is Samuel's private, local-first Italian A1 learning portal: a dated 56-day completion and consolidation plan built around the original 2014 edition of *Nuovo Espresso 1*, the archived Imperial College lessons, and an original practice library.

## Start it on this Mac

Double-click **`Start Parliamo.command`**. The launcher prepares the app on first use, starts it only on this computer, and opens [http://localhost:3000](http://localhost:3000) in the default browser. Keep the Terminal window open while studying; press Control-C or close that window to stop.

Requirements:

- macOS
- Node.js 22 or newer (the included Codex runtime is used automatically when available)
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

The scan supplied with the workspace is used only to confirm edition and page references. It is not copied into or linked from the app.

## Developer commands

```bash
npm ci
npm run local
npm run lint
npm test
```

- `npm run local`: private local server at `127.0.0.1:3000`
- `npm run dev`: development server using Vinext defaults
- `npm run build`: verify the production build
- `npm test`: build and verify the rendered shell and 56-day curriculum contract
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Curriculum sources

- [ALMA Edizioni: official original-edition index](https://www.almaedizioni.it/wp-content/uploads/2019/10/nesp1_indice-intro.pdf)
- [ALMA Edizioni: official teacher guide](https://www.almaedizioni.it/wp-content/uploads/2019/10/NE1_guida_totale.pdf)
- [Council of Europe: CEFR self-assessment grid](https://www.coe.int/en/web/common-European-framework-reference-languages/table-2-cefr-3.3-common-reference-levels-self-assessment-grid)

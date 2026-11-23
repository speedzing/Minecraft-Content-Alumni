# Minecraft Content Alumni

Title database for **Minecraft Content Alumni** (formerly Minecraft Content Atlas), a film database for Minecraft films, series and animations.

This repository currently hosts the raw data store and a plain viewer page at https://speedzing.github.io/Minecraft-Content-Alumni/. The full site will be built on top of this data later.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Basic viewer for every stored title plus the submission field (GitHub Pages entry point). |
| `database/titles.json` | The database: one record per title, sourced from IMDb. |
| `database/posters/<imdbId>.jpg` | Local copy of each title's poster. |
| `scripts/add-titles.mjs` | Fetches IMDb title pages with headless Chromium and appends them to the database. |
| `scripts/imdb-extractor.mjs` | Turns an IMDb title page into one database record. |
| `.github/workflows/process-submissions.yml` | Runs `add-titles` for each submission and commits the result. |
| `.github/ISSUE_TEMPLATE/submission.yml` | The submission form. |

## Submitting titles

1. Paste IMDb links into **Submit a title** on the page (or open a new issue with the *Title submission* form).
2. GitHub opens a prefilled submission; press **Create** (needs a GitHub account).
3. The workflow fetches each title, saves the poster, commits to `main`, replies on the issue with what was added and closes it. Failed links are reported and the issue stays open.

Up to 10 links per submission; titles already in the database are skipped. To test without committing, run the workflow manually from the Actions tab with **dry run** ticked.

Running locally: `npm install`, `npx playwright install chromium`, then `node scripts/add-titles.mjs tt1234567`.

## Record fields

Each entry in `titles[]` has: `imdbId`, `imdbUrl`, `title`, `originalTitle`, `titleType`, `isSeries`, `year`, `endYear`, `releaseDate`, `releaseCountry`, `runtimeMinutes`, `certificate`, `genres`, `interests`, `plot`, `rating {value, votes}`, `metascore`, `poster {url, width, height, caption, local}`, `directors`, `writers`, `stars`, `creators`, `cast [{id, name, role, characters, creditedAs, photo}]`, `studios`, `countries`, `languages`, `keywords`, `akas`, `filmingLocations`, `episodes`, `series`, `videos`, `gallery`, `trivia`, `externalLinks`, `awards`, `fetchedAt`, `source`, and `submission {issue, by, at}` for titles added through the form.

## Viewing locally

`fetch()` needs a web server, so run `python -m http.server` in this folder and open http://localhost:8000.

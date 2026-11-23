# Minecraft Content Alumni

Pre-launch title database for **Minecraft Content Alumni** (formerly Minecraft Content Atlas), a film database for Minecraft films, series and animations.

This repository hosts the raw data store and a plain viewer page at https://speedzing.github.io/Minecraft-Content-Alumni/. The page's design is a placeholder; the full site will be built on top of this data later.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Pre-launch page: what the project is, the submission field, and every stored title (GitHub Pages entry point). |
| `database/titles.json` | The database: one record per title. |
| `database/posters/<imdbId>.<ext>` | Local copy of each title's poster. |
| `scripts/imdb-datasets.mjs` | Looks titles up in IMDb's official daily datasets. Reusable as the future site's "Import from IMDb". |
| `scripts/import-imdb.mjs` | Turns submissions or a list of IDs into database records. |
| `scripts/reply.mjs` | Replies on, labels and closes submission issues. |
| `.github/workflows/process-submissions.yml` | Runs the import on new submissions, daily for waiting ones, or manually. |
| `.github/ISSUE_TEMPLATE/submission.yml` | The submission form (IMDb links, optional YouTube/official links, poster and synopsis). |

## Submitting titles

1. Paste IMDb links into **Submit a title** on the page (or open a new issue with the *Title submission* form).
2. GitHub opens a prefilled submission. Optionally add YouTube and official links, a poster and a synopsis, then press **Create** (needs a GitHub account).
3. The workflow looks each title up in IMDb's datasets, commits it to `main`, replies on the issue and closes it.

To add videos or links to a title that's already listed, submit its IMDb link together with the new links; only links not already stored are added.

Up to 10 links per submission; titles already in the database are skipped. Titles not yet in IMDb's data (new pages take a day or two) get the `waiting` label and are retried every day at 03:30 UTC for up to 7 days, then labelled `needs-attention`.

## Importing directly

Actions tab → **Import from IMDb** → **Run workflow**, paste IDs or links. Tick **dry run** to look titles up without saving.

Locally (needs bash, curl, gunzip and grep, e.g. Git Bash): `node scripts/import-imdb.mjs tt1234567`. Each run streams about 1.5 GB of dataset files.

## What IMDb's datasets include

Title, original title, type, year range, runtime, genres, rating and votes, directors, writers, principal cast with characters, principal crew, and episode counts for series. They do **not** include posters, plots, images, studios, countries or languages; posters and synopses come from the submission form instead. The six launch titles were captured from their IMDb pages and have the fuller set of fields.

IMDb's datasets are provided for personal and non-commercial use: https://developer.imdb.com/non-commercial-datasets/

## Record fields

Each entry in `titles[]` has: `imdbId`, `imdbUrl`, `title`, `originalTitle`, `titleType`, `isSeries`, `year`, `endYear`, `releaseDate`, `releaseCountry`, `runtimeMinutes`, `certificate`, `genres`, `interests`, `plot`, `rating {value, votes}`, `metascore`, `poster {url, width, height, caption, local}`, `directors`, `writers`, `stars`, `creators`, `cast [{id, name, role, characters, creditedAs, photo}]`, `crew [{id, name, job}]` (dataset imports), `studios`, `countries`, `languages`, `keywords`, `akas`, `filmingLocations`, `episodes`, `series`, `videos`, `gallery`, `trivia`, `externalLinks`, `awards`, `links [{type, label, url, platform, youtubeId, channel, official, source}]` (type is `film`, `video`, `trailer`, `teaser`, `extra`, `soundtrack`, `playlist`, `channel` or `website`; `source` is `research` for links verified by hand from the creators' own channels, `submission` for submitted ones), `fetchedAt`, `source` (`imdb` or `imdb-datasets`), and `submission {issue, by, at}` for titles added through the form. Fields a source doesn't provide are `null` or empty.

## Viewing locally

`fetch()` needs a web server, so run `python -m http.server` in this folder and open http://localhost:8000.

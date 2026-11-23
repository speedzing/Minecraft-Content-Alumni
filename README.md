# Minecraft Content Alumni

Title database for **Minecraft Content Alumni** (formerly Minecraft Content Atlas), a film database for Minecraft films, series and animations.

This repository currently hosts the raw data store and a plain viewer page. The full site will be built on top of this data later.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Basic viewer for every stored title (GitHub Pages entry point). |
| `database/titles.json` | The database: one record per title, sourced from IMDb. |
| `database/posters/<imdbId>.jpg` | Local copy of each title's poster. |
| `tools/imdb-extract.js` | Console script that turns IMDb title pages into database records. |

## Record fields

Each entry in `titles[]` has: `imdbId`, `imdbUrl`, `title`, `originalTitle`, `titleType`, `isSeries`, `year`, `endYear`, `releaseDate`, `releaseCountry`, `runtimeMinutes`, `certificate`, `genres`, `interests`, `plot`, `rating {value, votes}`, `metascore`, `poster {url, width, height, caption, local}`, `directors`, `writers`, `stars`, `creators`, `cast [{id, name, role, characters, creditedAs, photo}]`, `studios`, `countries`, `languages`, `keywords`, `akas`, `filmingLocations`, `episodes`, `series`, `videos`, `gallery`, `trivia`, `externalLinks`, `awards`, `fetchedAt`, `source`.

## Adding titles

1. Open any IMDb page in a browser, set the `IDS` list in `tools/imdb-extract.js`, and run it in the console.
2. Append the printed records to `titles` in `database/titles.json`, add `"source": "imdb"` and `poster.local`, and bump `count` / `updatedAt`.
3. Save the poster to `database/posters/<imdbId>.jpg`.

## Viewing locally

`fetch()` needs a web server, so run `python -m http.server` in this folder and open http://localhost:8000.

// Looks up titles in IMDb's official non-commercial datasets (https://developer.imdb.com/non-commercial-datasets/).
// Each file is streamed and filtered with curl | gunzip | grep, so nothing large is kept on disk.
// Requires bash, curl, gunzip and grep (GitHub runners or Git Bash).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://datasets.imdbws.com/';
const NONE = '\\N';

const TYPE_NAMES = {
  movie: 'Movie', short: 'Short', tvSeries: 'TV Series', tvMiniSeries: 'TV Mini Series',
  tvMovie: 'TV Movie', tvSpecial: 'TV Special', tvShort: 'TV Short', tvEpisode: 'TV Episode',
  tvPilot: 'TV Pilot', video: 'Video', videoGame: 'Video Game',
};
const CAST_ROLES = { actor: 'Actor', actress: 'Actress', self: 'Self' };

const val = v => (v === undefined || v === NONE ? null : v);
const num = v => (val(v) === null ? null : Number(v));
const list = v => (val(v) === null ? [] : v.split(','));

// Streams one dataset file and returns the rows where any of `columns` equals one of `keys`.
async function filterDataset(file, keys, columns = [0]) {
  const patternFile = path.join(os.tmpdir(), `imdb-${file}-${process.pid}.txt`);
  await fs.writeFile(patternFile, [...keys].map(k => `${k}\t`).join('\n') + '\n');
  const script = 'curl -sfL --retry 3 "$1" | gunzip -c | grep -F -f "$2"; s=("${PIPESTATUS[@]}"); '
    + '[ "${s[0]}" -eq 0 ] && [ "${s[1]}" -eq 0 ] && [ "${s[2]}" -le 1 ]';
  const out = await new Promise((resolve, reject) => {
    execFile('bash', ['-c', script, '_', `${BASE}${file}.tsv.gz`, patternFile],
      { maxBuffer: 256 * 1024 * 1024 },
      (err, stdout) => (err ? reject(new Error(`could not read ${file}: ${err.message}`)) : resolve(stdout)));
  });
  await fs.rm(patternFile, { force: true });
  return out.split('\n').filter(Boolean).map(l => l.split('\t')).filter(r => columns.some(c => keys.has(r[c])));
}

// Returns Map(imdbId -> record) for every id found; ids missing from the datasets are absent.
export async function lookupTitles(ids) {
  const want = new Set(ids);
  const [basics, ratings, crew, principals, episodes] = await Promise.all([
    filterDataset('title.basics', want),
    filterDataset('title.ratings', want),
    filterDataset('title.crew', want),
    filterDataset('title.principals', want),
    // Rows where the id is either the episode itself (col 0) or its parent series (col 1).
    filterDataset('title.episode', want, [0, 1]),
  ]);

  const personIds = new Set();
  for (const r of crew) [...list(r[1]), ...list(r[2])].forEach(n => personIds.add(n));
  for (const r of principals) personIds.add(r[2]);
  const names = new Map(personIds.size
    ? (await filterDataset('name.basics', personIds)).map(r => [r[0], r[1]])
    : []);
  const person = id => ({ id, name: names.get(id) || null });

  const found = new Map();
  for (const b of basics) {
    const [id, type, primaryTitle, originalTitle, isAdult, startYear, endYear, runtime, genres] = b;
    const rating = ratings.find(r => r[0] === id);
    const credits = crew.find(r => r[0] === id) || [];
    const people = principals.filter(r => r[0] === id).sort((x, y) => Number(x[1]) - Number(y[1]));
    const castRows = people.filter(r => CAST_ROLES[r[3]]);
    const cast = castRows.map(r => ({
      ...person(r[2]), role: CAST_ROLES[r[3]],
      characters: val(r[5]) ? JSON.parse(r[5]) : [], creditedAs: null, photo: null,
    }));
    const childEpisodes = episodes.filter(r => r[1] === id);
    const asEpisode = episodes.find(r => r[0] === id);
    const isSeries = type === 'tvSeries' || type === 'tvMiniSeries';

    found.set(id, {
      imdbId: id, imdbUrl: `https://www.imdb.com/title/${id}/`,
      title: primaryTitle, originalTitle,
      titleType: TYPE_NAMES[type] || type, isSeries, isAdult: isAdult === '1',
      year: num(startYear), endYear: num(endYear),
      releaseDate: null, releaseCountry: null,
      runtimeMinutes: num(runtime), certificate: null,
      genres: list(genres), interests: [],
      plot: null,
      rating: { value: rating ? Number(rating[1]) : null, votes: rating ? Number(rating[2]) : 0 },
      metascore: null,
      poster: null,
      directors: list(credits[1]).map(person),
      writers: list(credits[2]).map(person),
      stars: cast.slice(0, 3).map(({ id: pid, name }) => ({ id: pid, name })),
      creators: [],
      cast,
      crew: people.filter(r => !CAST_ROLES[r[3]]).map(r => ({ ...person(r[2]), job: val(r[4]) || r[3].replace(/_/g, ' ') })),
      studios: [], countries: [], languages: [], keywords: [], akas: [], filmingLocations: [],
      episodes: isSeries ? {
        total: childEpisodes.length,
        seasons: [...new Set(childEpisodes.map(r => num(r[2])).filter(n => n !== null))].sort((x, y) => x - y),
        years: [],
      } : null,
      series: asEpisode ? { id: asEpisode[1], title: null, season: num(asEpisode[2]), episode: num(asEpisode[3]) } : null,
      videos: [], gallery: [], trivia: [], externalLinks: [],
      awards: null,
      fetchedAt: new Date().toISOString(),
      source: 'imdb-datasets',
    });
  }
  return found;
}

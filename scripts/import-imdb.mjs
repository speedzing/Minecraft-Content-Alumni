// Import from IMDb: adds titles to database/titles.json using IMDb's daily datasets.
//
// Where the input comes from depends on GITHUB_EVENT_NAME:
//   issues    -> the submission issue that triggered the run
//   schedule  -> every open submission labelled "waiting" (titles not yet in IMDb's data)
//   otherwise -> IMDB_INPUT or the command-line args (manual import, no issue)
// Set DRY_RUN=true to look titles up without saving anything.
// Writes results.json for scripts/reply.mjs and prints a summary.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { lookupTitles } from './imdb-datasets.mjs';

const DB_PATH = 'database/titles.json';
const MAX_PER_SUBMISSION = 10;
const GIVE_UP_DAYS = 7;
const MAX_POSTER_BYTES = 15 * 1024 * 1024;
const ATTACHMENT_PREFIXES = [
  'https://github.com/user-attachments/',
  'https://user-images.githubusercontent.com/',
  'https://private-user-images.githubusercontent.com/',
];
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const dryRun = process.env.DRY_RUN === 'true';
const event = process.env.GITHUB_EVENT_NAME || 'manual';

// Splits an issue-form body ("### IMDb links\n\n...") into its fields.
function readForm(body) {
  if (!/^### /m.test(body)) return { links: body, poster: '', synopsis: '' };
  const fields = {};
  for (const part of body.split(/^### /m).slice(1)) {
    const nl = part.indexOf('\n');
    const text = part.slice(nl + 1).trim();
    fields[part.slice(0, nl).trim().toLowerCase()] = text === '_No response_' ? '' : text;
  }
  return { links: fields['imdb links'] || '', poster: fields.poster || '', synopsis: fields.synopsis || '' };
}

async function collectJobs() {
  if (event === 'issues') {
    const { issue } = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    return [{ issue: issue.number, user: issue.user.login, body: issue.body || '', createdAt: issue.created_at, firstRun: true }];
  }
  if (event === 'schedule') {
    const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--repo', process.env.GITHUB_REPOSITORY,
      '--label', 'waiting', '--state', 'open', '--limit', '100', '--json', 'number,author,body,createdAt'], { encoding: 'utf8' }));
    return open.map(i => ({ issue: i.number, user: i.author?.login || null, body: i.body || '', createdAt: i.createdAt, firstRun: false }));
  }
  return [{ issue: null, user: null, body: process.env.IMDB_INPUT || process.argv.slice(2).join('\n'), firstRun: true }];
}

async function savePoster(url, id) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new Error(`not a JPEG, PNG or WebP image (${type || 'unknown type'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_POSTER_BYTES) throw new Error('larger than 15 MB');
  const local = `database/posters/${id}.${ext}`;
  await fs.mkdir('database/posters', { recursive: true });
  await fs.writeFile(local, buf);
  return { url, width: null, height: null, caption: null, local };
}

const jobs = (await collectJobs()).map(job => {
  const form = readForm(job.body);
  return {
    ...job,
    ids: [...new Set(form.links.match(/tt\d{7,10}/g) || [])].slice(0, MAX_PER_SUBMISSION),
    poster: (form.poster.match(/https:\/\/[^\s)"'<>]+/g) || []).find(u => ATTACHMENT_PREFIXES.some(p => u.startsWith(p))) || null,
    synopsis: form.synopsis.slice(0, 2000),
  };
});

const db = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
const known = new Set(db.titles.map(t => t.imdbId));
const toLookUp = [...new Set(jobs.flatMap(j => j.ids).filter(id => dryRun || !known.has(id)))];
const found = toLookUp.length ? await lookupTitles(toLookUp) : new Map();

const results = [];
let totalAdded = 0;
for (const job of jobs) {
  const lines = [];
  let added = 0, waiting = 0;
  if (!job.ids.length) lines.push('No IMDb title links found. Links look like `https://www.imdb.com/title/tt1234567/`.');
  for (const id of job.ids) {
    if (!dryRun && known.has(id)) { lines.push(`- \`${id}\` is already in the database.`); continue; }
    const record = found.get(id);
    if (!record) {
      waiting++;
      lines.push(`- \`${id}\` is not in IMDb's daily data yet. New IMDb pages usually show up within a day or two; this is retried automatically every day.`);
      continue;
    }
    const title = structuredClone(record);
    if (job.issue) title.submission = { issue: job.issue, by: job.user, at: new Date().toISOString() };
    if (job.ids.length === 1 && job.synopsis) title.plot = job.synopsis;
    if (job.ids.length === 1 && job.poster && !dryRun) {
      try { title.poster = await savePoster(job.poster, id); }
      catch (err) { lines.push(`  - The poster could not be saved: ${err.message}.`); }
    }
    if (dryRun) console.log(JSON.stringify(title, null, 2));
    else { db.titles.push(title); known.add(id); }
    added++;
    lines.push(`- ${dryRun ? 'Found' : 'Added'} **${title.title}** (${title.year ?? 'year unknown'}, ${title.titleType}): \`${id}\`, ${title.cast.length} cast${title.poster ? ', poster saved' : ''}`);
  }
  if (job.ids.length > 1 && (job.poster || job.synopsis)) lines.push('The poster and synopsis fields are only used when a submission has a single title.');
  totalAdded += added;

  const expired = waiting > 0 && job.createdAt && Date.now() - Date.parse(job.createdAt) > GIVE_UP_DAYS * 864e5;
  const result = { issue: job.issue, comment: null, close: false, addLabels: [], removeLabels: [] };
  if (!job.ids.length) {
    result.addLabels.push('needs-attention');
  } else if (expired) {
    result.addLabels.push('needs-attention');
    result.removeLabels.push('waiting');
    lines.push(`Still missing from IMDb's data after ${GIVE_UP_DAYS} days, so automatic retries have stopped.`);
  } else if (waiting) {
    result.addLabels.push('waiting');
  } else {
    result.close = true;
    result.removeLabels.push('waiting');
  }
  // Daily retries stay quiet unless something changed.
  if (job.firstRun || added || expired || result.close) result.comment = lines.join('\n');
  results.push(result);
  console.log(`${job.issue ? `#${job.issue}` : 'Import'}:\n${lines.join('\n')}\n`);
}

if (!dryRun && totalAdded) {
  db.count = db.titles.length;
  db.updatedAt = new Date().toISOString();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2) + '\n');
}
await fs.writeFile('results.json', JSON.stringify(results, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
    results.map(r => `### ${r.issue ? `#${r.issue}` : 'Import'}\n${r.comment || '(no change)'}\n`).join('\n'));
}

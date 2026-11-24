// Import from IMDb: adds titles to database/titles.json using IMDb's daily datasets.
//
// Where the input comes from depends on GITHUB_EVENT_NAME:
//   issues    -> the submission issue that triggered the run
//   schedule  -> every open submission labelled "waiting" (titles not yet in IMDb's data)
//   otherwise -> IMDB_INPUT or the command-line args (manual import, no issue)
// Set DRY_RUN=true to look titles up without saving anything.
// With YOUTUBE_API_KEY set, new titles are also searched on YouTube for official videos;
// FIND_LINKS=true does the same for titles already in the database.
// Writes results.json for scripts/reply.mjs and prints a summary.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { lookupTitles } from './imdb-datasets.mjs';
import { findYouTubeLinks, hasYouTubeKey, mergeLinks } from './youtube-links.mjs';
import { DB_PATH, attachmentUrls, readIssueForm, readLinks, saveImage } from './lib.mjs';

const MAX_PER_SUBMISSION = 10;
const GIVE_UP_DAYS = 7;

const dryRun = process.env.DRY_RUN === 'true';
const event = process.env.GITHUB_EVENT_NAME || 'manual';
const findLinks = process.env.FIND_LINKS === 'true';

function readForm(body) {
  const fields = readIssueForm(body);
  if (!fields) return { links: body, poster: '', synopsis: '', extraLinks: '' };
  return {
    links: fields['imdb links'] || '', poster: fields.poster || '', synopsis: fields.synopsis || '',
    extraLinks: fields['youtube and official links'] || '',
  };
}

async function savePoster(url, id) {
  const local = await saveImage(url, `database/posters/${id}`);
  return { url, width: null, height: null, caption: null, local };
}

const mdLink = l => `[${l.label.replace(/[[\]]/g, '')}](${l.url})`;

// Searches YouTube for the title and folds the results into it; returns report lines.
async function addSearchedLinks(title) {
  if (!hasYouTubeKey()) return [];
  try {
    const { official, suggestions } = await findYouTubeLinks(title);
    const freshOfficial = mergeLinks(title.links, official);
    title.links = [...(title.links || []), ...freshOfficial];
    const freshSuggestions = mergeLinks([...title.links, ...(title.linkSuggestions || [])], suggestions);
    title.linkSuggestions = [...(title.linkSuggestions || []), ...freshSuggestions];
    const out = [];
    const videos = freshOfficial.filter(l => l.youtubeId);
    if (videos.length) out.push(`  - Found ${videos.length} official YouTube video(s): ${videos.map(mdLink).join(', ')}`);
    if (freshSuggestions.length) {
      out.push(`  - Possible matches to review (not from a credited channel, so not shown as official): ${freshSuggestions.map(l => `${mdLink(l)} by ${l.channel}`).join('; ')}`);
    }
    if (!out.length) out.push('  - No new YouTube videos found.');
    return out;
  } catch (err) {
    return [`  - YouTube search failed: ${err.message}`];
  }
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

const jobs = (await collectJobs()).map(job => {
  const form = readForm(job.body);
  return {
    ...job,
    ids: [...new Set(form.links.match(/tt\d{7,10}/g) || [])].slice(0, MAX_PER_SUBMISSION),
    poster: attachmentUrls(form.poster)[0] || null,
    synopsis: form.synopsis.slice(0, 2000),
    extraLinks: form.extraLinks,
  };
});

const db = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
const known = new Set(db.titles.map(t => t.imdbId));
// Dry runs look listed titles up again, unless the run is only about finding links.
const toLookUp = [...new Set(jobs.flatMap(j => j.ids).filter(id => !known.has(id) || (dryRun && !findLinks)))];
const found = toLookUp.length ? await lookupTitles(toLookUp) : new Map();

const results = [];
let totalChanged = 0;
for (const job of jobs) {
  const lines = [];
  let added = 0, waiting = 0;
  // Extra links belong to one title, so they're only read for single-title submissions.
  const links = job.ids.length === 1 && job.extraLinks ? await readLinks(job.extraLinks) : [];
  if (!job.ids.length) lines.push('No IMDb title links found. Links look like `https://www.imdb.com/title/tt1234567/`.');
  for (const id of job.ids) {
    if (known.has(id) && (!dryRun || findLinks)) {
      const stored = db.titles.find(t => t.imdbId === id);
      const title = dryRun ? structuredClone(stored) : stored;
      const linkCount = () => (title.links || []).length + (title.linkSuggestions || []).length;
      const before = linkCount();
      const fresh = mergeLinks(title.links, links);
      title.links = [...(title.links || []), ...fresh];
      const searchLines = findLinks ? await addSearchedLinks(title) : [];
      if (!dryRun && linkCount() > before) totalChanged++;
      lines.push(`- **${title.title}** (\`${id}\`) is already in the database${fresh.length ? `; added ${fresh.length} submitted link(s)` : ''}.`, ...searchLines);
      continue;
    }
    const record = found.get(id);
    if (!record) {
      waiting++;
      lines.push(`- \`${id}\` is not in IMDb's daily data yet. New IMDb pages usually show up within a day or two; this is retried automatically every day.`);
      continue;
    }
    const title = structuredClone(record);
    if (job.issue) title.submission = { issue: job.issue, by: job.user, at: new Date().toISOString() };
    if (job.ids.length === 1 && job.synopsis) title.plot = job.synopsis;
    title.links = links;
    const searchLines = await addSearchedLinks(title);
    if (job.ids.length === 1 && job.poster && !dryRun) {
      try { title.poster = await savePoster(job.poster, id); }
      catch (err) { lines.push(`  - The poster could not be saved: ${err.message}.`); }
    }
    if (dryRun) console.log(JSON.stringify(title, null, 2));
    else { db.titles.push(title); known.add(id); }
    added++;
    lines.push(`- ${dryRun ? 'Found' : 'Added'} **${title.title}** (${title.year ?? 'year unknown'}, ${title.titleType}): \`${id}\`, ${title.cast.length} cast${title.poster ? ', poster saved' : ''}${links.length ? `, ${links.length} link(s)` : ''}`, ...searchLines);
  }
  if (job.ids.length > 1 && (job.poster || job.synopsis || job.extraLinks)) {
    lines.push('The poster, synopsis and links fields are only used when a submission has a single title.');
  }
  totalChanged += added;

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

if (!dryRun && totalChanged) {
  db.count = db.titles.length;
  db.updatedAt = new Date().toISOString();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2) + '\n');
}
await fs.writeFile('results.json', JSON.stringify(results, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
    results.map(r => `### ${r.issue ? `#${r.issue}` : 'Import'}\n${r.comment || '(no change)'}\n`).join('\n'));
}

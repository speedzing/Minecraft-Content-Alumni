// Adds IMDb titles to database/titles.json.
// Input: any text containing IMDb title IDs/links, from $INPUT_TEXT or CLI args.
// Env: DRY_RUN=true (fetch and report only), ISSUE_NUMBER / ISSUE_USER (submission metadata).
// Writes a Markdown report to result.md and `added` / `close` to $GITHUB_OUTPUT.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { extractImdbTitle } from './imdb-extractor.mjs';

const DB_PATH = 'database/titles.json';
const MAX_PER_SUBMISSION = 10;
const POSTER_MAX_HEIGHT = 1200;

const input = process.env.INPUT_TEXT || process.argv.slice(2).join(' ');
const dryRun = process.env.DRY_RUN === 'true';
const issue = process.env.ISSUE_NUMBER ? Number(process.env.ISSUE_NUMBER) : null;
const ids = [...new Set(input.match(/tt\d{7,10}/g) || [])].slice(0, MAX_PER_SUBMISSION);

const db = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
const known = new Set(db.titles.map(t => t.imdbId));
const report = [];
let added = 0, failed = 0;

async function downloadPoster(poster, dest) {
  const url = poster.height > POSTER_MAX_HEIGHT && poster.url.endsWith('._V1_.jpg')
    ? poster.url.replace(/\._V1_\.jpg$/, `._V1_QL90_UY${POSTER_MAX_HEIGHT}_.jpg`)
    : poster.url;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const expected = Number(res.headers.get('content-length'));
      if (expected && buf.length !== expected) throw new Error('truncated download');
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
    }
  }
}

if (!ids.length) {
  report.push('No IMDb title links found. Links look like `https://www.imdb.com/title/tt1234567/`.');
}

const todo = ids.filter(id => {
  if (dryRun || !known.has(id)) return true;
  report.push(`- \`${id}\` is already in the database.`);
  return false;
});

if (todo.length) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'en-US' });
  for (const id of todo) {
    try {
      const res = await page.goto(`https://www.imdb.com/title/${id}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      try {
        await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 30_000 });
      } catch {
        throw new Error(`IMDb did not serve the title page (HTTP ${res?.status()}, page title "${await page.title()}")`);
      }
      const title = await page.evaluate(extractImdbTitle);
      if (!title?.imdbId || !title.title) throw new Error('IMDb page had no title data');
      if (!dryRun && known.has(title.imdbId)) {
        report.push(`- \`${id}\` redirects to \`${title.imdbId}\`, which is already in the database.`);
        continue;
      }
      title.source = 'imdb';
      if (issue) title.submission = { issue, by: process.env.ISSUE_USER || null, at: new Date().toISOString() };
      if (title.poster) {
        title.poster.local = `database/posters/${title.imdbId}.jpg`;
        if (!dryRun) {
          try { await downloadPoster(title.poster, title.poster.local); }
          catch (err) { title.poster.local = null; report.push(`  - poster for \`${title.imdbId}\` could not be saved: ${err.message}`); }
        }
      }
      if (!dryRun) { db.titles.push(title); known.add(title.imdbId); }
      added++;
      report.push(`- ${dryRun ? 'Fetched' : 'Added'} **${title.title}** (${title.year ?? 'n/a'}, ${title.titleType}): \`${title.imdbId}\`, ${title.cast.length} cast, ${title.gallery.length} images`);
    } catch (err) {
      failed++;
      report.push(`- \`${id}\` could not be processed: ${String(err.message).split('\n')[0]}`);
    }
  }
  await browser.close();
}

if (!dryRun && added) {
  db.count = db.titles.length;
  db.updatedAt = new Date().toISOString();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2) + '\n');
}

const summary = [`${dryRun ? 'Dry run' : 'Submission processed'}: ${added} ${dryRun ? 'fetched' : 'added'}, ${failed} failed.`, '', ...report].join('\n');
await fs.writeFile('result.md', summary + '\n');
console.log(summary);
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `added=${added}\nclose=${ids.length > 0 && failed === 0}\n`);
}

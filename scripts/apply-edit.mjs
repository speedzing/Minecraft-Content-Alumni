// Applies an "Edit a title" issue to database/titles.json.
// The form is opened pre-filled with the title's current values, so a field that still matches
// is left alone. An empty field means "unchanged"; a field containing only "-" clears it.
// List fields (people, cast, links, gallery) replace the whole list with what's in the field.
// Writes results.json for scripts/reply.mjs.
import fs from 'node:fs/promises';
import { DB_PATH, URL_PATTERN, attachmentUrls, describeLink, isAttachment, readIssueForm, saveImage } from './lib.mjs';
import { normalize } from './youtube-links.mjs';

const CLEAR = '-';
const MAX_GALLERY = 30;

const { issue } = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const form = readIssueForm(issue.body) || {};
const field = label => (form[label] || '').trim();

const db = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
const id = (field('imdb link').match(/tt\d{7,10}/) || [])[0];
const title = id && db.titles.find(t => t.imdbId === id);

const changes = [];
const problems = [];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const splitList = s => s.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
const splitLines = s => s.split('\n').map(x => x.trim()).filter(Boolean);

function setValue(key, label, parse) {
  const raw = field(label);
  if (!raw) return;
  if (raw === CLEAR && key === 'title') { problems.push("The title can't be cleared."); return; }
  const value = raw === CLEAR ? null : parse(raw);
  if (value === undefined) return;
  if (!same(title[key], value)) { title[key] = value; changes.push(label); }
}

const text = max => raw => raw.slice(0, max);
const year = label => raw => /^\d{4}$/.test(raw) ? Number(raw) : (problems.push(`${label} must be a 4-digit year.`), undefined);
const minutes = raw => /^\d{1,4}$/.test(raw) ? Number(raw) : (problems.push('Runtime must be a number of minutes.'), undefined);
const date = raw => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(raw) ? raw : (problems.push('Release date must look like 2026-10-02.'), undefined);

// People keep their IMDb ids when the name is unchanged.
function setPeople(key, label) {
  const raw = field(label);
  if (!raw) return;
  const names = raw === CLEAR ? [] : splitList(raw);
  if (same((title[key] || []).map(p => p.name), names)) return;
  const previous = new Map((title[key] || []).map(p => [normalize(p.name), p]));
  title[key] = names.map(name => ({ ...(previous.get(normalize(name)) || { id: null }), name }));
  changes.push(label);
}

// Cast lines look like "Name — Character / Character".
function setCast() {
  const raw = field('cast');
  if (!raw) return;
  const rows = raw === CLEAR ? [] : splitLines(raw).map(line => {
    const [name, ...rest] = line.split(/\s+[—–-]\s+/);
    return { name: name.trim(), characters: rest.join(' - ').split('/').map(c => c.trim()).filter(Boolean) };
  });
  const current = (title.cast || []).map(c => ({ name: c.name, characters: c.characters }));
  if (same(current, rows)) return;
  const previous = new Map((title.cast || []).map(c => [normalize(c.name), c]));
  title.cast = rows.map(r => ({ id: null, role: null, creditedAs: null, photo: null, ...previous.get(normalize(r.name)), ...r }));
  changes.push('cast');
}

const linkKey = url => {
  try {
    const u = new URL(url);
    return u.searchParams.get('v') || (u.hostname === 'youtu.be' ? u.pathname.slice(1) : null) || u.href;
  } catch { return url; }
};

async function setLinks() {
  const raw = field('links');
  if (!raw) return;
  const urls = raw === CLEAR ? [] : [...new Set(raw.match(URL_PATTERN) || [])].filter(u => !isAttachment(u));
  const previous = new Map((title.links || []).map(l => [linkKey(l.url), l]));
  const next = [];
  for (const url of urls) next.push(previous.get(linkKey(url)) || await describeLink(url, 'edit'));
  const cleaned = next.filter(Boolean);
  if (same((title.links || []).map(l => l.url), cleaned.map(l => l.url))) return;
  title.links = cleaned;
  changes.push('links');
}

async function setPoster() {
  const raw = field('new poster');
  if (!raw) return;
  if (raw === CLEAR) {
    if (title.poster) { title.poster = null; changes.push('poster (removed)'); }
    return;
  }
  const upload = attachmentUrls(raw)[0];
  if (!upload) { problems.push('The new poster has to be an image dragged into the form.'); return; }
  try {
    const local = await saveImage(upload, `database/posters/${id}`);
    title.poster = { url: upload, width: null, height: null, caption: null, local };
    changes.push('poster');
  } catch (err) {
    problems.push(`The poster could not be saved: ${err.message}.`);
  }
}

async function setGallery() {
  const raw = field('gallery');
  if (!raw) return;
  const urls = raw === CLEAR ? [] : [...new Set(raw.match(URL_PATTERN) || [])].slice(0, MAX_GALLERY);
  const previous = new Map((title.gallery || []).map(g => [g.url, g]));
  const next = [];
  for (const url of urls) {
    if (previous.has(url)) { next.push(previous.get(url)); continue; }
    if (!isAttachment(url)) { problems.push(`Skipped a gallery link that isn't an uploaded image: ${url}`); continue; }
    try {
      const name = url.split('/').pop().replace(/[^\w-]/g, '').slice(-16) || String(Date.now());
      const local = await saveImage(url, `database/gallery/${id}-${name}`);
      next.push({ url, width: null, height: null, caption: null, local });
    } catch (err) {
      problems.push(`A gallery image could not be saved: ${err.message}.`);
    }
  }
  if (same((title.gallery || []).map(g => g.url), next.map(g => g.url))) return;
  for (const old of title.gallery || []) {
    if (old.local && !next.includes(old)) await fs.rm(old.local, { force: true });
  }
  title.gallery = next;
  changes.push('gallery');
}

const result = { issue: issue.number, comment: null, close: false, addLabels: [], removeLabels: [] };
if (!title) {
  result.comment = id
    ? `\`${id}\` isn't in the database yet, so there's nothing to edit. Submit it as a new title first.`
    : 'No IMDb title link found in the **IMDb link** field.';
  result.addLabels.push('needs-attention');
} else {
  setValue('title', 'title', text(300));
  setValue('plot', 'synopsis', text(4000));
  setValue('titleType', 'type', text(60));
  setValue('year', 'year', year('Year'));
  setValue('endYear', 'end year', year('End year'));
  setValue('releaseDate', 'release date', date);
  setValue('runtimeMinutes', 'runtime (minutes)', minutes);
  setValue('genres', 'genres', splitList);
  setValue('countries', 'countries', splitList);
  setValue('languages', 'languages', splitList);
  for (const [key, label] of [['directors', 'directors'], ['writers', 'writers'], ['creators', 'creators'], ['studios', 'studios'], ['stars', 'stars']]) {
    setPeople(key, label);
  }
  setCast();
  await setLinks();
  await setPoster();
  await setGallery();

  const lines = changes.length
    ? [`Updated **${title.title}** (\`${id}\`): ${changes.join(', ')}.`]
    : [`No changes found for **${title.title}**; every field matched what's already stored.`];
  if (problems.length) lines.push('', 'Not applied:', ...problems.map(p => `- ${p}`));
  if (changes.length) {
    title.edits = [...(title.edits || []), {
      issue: issue.number, by: issue.user.login, at: new Date().toISOString(), fields: changes,
      reason: field('reason for the edit').slice(0, 500) || null,
    }];
    db.updatedAt = new Date().toISOString();
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2) + '\n');
  }
  result.comment = lines.join('\n');
  result.close = true;
}

await fs.writeFile('results.json', JSON.stringify([result], null, 2));
console.log(result.comment);

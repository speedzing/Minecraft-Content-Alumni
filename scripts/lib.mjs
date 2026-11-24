// Helpers shared by the submission importer and the edit processor.
import fs from 'node:fs/promises';
import path from 'node:path';
import { linkType } from './youtube-links.mjs';

export const DB_PATH = 'database/titles.json';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_LINKS = 20;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ATTACHMENT_PREFIXES = [
  'https://github.com/user-attachments/',
  'https://user-images.githubusercontent.com/',
  'https://private-user-images.githubusercontent.com/',
];
export const URL_PATTERN = /https?:\/\/[^\s)"'<>\]]+/g;

// Splits an issue-form body ("### Field label\n\nvalue") into { 'field label': value }.
// Returns null for a body that wasn't written with an issue form.
export function readIssueForm(body) {
  if (!/^### /m.test(body || '')) return null;
  const fields = {};
  for (const part of body.split(/^### /m).slice(1)) {
    const nl = part.indexOf('\n');
    const text = (nl === -1 ? '' : part.slice(nl + 1)).trim();
    fields[(nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase()] = text === '_No response_' ? '' : text;
  }
  return fields;
}

export const isAttachment = url => ATTACHMENT_PREFIXES.some(p => url.startsWith(p));

// Image files dragged into an issue field (GitHub stores them as user attachments).
export const attachmentUrls = text => [...new Set((text || '').match(URL_PATTERN) || [])].filter(isAttachment);

// Downloads an uploaded image to `<base>.<ext>` and removes older copies with another extension.
export async function saveImage(url, base) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new Error(`not a JPEG, PNG or WebP image (${type || 'unknown type'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('larger than 15 MB');
  await fs.mkdir(path.dirname(base), { recursive: true });
  for (const other of Object.values(IMAGE_TYPES)) {
    if (other !== ext) await fs.rm(`${base}.${other}`, { force: true });
  }
  await fs.writeFile(`${base}.${ext}`, buf);
  return `${base}.${ext}`;
}

function youtubeVideoId(u) {
  if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
  return u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/)?.[1] || null;
}

// Turns one submitted URL into a link record; YouTube links get their title and channel from oEmbed.
export async function describeLink(raw, source = 'submission') {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^(www|m)\./, '');
  const isYouTube = host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com';
  const link = { type: 'website', label: host, url: u.href, platform: isYouTube ? 'youtube' : host,
    youtubeId: null, channel: null, official: null, source };
  if (!isYouTube) return link;

  const videoId = youtubeVideoId(u);
  const list = u.searchParams.get('list');
  if (videoId) Object.assign(link, { type: 'video', youtubeId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` });
  else if (list) Object.assign(link, { type: 'playlist', url: `https://www.youtube.com/playlist?list=${list}` });
  else if (/^\/(@|channel\/|c\/|user\/)/.test(u.pathname)) {
    link.type = 'channel';
    link.label = link.channel = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()).replace(/^@/, '');
    return link;
  }
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`);
    if (res.ok) {
      const info = await res.json();
      link.label = info.title;
      link.channel = info.author_name;
    }
  } catch { /* keep the host as the label */ }
  if (link.type === 'video') link.type = linkType(link.label);
  return link;
}

export async function readLinks(text, source) {
  const urls = [...new Set((text || '').match(URL_PATTERN) || [])].filter(u => !isAttachment(u)).slice(0, MAX_LINKS);
  return (await Promise.all(urls.map(u => describeLink(u, source)))).filter(Boolean);
}

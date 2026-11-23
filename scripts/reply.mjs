// Posts the outcome of scripts/import-imdb.mjs back onto each submission issue.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.env.GITHUB_REPOSITORY;
const gh = (...args) => execFileSync('gh', [...args, '--repo', repo], { stdio: 'inherit' });
const results = JSON.parse(await fs.readFile('results.json', 'utf8'));

for (const r of results.filter(r => r.issue)) {
  const n = String(r.issue);
  if (r.comment) {
    const file = path.join(os.tmpdir(), `reply-${n}.md`);
    await fs.writeFile(file, r.comment);
    gh('issue', 'comment', n, '--body-file', file);
  }
  for (const label of r.addLabels) gh('issue', 'edit', n, '--add-label', label);
  for (const label of r.removeLabels) {
    try { gh('issue', 'edit', n, '--remove-label', label); } catch { /* label wasn't on the issue */ }
  }
  if (r.close) gh('issue', 'close', n);
}

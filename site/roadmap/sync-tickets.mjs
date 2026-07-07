#!/usr/bin/env node
// Refresh the LIVE fields of site/roadmap/tickets.json from GitHub.
//
//   node site/roadmap/sync-tickets.mjs
//
// Live fields (overwritten):   title, state, status (from status:* labels; closed ⇒ done)
// Curated fields (preserved):  phase, row, deps, summary, agents, demo, short
//
// Requires an authenticated `gh` CLI. Run by whichever agent changes tickets —
// the site build itself never needs network (it renders the committed snapshot).
// Issues on GitHub that are missing from tickets.json are listed so a curated
// entry (+ mock in render.mjs) can be added — that's the #29 convention.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tickets.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

const live = gh(['issue', 'list', '--repo', data.repo, '--state', 'all',
  '--limit', '200', '--json', 'number,title,state,labels']);
const byNum = Object.fromEntries(live.map((i) => [i.number, i]));

let changed = 0;
for (const t of data.issues) {
  const gi = byNum[t.number];
  if (!gi) { console.warn(`⚠ #${t.number} not found on GitHub`); continue; }
  const labels = gi.labels.map((l) => l.name);
  const statusLabel = (labels.find((l) => l.startsWith('status:')) || '').slice(7);
  const status = gi.state === 'CLOSED' ? 'done'
    : ['in-review', 'execute', 'blocked', 'plan'].includes(statusLabel) ? statusLabel
    : statusLabel === 'done' ? 'done' : 'plan';
  const next = { title: gi.title, state: gi.state.toLowerCase(), status };
  for (const [k, v] of Object.entries(next)) {
    if (t[k] !== v) { t[k] = v; changed++; }
  }
}

// Surface tickets that exist on GitHub but have no curated entry yet.
const known = new Set(data.issues.map((t) => t.number));
known.add(data.epic); // the epic orders the board; it isn't a node on it
const missing = live.filter((i) =>
  !known.has(i.number) && i.state === 'OPEN' &&
  !i.labels.some((l) => l.name === 'status:done'));
for (const m of missing) {
  console.warn(`⚠ open issue #${m.number} ("${m.title}") has no roadmap entry — add it to tickets.json + a mock in render.mjs`);
}

data.generatedAt = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`synced ${data.issues.length} tickets, ${changed} live fields updated${missing.length ? `, ${missing.length} unmapped open issues` : ''}`);

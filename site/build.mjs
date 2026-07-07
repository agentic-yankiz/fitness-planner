#!/usr/bin/env node
// Static-site generator for Shaked's workout plan.
//
// Reads the project's Markdown (the source of truth) and emits a single,
// light, junk-free HTML page into ./dist:
//   - the day-by-day plan from PLAN.md
//   - a "this week" hero that marks the current week of the 4-week wave
//   - a progress section parsed from tracking/week-*.md
//   - a footer stamped with the build commit + deploy time
//
// No framework, no runtime third-party requests. markdown-it is the only dep.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { buildRoadmap } from './roadmap/render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');        // workout-program/
const SITE = __dirname;                              // workout-program/site/
const DIST = path.join(SITE, 'dist');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// ---------- helpers ----------
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadConfig() {
  const def = {
    title: "Shaked's Workout Plan",
    waveWeeks: 4,
    deloadWeek: 5,
    currentWeek: { block: 1, week: 1 },
    showMetrics: true,
  };
  try {
    return { ...def, ...JSON.parse(readIf(path.join(SITE, 'config.json'))) };
  } catch {
    return def;
  }
}

// ---------- current week ----------
// Source of truth: the newest tracking/week-*.md, whose first line is
// "# Training Log — Block N / Week M". Falls back to config.
function detectCurrentWeek(cfg) {
  const trackingDir = path.join(ROOT, 'tracking');
  let logs = [];
  if (fs.existsSync(trackingDir)) {
    logs = fs.readdirSync(trackingDir)
      .filter((f) => /^week-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
  }
  if (logs.length) {
    const newest = logs[logs.length - 1];
    const head = readIf(path.join(trackingDir, newest)).split('\n')[0] || '';
    const m = head.match(/Block\s*(\d+)\s*\/\s*Week\s*(\d+)/i);
    if (m) {
      return { block: Number(m[1]), week: Number(m[2]), source: newest, logs };
    }
  }
  return { ...cfg.currentWeek, source: 'config.json', logs };
}

// ---------- wave table → per-week levers ----------
// Pull the "How each week gets harder" markdown table out of PLAN.md so the
// hero can show what's different about the current week. Best-effort.
function weekLevers(planMd, week) {
  const lines = planMd.split('\n');
  const start = lines.findIndex((l) => /how each week gets harder/i.test(l));
  if (start === -1) return [];
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('##') && i > start) break;
    if (l.startsWith('|')) rows.push(l);
  }
  if (rows.length < 2) return [];
  const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
  const header = cells(rows[0]);              // ['', 'Week 1', 'Week 2', ...]
  // Column whose header mentions "Week <week>".
  let col = header.findIndex((h) => new RegExp(`week\\s*${week}\\b`, 'i').test(h));
  if (col === -1) return [];
  const out = [];
  for (const r of rows.slice(2)) {            // skip header + separator
    const c = cells(r);
    const label = c[0]?.replace(/\*\*/g, '');
    const val = c[col]?.replace(/\*\*/g, '');
    if (label && val && val !== '—') out.push({ label, val });
  }
  return out;
}

function heroHtml(cfg, cur, planMd) {
  const isDeload = cur.week >= cfg.deloadWeek;
  const phase = isDeload ? 'deload — recover' : 'loading';
  const ofN = isDeload ? `Week ${cur.week} (deload)` : `Week ${cur.week} of ${cfg.waveWeeks}`;
  const levers = weekLevers(planMd, cur.week);
  const leverList = levers.length
    ? `<ul class="levers">${levers
        .map((x) => `<li><span class="k">${esc(x.label)}</span><span class="v">${esc(x.val)}</span></li>`)
        .join('')}</ul>`
    : '';
  const note =
    cur.source && cur.source.endsWith('.md')
      ? `from <code>tracking/${esc(cur.source)}</code>`
      : `set in <code>config.json</code> — log a week to track it automatically`;
  return `
<section class="hero ${isDeload ? 'deload' : ''}" aria-label="Current week">
  <div class="hero-badge">Block ${esc(cur.block)} · ${esc(ofN)}</div>
  <div class="hero-phase">${esc(phase)}</div>
  ${leverList}
  <p class="hero-note">${note}. The day tables below are the base plan — scale the main lifts to this week.</p>
</section>`;
}

// ---------- progress ----------
function parseCheckins(logs) {
  const trackingDir = path.join(ROOT, 'tracking');
  const series = [];
  for (const f of logs) {
    const date = (f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || f;
    const body = readIf(path.join(trackingDir, f));
    const num = (label) => {
      // Match a table row whose first cell *contains* the label (e.g.
      // "Left shoulder pain (0–10)") and whose second cell is a number.
      const re = new RegExp(`\\|[^|]*${label}[^|]*\\|\\s*([0-9]+(?:\\.[0-9]+)?)\\s*\\|`, 'i');
      const m = body.match(re);
      return m ? Number(m[1]) : null;
    };
    series.push({
      date,
      bodyweight: num('Bodyweight'),
      shoulderPain: num('shoulder pain'),
      protein: num('protein'),
    });
  }
  return series;
}

function sparkline(points, { w = 220, h = 44, pad = 4 } = {}) {
  const vals = points.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const step = (w - pad * 2) / (vals.length - 1);
  const pts = vals
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
  const last = pts.split(' ').pop().split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="currentColor"/>
  </svg>`;
}

function metricRow(label, series, key, unit, { lowerIsBetter = false } = {}) {
  const pts = series.map((s) => s[key]);
  const present = pts.filter((v) => typeof v === 'number');
  if (!present.length) return '';
  const latest = present[present.length - 1];
  const first = present[0];
  const delta = latest - first;
  const arrow = delta === 0 ? '→' : delta > 0 ? '▲' : '▼';
  const good = delta === 0 ? '' : (delta < 0) === lowerIsBetter ? 'good' : 'warn';
  return `<tr>
    <th scope="row">${esc(label)}</th>
    <td class="num">${esc(latest)}${unit ? ` <span class="unit">${esc(unit)}</span>` : ''}</td>
    <td class="trend ${good}">${arrow} ${esc(Math.abs(delta).toFixed(1))}</td>
    <td class="sparkcell">${sparkline(pts)}</td>
  </tr>`;
}

function progressHtml(cfg, cur) {
  if (!cfg.showMetrics) return '';
  const series = parseCheckins(cur.logs || []);
  const haveData = series.some((s) => s.bodyweight != null || s.shoulderPain != null);
  if (!haveData) {
    return `
<section class="progress" aria-label="Progress">
  <h2>Progress</h2>
  <p class="empty">No logs yet — fill <code>tracking/</code> each week and your bodyweight, shoulder-pain, and benchmark trends show up here automatically.</p>
</section>`;
  }
  const rows = [
    metricRow('Bodyweight', series, 'bodyweight', 'kg', { lowerIsBetter: true }),
    metricRow('Left shoulder pain', series, 'shoulderPain', '/10', { lowerIsBetter: true }),
    metricRow('Avg protein', series, 'protein', 'g'),
  ].filter(Boolean).join('');
  return `
<section class="progress" aria-label="Progress">
  <h2>Progress</h2>
  <table class="metrics">
    <thead><tr><th>Metric</th><th>Latest</th><th>Δ since start</th><th>Trend</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="empty">Rising shoulder pain is never a win — see <a href="https://github.com/agentic-yankiz/fitness-planner/blob/main/knowledge/shoulder-physio.md">shoulder-physio</a>.</p>
</section>`;
}

// ---------- today-highlight script ----------
function todayScript(cfg) {
  const keywords = cfg.trainingDayKeywords || {};
  if (!Object.keys(keywords).length) return '';
  const map = JSON.stringify(keywords);
  return `<script>
(function(){try{
  var map=${map};
  var kw=map[new Date().getDay()];
  if(!kw)return;
  var hs=document.querySelectorAll('.plan h2');
  for(var i=0;i<hs.length;i++){
    if(hs[i].textContent.toLowerCase().indexOf(kw.toLowerCase())!==-1){
      hs[i].classList.add('today');
      if(window.innerWidth<640)hs[i].scrollIntoView({behavior:'smooth',block:'start'});
      break;
    }
  }
}catch(e){}})();
</script>`;
}

// ---------- page ----------
function page({ cfg, cur, planHtml, hero, progress, version, builtAt, basePath }) {
  const shaUrl = version.sha !== 'dev'
    ? `https://github.com/agentic-yankiz/fitness-planner/commit/${version.full}`
    : null;
  const stamp = shaUrl
    ? `<a href="${shaUrl}">v ${esc(version.sha)}</a> · deployed ${esc(builtAt)}`
    : `local build · ${esc(builtAt)}`;
  const baseTag = basePath ? `<base href="${esc(basePath)}/">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(cfg.title)}</title>
${baseTag}
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main>
  <header class="top">
    <h1>${esc(cfg.title)}</h1>
  </header>
  ${hero}
  ${progress}
  <article class="plan">
    ${planHtml}
  </article>
  <footer class="stamp">
    <span>${stamp}</span>
    <span class="src">source: <code>PLAN.md</code></span>
  </footer>
</main>
${todayScript(cfg)}</body>
</html>`;
}

// ---------- build ----------
function build() {
  const cfg = loadConfig();
  const planMd = readIf(path.join(ROOT, 'PLAN.md'));
  const cur = detectCurrentWeek(cfg);

  const version = (() => {
    const full = process.env.GIT_SHA || '';
    return full ? { full, sha: full.slice(0, 7) } : { full: '', sha: 'dev' };
  })();
  const builtAt = process.env.BUILD_TIME ||
    new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');

  const html = page({
    cfg,
    cur,
    planHtml: md.render(planMd),
    hero: heroHtml(cfg, cur, planMd),
    progress: progressHtml(cfg, cur),
    version,
    builtAt,
    basePath,
  });

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  fs.copyFileSync(path.join(SITE, 'styles.css'), path.join(DIST, 'styles.css'));

  buildRoadmap(DIST, { version: version.sha, builtAt });

  console.log(
    `Built dist/index.html — Block ${cur.block} Week ${cur.week} ` +
    `(${cur.source}), version ${version.sha}, ${builtAt}`
  );
}

build();

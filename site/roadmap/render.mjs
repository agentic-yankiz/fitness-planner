// Roadmap UI generator (issue #33).
//
// Renders site/roadmap/tickets.json into dist/roadmap/index.html:
//   - an SVG dependency graph of the tickets (columns = phases, colour = status)
//   - a panel per ticket: a visual mock of WHAT THE TICKET DELIVERS + details
//
// The build is offline: it renders the committed snapshot. Refresh live fields
// with `node site/roadmap/sync-tickets.mjs` (see that file) whenever tickets change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- layout ----------
const NODE_W = 172, NODE_H = 58, COL_GAP = 210, ROW_GAP = 84, PAD = 24;

const STATUS = {
  done:      { label: 'done',        color: '#2f6f4f' },
  'in-review': { label: 'in review', color: '#0075ca' },
  execute:   { label: 'executing',   color: '#b45309' },
  blocked:   { label: 'blocked',     color: '#b4453a' },
  plan:      { label: 'planned',     color: '#6b7280' },
};

function nodePos(t) {
  return { x: PAD + t.phase * COL_GAP, y: PAD + t.row * ROW_GAP };
}

function svgGraph(issues) {
  const byNum = Object.fromEntries(issues.map((t) => [t.number, t]));
  const maxPhase = Math.max(...issues.map((t) => t.phase));
  const maxRow = Math.max(...issues.map((t) => t.row));
  const W = PAD * 2 + maxPhase * COL_GAP + NODE_W;
  const H = PAD * 2 + maxRow * ROW_GAP + NODE_H + 18;

  const edges = issues.flatMap((t) =>
    t.deps.filter((d) => byNum[d]).map((d) => {
      const a = nodePos(byNum[d]), b = nodePos(t);
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
      const x2 = b.x, y2 = b.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      return `<path class="edge" data-from="${d}" data-to="${t.number}"
        d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" />`;
    })
  ).join('\n');

  const phaseLabels = Array.from({ length: maxPhase + 1 }, (_, p) =>
    `<text class="phase-label" x="${PAD + p * COL_GAP + NODE_W / 2}" y="${H - 6}">phase ${p}</text>`
  ).join('');

  const nodes = issues.map((t) => {
    const { x, y } = nodePos(t);
    const st = STATUS[t.status] || STATUS.plan;
    return `
  <g class="node" data-node="${t.number}" transform="translate(${x},${y})" tabindex="0"
     role="button" aria-label="Ticket ${t.number}: ${esc(t.short)}, ${st.label}">
    <rect class="node-box" width="${NODE_W}" height="${NODE_H}" rx="9"/>
    <rect class="node-bar" width="5" height="${NODE_H}" rx="2.5" fill="${st.color}"/>
    <text class="node-num" x="16" y="22">#${t.number}</text>
    <text class="node-status" x="${NODE_W - 12}" y="22" text-anchor="end" fill="${st.color}">${st.label}</text>
    <text class="node-title" x="16" y="43">${esc(t.short)}</text>
  </g>`;
  }).join('\n');

  return `<svg id="graph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
    role="group" aria-label="Ticket dependency graph">
    <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,0 L8,4 L0,8 z" fill="#c9c5bd"/></marker></defs>
    ${edges}${phaseLabels}${nodes}
  </svg>`;
}

// ---------- per-ticket demos ----------
// Each returns static HTML; interactive wiring lives in CLIENT_JS keyed by demo name.
const DEMOS = {
  today: () => `
    <p class="rm-note">The plan page finds today's session and highlights it (auto-scroll on phones).
    This strip is computed <em>right now</em> from your device clock — the same logic the site uses:</p>
    <div class="rm-week" id="rm-today-strip"></div>
    <p class="rm-caption">Driven by <code>trainingDayKeywords</code> in <code>config.json</code>. Shipped.</p>`,

  history: () => `
    <p class="rm-note">Ten weeks of the real coach program now live in <code>tracking/history/</code>,
    and the athlete profile was reset from wishful to actual:</p>
    <table class="rm-table"><thead><tr><th>Benchmark</th><th>profile said</th><th>reality (imported)</th></tr></thead>
    <tbody>
      <tr><td>Weighted chin-up</td><td>+30 kg</td><td class="rm-up">+40 kg × 4</td></tr>
      <tr><td>Max hang 14 mm</td><td>+20 kg</td><td class="rm-up">+22.5 kg × 8 s</td></tr>
      <tr><td>One-arm pull-up</td><td>—</td><td class="rm-up">assisted −7.5 kg × 3</td></tr>
      <tr><td>Box squat / RDL</td><td>—</td><td class="rm-up">100 kg / 100 kg</td></tr>
      <tr><td>Climbing</td><td>V6 project</td><td class="rm-up">V6 sends ×3 🎉</td></tr>
    </tbody></table>
    <p class="rm-caption">Skipped sessions kept honest (<b>SKIPPED (0)</b>) — the plan rebuild feeds on this data.</p>`,

  plan: () => `
    <p class="rm-note">Rewrites <code>PLAN.md</code> as the next cycle, seeded from the imported numbers.
    Blocked on three decisions only Shaked can make:</p>
    <div class="rm-gates">
      <label><input type="checkbox" disabled> Days/week going forward — profile says <b>4–5</b>, the real program ran <b>6</b></label>
      <label><input type="checkbox" disabled> Planche: still goal #2? (the real program barely trained it)</label>
      <label><input type="checkbox" disabled> Who programs now — the coach's spreadsheet or this repo?</label>
    </div>
    <div class="rm-beforeafter">
      <div class="rm-card"><b>Now</b><br>4-day template<br>planche-lean day<br>stale loads</div>
      <div class="rm-arrow">→</div>
      <div class="rm-card rm-card-good"><b>Cycle 3</b><br>confirmed schedule<br>real baselines<br>physio-gated ramps</div>
    </div>`,

  physio: () => `
    <p class="rm-note">Every pulling/pressing exercise in the new plan gets an anterior-shoulder risk rating
    and an entry rule. Mock of the audit table:</p>
    <table class="rm-table"><thead><tr><th>Exercise</th><th>risk</th><th>rule</th></tr></thead><tbody>
      <tr><td>Weighted dips +20 kg</td><td><span class="rm-chip rm-y">yellow</span></td><td>pain ≤2/10, no depth past 90°</td></tr>
      <tr><td>Chin-up iso +40 kg</td><td><span class="rm-chip rm-y">yellow</span></td><td>ramp +5 kg/cycle max</td></tr>
      <tr><td>OAP negatives</td><td><span class="rm-chip rm-g">green</span></td><td>as programmed</td></tr>
      <tr><td>L-sit → tuck planche</td><td><span class="rm-chip rm-r">red</span></td><td>substitute until pain-free 2 wks</td></tr>
    </tbody></table>
    <p class="rm-caption"><b>Shoulder gate:</b> flagged loads never advance while pain trends up. Not medical advice — see a physio.</p>`,

  library: () => `
    <p class="rm-note">~35 exercises from the real program, each documented like this — every video verified live:</p>
    <div class="rm-card rm-exercise">
      <b>Skin the cat</b> <span class="rm-muted">(spreadsheet: "Skin the cat")</span><br>
      <span class="rm-muted">shoulder mobility + straight-arm strength → front lever, OAP health</span>
      <ul><li>slow through German hang, 5 s pause at reverse position</li>
      <li>regress: tuck skin-the-cat · progress: straddle</li></ul>
      <span class="rm-video">▶ Skin the Cat Tutorial — verified ✓</span>
    </div>
    <p class="rm-caption">Grouped: fingers · pull · push · hinge/squat · core · climbing-endurance · prehab.</p>`,

  design: () => `
    <p class="rm-note">Four docs (brief · IA/flows · wireframes · components) defining the phone-first UI.
    The core wireframe, rendered:</p>
    <div class="rm-phone">
      <div class="rm-ph-hero">Block 1 · Week 3 of 4 <span class="rm-ph-badge">LOADING</span></div>
      <div class="rm-ph-day">TODAY · Tuesday · 💪 Strength A</div>
      <div class="rm-ph-done">✓ MARK TRAINED</div>
      <div class="rm-ph-row">Weighted pull-up <span>4×4–5 · 3 min ▶</span></div>
      <div class="rm-ph-row">One-arm negatives <span>3×2/s · 2–3 min ▶</span></div>
      <div class="rm-ph-tabs"><b>Today</b><span>Week</span><span>Stats</span></div>
    </div>
    <p class="rm-caption rm-warn">⏸ PR #31 open — Shaked's approval is the gate before #25 builds it.</p>`,

  sitev2: () => `
    <p class="rm-note">The approved spec, implemented. Tap the tabs — this is the interaction model:</p>
    <div class="rm-phone" id="rm-v2">
      <div class="rm-v2-screen" data-screen="today">
        <div class="rm-ph-hero">Block 1 · Week 3 of 4 <span class="rm-ph-badge">LOADING</span></div>
        <div class="rm-ph-day">TODAY · Tuesday · 💪 Strength A</div>
        <div class="rm-ph-done">✓ MARK TRAINED</div>
        <div class="rm-ph-row">Weighted pull-up <span>4×4–5 ▶</span></div>
        <div class="rm-ph-row">Repeaters 14 mm <span>3×(7/3) ▶</span></div>
      </div>
      <div class="rm-v2-screen" data-screen="week" hidden>
        <div class="rm-ph-row">Mon 🧗 Boulder <span class="rm-g2">✓ done</span></div>
        <div class="rm-ph-row rm-ph-today">Tue 💪 Strength A <span class="rm-g2">TODAY ✓</span></div>
        <div class="rm-ph-row">Wed 😌 Rest <span>—</span></div>
        <div class="rm-ph-row">Thu 🧗 Boulder <span>·</span></div>
        <div class="rm-ph-row">Fri 💪 Strength B <span>·</span></div>
      </div>
      <div class="rm-v2-screen" data-screen="stats" hidden>
        <div class="rm-ph-stats"><b>🔥 5</b><span>streak</span><b>12</b><span>best</span><b>75%</b><span>week</span></div>
        <div class="rm-ph-cal">▓▓·▓▓··<br>▓▓·✗▓··<br>▓▓·▓▓··<br>▓▓·▢▢··</div>
      </div>
      <div class="rm-ph-tabs" id="rm-v2-tabs">
        <button data-tab="today" class="on">Today</button><button data-tab="week">Week</button><button data-tab="stats">Stats</button>
      </div>
    </div>`,

  server: () => `
    <p class="rm-note">A small Node server owns runtime state (SQLite) behind <code>/fitness/api/*</code>.
    Its auth middleware in action — fire a request:</p>
    <div class="rm-btnrow">
      <button class="rm-btn" data-req="shaked">POST /api/done — Shaked's phone (tailnet)</button>
      <button class="rm-btn" data-req="guest">POST /api/done — tailnet guest</button>
      <button class="rm-btn" data-req="bot">POST /api/done — local bot (127.0.0.1)</button>
      <button class="rm-btn" data-req="lan">POST — Wi-Fi attacker → :8080</button>
    </div>
    <pre class="rm-console" id="rm-srv-out">← choose a request to see headers → middleware → response</pre>
    <p class="rm-caption">Also in the box: <code>migrations/001_sessions.sql</code> + <code>schema_migrations</code> · nightly DB backups ×14 · Caddy reverse-proxy on a loopback-only bind.</p>`,

  done: () => `
    <p class="rm-note">One tap records today as trained. This mock runs the real state machine from the spec —
    tap it:</p>
    <button class="rm-donebtn" id="rm-done">✓&nbsp; MARK TRAINED</button>
    <div class="rm-caption" id="rm-done-note">state: actionable · POST /fitness/api/done is idempotent — re-taps return 200, never a duplicate row · survives refresh via GET /api/done/today</div>`,

  stats: () => `
    <p class="rm-note">Adherence from the sessions table. Rest days are neutral — only scheduled days can be "missed":</p>
    <div class="rm-ph-stats rm-stats-lg"><b>🔥 5</b><span>streak</span><b>12</b><span>longest</span><b>3/4</b><span>this wk</span><b>79%</b><span>month</span></div>
    <table class="rm-cal"><tr><th>M</th><th>T</th><th>W</th><th>T</th><th>F</th><th>S</th><th>S</th></tr>
      <tr><td class="c-t">▓</td><td class="c-t">▓</td><td class="c-r">·</td><td class="c-t">▓</td><td class="c-t">▓</td><td class="c-r">·</td><td class="c-r">·</td></tr>
      <tr><td class="c-t">▓</td><td class="c-t">▓</td><td class="c-r">·</td><td class="c-m">✗</td><td class="c-t">▓</td><td class="c-r">·</td><td class="c-r">·</td></tr>
      <tr><td class="c-t">▓</td><td class="c-t">▓</td><td class="c-r">·</td><td class="c-t">▓</td><td class="c-f">▢</td><td class="c-r">·</td><td class="c-r">·</td></tr>
    </table>
    <p class="rm-caption">▓ trained · ✗ missed · ▢ upcoming · rest neutral — SSR page + JSON for the Telegram <code>/stats</code>.</p>`,

  tailscale: () => `
    <p class="rm-note">One shared tailnet host, one path per project, never Funnel. Trace a request:</p>
    <div class="rm-btnrow">
      <button class="rm-btn" data-ts="tail">From a tailnet device</button>
      <button class="rm-btn" data-ts="lan">From the coffee-shop Wi-Fi → :8080</button>
    </div>
    <div class="rm-topo" id="rm-ts-out">📱 phone ─→ 🔒 ts.net/fitness ─→ caddy@127.0.0.1 ─→ node<br><span class="rm-muted">choose a source above</span></div>
    <p class="rm-caption">Path convention: <code>HOST/fitness</code> today, <code>HOST/&lt;next-project&gt;</code> tomorrow, root reserved for an index. Doc merged (PR #30); write-auth ships inside #16.</p>`,

  telegram: () => `
    <p class="rm-note">Off-tailnet access from anywhere — but the bot answers exactly one Telegram user ID and is silent to everyone else. Try it:</p>
    <div class="rm-chat" id="rm-chat"><div class="rm-msg rm-bot">Bot online. Long-polling from the laptop — nothing exposed to the internet.</div></div>
    <div class="rm-btnrow">
      <button class="rm-btn" data-tg="/today">/today</button>
      <button class="rm-btn" data-tg="/done">/done</button>
      <button class="rm-btn" data-tg="/stats">/stats</button>
      <button class="rm-btn" data-tg="stranger">😈 stranger sends /done</button>
    </div>`,

  pipeline: () => `
    <p class="rm-note">Two stores, one contract: markdown owns the program + curated history; SQLite owns live capture. The export closes the loop — as a reviewed PR, never a direct push:</p>
    <div class="rm-flow">
      <span class="rm-flownode">SQLite<br><small>done flags · quick logs</small></span><span class="rm-arrow">→</span>
      <span class="rm-flownode">export-tracking.mjs</span><span class="rm-arrow">→</span>
      <span class="rm-flownode">PR (agent + review)</span><span class="rm-arrow">→</span>
      <span class="rm-flownode">tracking/week-*.md</span><span class="rm-arrow">→</span>
      <span class="rm-flownode">advance-week</span>
    </div>
    <pre class="rm-console"># exported by pipeline · source: web+telegram
| One-arm pull-up (assisted) | −7.5 kg × 3 | RPE 9 | shoulder 1/10 |
| Trained: YES · 18:42 |</pre>
    <p class="rm-caption">Plus a backfill: spreadsheet-era history → sessions table, so streaks include the past.</p>`,

  sqlite: () => `
    <p class="rm-note">Born from a real incident: the server deploy broke twice on native-module ABI drift
    (dev shell runs Node 18, the launchd service Node 26 — better-sqlite3's binary can't serve both masters).</p>
    <div class="rm-flow">
      <span class="rm-flownode">better-sqlite3<br><small>native .node binary · ABI per Node version</small></span>
      <span class="rm-arrow">→</span>
      <span class="rm-flownode">node:sqlite<br><small>built into Node ≥22.5 · zero deps</small></span>
    </div>
    <pre class="rm-console">- import Database from 'better-sqlite3';
+ import { DatabaseSync } from 'node:sqlite';
  // prepare / run / get / all / exec: unchanged</pre>
    <p class="rm-caption">Kills the whole failure class of PRs #37/#38. Same migrations, same auth tests, same backups.</p>`,

  roadmap: () => `
    <p class="rm-note"><b>You're looking at it.</b> This page is rebuilt on every site build from
    <code>site/roadmap/tickets.json</code>: live fields (title/state/status) refresh from GitHub via
    <code>sync-tickets.mjs</code>; curated fields (dependencies, phases, these mocks) are updated by whichever
    agent changes a ticket — that's now a convention on epic #29.</p>
    <div class="rm-flow">
      <span class="rm-flownode">GitHub issues</span><span class="rm-arrow">→</span>
      <span class="rm-flownode">sync-tickets.mjs</span><span class="rm-arrow">→</span>
      <span class="rm-flownode">tickets.json</span><span class="rm-arrow">→</span>
      <span class="rm-flownode">build.mjs</span><span class="rm-arrow">→</span>
      <span class="rm-flownode">/fitness/roadmap/</span>
    </div>`,
};

// ---------- client script ----------
// Plain string, no template placeholders. DATA is injected before it.
const CLIENT_JS = String.raw`
(function () {
  'use strict';
  var byNum = {};
  DATA.issues.forEach(function (t) { byNum[t.number] = t; });
  var panel = document.getElementById('panel');
  var current = null;

  function esch(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function depChips(t) {
    if (!t.deps.length) return '<span class="rm-muted">none — can start anytime</span>';
    return t.deps.map(function (d) {
      var dt = byNum[d];
      return '<button class="rm-depchip" data-goto="' + d + '">#' + d +
        (dt ? ' ' + esch(dt.short) : '') + '</button>';
    }).join(' ');
  }
  function dependents(t) {
    var out = DATA.issues.filter(function (x) { return x.deps.indexOf(t.number) !== -1; });
    if (!out.length) return '<span class="rm-muted">nothing waits on this</span>';
    return out.map(function (d) {
      return '<button class="rm-depchip" data-goto="' + d.number + '">#' + d.number + ' ' + esch(d.short) + '</button>';
    }).join(' ');
  }

  function select(num, push) {
    var t = byNum[num];
    if (!t) return;
    current = num;
    document.querySelectorAll('.node').forEach(function (n) {
      n.classList.toggle('sel', Number(n.getAttribute('data-node')) === num);
    });
    document.querySelectorAll('.edge').forEach(function (e) {
      e.classList.toggle('hot',
        Number(e.getAttribute('data-from')) === num || Number(e.getAttribute('data-to')) === num);
    });
    var st = DATA.statusMeta[t.status] || DATA.statusMeta.plan;
    panel.innerHTML =
      '<div class="rm-head">' +
        '<span class="rm-status" style="background:' + st.color + '">' + st.label + '</span>' +
        '<h2>#' + t.number + ' — ' + esch(t.short) + '</h2>' +
        '<a class="rm-gh" target="_blank" rel="noopener" href="https://github.com/' + DATA.repo + '/issues/' + t.number + '">open on GitHub ↗</a>' +
      '</div>' +
      '<p class="rm-fulltitle">' + esch(t.title) + '</p>' +
      '<div class="rm-tabs"><button class="on" data-ptab="demo">What it does</button><button data-ptab="info">Details</button></div>' +
      '<div class="rm-body" data-pane="demo">' + t.demoHtml + '</div>' +
      '<div class="rm-body" data-pane="info" hidden>' +
        '<p>' + esch(t.summary) + '</p>' +
        '<table class="rm-table rm-info">' +
        '<tr><th>Agents</th><td>' + esch(t.agents) + '</td></tr>' +
        '<tr><th>Phase</th><td>' + t.phase + '</td></tr>' +
        '<tr><th>Depends on</th><td>' + depChips(t) + '</td></tr>' +
        '<tr><th>Unblocks</th><td>' + dependents(t) + '</td></tr>' +
        '</table>' +
      '</div>';
    initDemo(t);
    if (push !== false) location.hash = String(num);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ----- demo wiring -----
  function initDemo(t) {
    var q = function (sel) { return panel.querySelector(sel); };
    var qa = function (sel) { return panel.querySelectorAll(sel); };

    if (t.demo === 'today') {
      var strip = q('#rm-today-strip');
      if (strip) {
        var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var kinds = ['😌 rest', '🧗 boulder', '💪 pull', '😌 rest', '🧗 boulder', '💪 push', '⭐ opt'];
        var today = new Date().getDay();
        var html = '';
        for (var i = 1; i <= 7; i++) {
          var d = i % 7;
          html += '<div class="rm-daychip' + (d === today ? ' rm-today' : '') + '"><b>' + names[d] + '</b><span>' + kinds[d] + '</span></div>';
        }
        strip.innerHTML = html;
      }
    }

    if (t.demo === 'done') {
      var btn = q('#rm-done'), note = q('#rm-done-note');
      var state = 'idle';
      if (btn) btn.addEventListener('click', function () {
        if (state === 'idle') {
          state = 'saving';
          btn.textContent = '✓  TRAINED  · saving…';
          btn.classList.add('saving');
          note.textContent = 'optimistic flip → POST /fitness/api/done';
          setTimeout(function () {
            state = 'confirmed';
            var now = new Date();
            var hm = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
            btn.innerHTML = '✓  TRAINED · ' + hm + ' &nbsp; <u>Undo</u>';
            btn.classList.remove('saving'); btn.classList.add('confirmed');
            note.textContent = '200 { date, done: true, logged_at } — re-tap = 200 no-op, no duplicate rows';
          }, 650);
        } else if (state === 'confirmed') {
          state = 'idle';
          btn.textContent = '✓  MARK TRAINED';
          btn.classList.remove('confirmed');
          note.textContent = 'undone (local) · state: actionable again';
        }
      });
    }

    if (t.demo === 'server') {
      var out = q('#rm-srv-out');
      var CASES = {
        shaked: '> POST /fitness/api/done  (via ts.net proxy)\n> Tailscale-User-Login: klein.shaked@gmail.com\n\nmiddleware: identity == owner  →  ALLOW\n\n200 { "date": "TODAY", "done": true, "logged_at": "…" }',
        guest:  '> POST /fitness/api/done  (via ts.net proxy)\n> Tailscale-User-Login: guest@example.com\n\nmiddleware: identity != owner  →  DENY\n\n403 { "error": "forbidden" }',
        bot:    '> POST /fitness/api/done  (direct, remote_addr 127.0.0.1)\n> (no identity header)\n\nmiddleware: loopback + no header → local automation  →  ALLOW\n\n200 { "date": "TODAY", "done": true }',
        lan:    '> POST http://192.168.1.23:8080/fitness/api/done\n\n✗ connection refused — Caddy binds 127.0.0.1 only.\nThe LAN never reaches the server at all.',
      };
      qa('[data-req]').forEach(function (b) {
        b.addEventListener('click', function () {
          out.textContent = CASES[b.getAttribute('data-req')].replace('TODAY', new Date().toISOString().slice(0, 10));
        });
      });
    }

    if (t.demo === 'tailscale') {
      var box = q('#rm-ts-out');
      qa('[data-ts]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-ts') === 'tail') {
            box.innerHTML = '📱 phone ─→ 🔒 ts.net/fitness ─→ caddy@127.0.0.1 ─→ node<br><span class="rm-ok">✓ 200 — device is on the tailnet; identity header injected by Tailscale</span>';
          } else {
            box.innerHTML = '☕ laptop-lan-ip:8080 ─→ ✗<br><span class="rm-bad">✗ connection refused — loopback bind; and ts.net is unreachable off-tailnet (no Funnel)</span>';
          }
        });
      });
    }

    if (t.demo === 'sitev2') {
      var tabs = q('#rm-v2-tabs');
      if (tabs) tabs.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        tabs.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        qa('.rm-v2-screen').forEach(function (s) {
          s.hidden = s.getAttribute('data-screen') !== b.getAttribute('data-tab');
        });
      });
    }

    if (t.demo === 'telegram') {
      var chat = q('#rm-chat');
      var REPLIES = {
        '/today': '💪 Strength A — Pull · 7 exercises\nMax hang 3×8s +22.5 kg · OAP −7.5 kg 3×3 · chin-up +40 kg…\nFull list: /fitness',
        '/done':  '✅ Marked trained · streak 6 🔥  (same endpoint as the site button — idempotent)',
        '/stats': '🔥 streak 6 · best 12 · week 3/4 · month 79%',
      };
      qa('[data-tg]').forEach(function (b) {
        b.addEventListener('click', function () {
          var cmd = b.getAttribute('data-tg');
          if (cmd === 'stranger') {
            chat.insertAdjacentHTML('beforeend',
              '<div class="rm-msg rm-them">😈 /done</div><div class="rm-msg rm-sys">…silence. Unknown user ID: ignored, no reply, audit-logged. The bot does not reveal it exists.</div>');
          } else {
            chat.insertAdjacentHTML('beforeend',
              '<div class="rm-msg rm-me">' + cmd + '</div><div class="rm-msg rm-bot">' + REPLIES[cmd].replace(/\n/g, '<br>') + '</div>');
          }
          chat.scrollTop = chat.scrollHeight;
        });
      });
    }
  }

  // panel tab switching + dep-chip navigation (delegated)
  panel.addEventListener('click', function (ev) {
    var tab = ev.target.closest('[data-ptab]');
    if (tab) {
      panel.querySelectorAll('[data-ptab]').forEach(function (b) { b.classList.toggle('on', b === tab); });
      panel.querySelectorAll('[data-pane]').forEach(function (p) {
        p.hidden = p.getAttribute('data-pane') !== tab.getAttribute('data-ptab');
      });
      return;
    }
    var chip = ev.target.closest('[data-goto]');
    if (chip) select(Number(chip.getAttribute('data-goto')));
  });

  document.querySelectorAll('.node').forEach(function (n) {
    var go = function () { select(Number(n.getAttribute('data-node'))); };
    n.addEventListener('click', go);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  var fromHash = Number((location.hash || '').replace('#', ''));
  select(byNum[fromHash] ? fromHash : DATA.defaultIssue, false);
})();
`;

const CSS = `
  body { max-width: none; }
  main { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
  .rm-legend { display:flex; gap:10px; flex-wrap:wrap; margin:6px 0 14px; font-size:.85rem; color:#6b7280; }
  .rm-legend span { display:inline-flex; align-items:center; gap:5px; }
  .rm-legend i { width:10px; height:10px; border-radius:3px; display:inline-block; }
  .graph-wrap { overflow-x:auto; border:1px solid #e7e5e0; border-radius:12px; background:#fff; padding:6px; }
  .edge { fill:none; stroke:#d8d5cf; stroke-width:1.6; marker-end:url(#arr); }
  .edge.hot { stroke:#2f6f4f; stroke-width:2.4; }
  .phase-label { font:600 11px/1 system-ui,sans-serif; fill:#a8a29a; text-anchor:middle; letter-spacing:.06em; }
  .node { cursor:pointer; }
  .node-box { fill:#fff; stroke:#e7e5e0; stroke-width:1.4; }
  .node:hover .node-box { stroke:#9aa39e; }
  .node.sel .node-box { stroke:#2f6f4f; stroke-width:2.4; fill:#eaf3ee; }
  .node-num { font:700 13px/1 system-ui,sans-serif; fill:#1f2933; }
  .node-status { font:600 10px/1 system-ui,sans-serif; letter-spacing:.04em; }
  .node-title { font:500 12px/1 system-ui,sans-serif; fill:#374151; }
  #panel { border:1px solid #e7e5e0; border-radius:12px; background:#fff; padding:18px 20px 22px; margin:18px 0 30px; min-height:340px; }
  .rm-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .rm-head h2 { margin:0; font-size:1.15rem; }
  .rm-status { color:#fff; font-size:.72rem; font-weight:700; letter-spacing:.05em; padding:3px 9px; border-radius:99px; text-transform:uppercase; }
  .rm-gh { margin-left:auto; font-size:.85rem; }
  .rm-fulltitle { color:#6b7280; margin:.35rem 0 0; font-size:.9rem; }
  .rm-tabs { display:flex; gap:8px; margin:14px 0; border-bottom:1px solid #e7e5e0; }
  .rm-tabs button { background:none; border:none; border-bottom:2.5px solid transparent; padding:6px 10px; font:600 .9rem system-ui,sans-serif; color:#6b7280; cursor:pointer; }
  .rm-tabs button.on { color:#2f6f4f; border-bottom-color:#2f6f4f; }
  .rm-note { margin:.2rem 0 .8rem; }
  .rm-caption { font-size:.82rem; color:#6b7280; margin-top:.8rem; }
  .rm-warn { color:#b45309; }
  .rm-muted { color:#6b7280; }
  .rm-table { border-collapse:collapse; width:100%; font-size:.9rem; }
  .rm-table th, .rm-table td { border:1px solid #e7e5e0; padding:6px 10px; text-align:left; }
  .rm-table thead th { background:#faf9f6; }
  .rm-info th { width:110px; background:#faf9f6; }
  .rm-up { color:#2f6f4f; font-weight:600; }
  .rm-chip { padding:2px 9px; border-radius:99px; font-size:.78rem; font-weight:700; color:#fff; }
  .rm-g { background:#2f6f4f; } .rm-y { background:#b45309; } .rm-r { background:#b4453a; }
  .rm-gates label { display:block; margin:6px 0; padding:8px 12px; background:#fdf3e7; border:1px solid #f0dcc3; border-radius:8px; }
  .rm-beforeafter, .rm-flow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:14px 0; }
  .rm-card { border:1px solid #e7e5e0; border-radius:10px; padding:10px 14px; background:#faf9f6; font-size:.88rem; line-height:1.5; }
  .rm-card-good { background:#eaf3ee; border-color:#bcd8c9; }
  .rm-arrow { font-size:1.3rem; color:#6b7280; }
  .rm-flownode { border:1px solid #e7e5e0; border-radius:10px; padding:8px 12px; background:#fff; font-size:.82rem; font-weight:600; text-align:center; }
  .rm-flownode small { font-weight:400; color:#6b7280; }
  .rm-exercise ul { margin:.4rem 0; padding-left:1.2rem; }
  .rm-video { color:#2f6f4f; font-weight:600; font-size:.88rem; }
  .rm-btnrow { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
  .rm-btn { border:1.5px solid #2f6f4f; color:#2f6f4f; background:#fff; border-radius:9px; padding:9px 13px; font:600 .85rem system-ui,sans-serif; cursor:pointer; min-height:44px; }
  .rm-btn:hover { background:#eaf3ee; }
  .rm-console { background:#1f2933; color:#e5e7eb; border-radius:10px; padding:12px 14px; font-size:.82rem; white-space:pre-wrap; min-height:70px; }
  .rm-donebtn { display:block; width:100%; max-width:420px; min-height:56px; border:none; border-radius:12px; background:#2f6f4f; color:#fff; font:700 1.05rem system-ui,sans-serif; cursor:pointer; letter-spacing:.03em; }
  .rm-donebtn.saving { opacity:.75; }
  .rm-donebtn.confirmed { background:#24573e; }
  .rm-week { display:flex; gap:6px; flex-wrap:wrap; }
  .rm-daychip { border:1px solid #e7e5e0; border-radius:9px; padding:7px 10px; text-align:center; font-size:.8rem; background:#fff; }
  .rm-daychip b { display:block; }
  .rm-daychip.rm-today { background:#eaf3ee; border-color:#2f6f4f; box-shadow:0 0 0 1.5px #2f6f4f inset; }
  .rm-phone { width:260px; border:2px solid #d8d5cf; border-radius:20px; padding:12px 10px 0; background:#faf9f6; }
  .rm-ph-hero { background:#eaf3ee; border-radius:9px; padding:7px 9px; font-size:.78rem; font-weight:600; }
  .rm-ph-badge { float:right; color:#2f6f4f; font-size:.68rem; }
  .rm-ph-day { font-size:.8rem; font-weight:700; margin:8px 2px 6px; color:#2f6f4f; }
  .rm-ph-done { background:#2f6f4f; color:#fff; border-radius:10px; text-align:center; padding:12px; font-weight:700; font-size:.85rem; margin-bottom:8px; }
  .rm-ph-row { display:flex; justify-content:space-between; gap:6px; font-size:.76rem; padding:7px 2px; border-top:1px solid #eceae5; }
  .rm-ph-row span { color:#6b7280; white-space:nowrap; }
  .rm-ph-today { background:#eaf3ee; border-radius:6px; padding-left:6px; padding-right:6px; }
  .rm-g2 { color:#2f6f4f !important; font-weight:700; }
  .rm-ph-tabs { display:flex; justify-content:space-around; border-top:1.5px solid #e7e5e0; margin-top:8px; padding:9px 0; font-size:.8rem; color:#6b7280; }
  .rm-ph-tabs b, .rm-ph-tabs button.on { color:#2f6f4f; }
  .rm-ph-tabs button { background:none; border:none; font:600 .8rem system-ui,sans-serif; color:#6b7280; cursor:pointer; padding:4px 10px; }
  .rm-ph-stats { display:flex; gap:14px; align-items:baseline; flex-wrap:wrap; padding:10px 4px; font-size:.8rem; }
  .rm-ph-stats b { font-size:1.15rem; }
  .rm-ph-stats span { color:#6b7280; margin-right:4px; }
  .rm-stats-lg { font-size:.95rem; }
  .rm-ph-cal { font-size:1rem; letter-spacing:4px; line-height:1.7; padding:4px; color:#2f6f4f; }
  .rm-cal { border-collapse:separate; border-spacing:4px; font-size:.95rem; }
  .rm-cal th { color:#6b7280; font-size:.72rem; }
  .rm-cal td { width:30px; height:30px; text-align:center; border-radius:6px; }
  .c-t { background:#eaf3ee; color:#2f6f4f; font-weight:700; }
  .c-m { background:#f7ebe9; color:#b4453a; font-weight:700; }
  .c-f { background:#f1efeb; color:#6b7280; }
  .c-r { color:#c9c5bd; }
  .rm-topo { border:1px solid #e7e5e0; border-radius:10px; padding:12px 14px; font-size:.88rem; line-height:1.9; background:#fff; }
  .rm-ok { color:#2f6f4f; font-weight:600; } .rm-bad { color:#b4453a; font-weight:600; }
  .rm-chat { border:1px solid #e7e5e0; border-radius:12px; background:#fff; padding:10px; max-height:230px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; }
  .rm-msg { max-width:85%; padding:7px 11px; border-radius:12px; font-size:.84rem; line-height:1.45; }
  .rm-me { align-self:flex-end; background:#eaf3ee; }
  .rm-bot { align-self:flex-start; background:#faf9f6; border:1px solid #eceae5; }
  .rm-them { align-self:flex-end; background:#f7ebe9; }
  .rm-sys { align-self:center; color:#6b7280; font-style:italic; background:none; font-size:.78rem; }
  .rm-depchip { border:1px solid #e7e5e0; background:#faf9f6; border-radius:99px; padding:3px 10px; font:600 .78rem system-ui,sans-serif; cursor:pointer; color:#1f2933; margin:2px 2px 2px 0; }
  .rm-depchip:hover { border-color:#2f6f4f; color:#2f6f4f; }
`;

export function buildRoadmap(DIST, { version = 'dev', builtAt = '' } = {}) {
  const data = JSON.parse(fs.readFileSync(path.join(HERE, 'tickets.json'), 'utf8'));
  const issues = data.issues.map((t) => ({
    ...t,
    demoHtml: (DEMOS[t.demo] || (() => '<p class="rm-muted">No mock yet — add one in site/roadmap/render.mjs.</p>'))(t),
  }));

  const clientData = {
    repo: data.repo,
    statusMeta: STATUS,
    defaultIssue: 33,
    issues: issues.map(({ number, short, title, summary, agents, phase, deps, status, demo, demoHtml }) =>
      ({ number, short, title, summary, agents, phase, deps, status, demo, demoHtml })),
  };

  const legend = Object.values(STATUS)
    .map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Roadmap — Shaked's Fitness Platform</title>
<link rel="stylesheet" href="../styles.css">
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="top"><h1>🗺️ Roadmap</h1></header>
  <p class="rm-note">Every ticket in the plan, how they depend on each other, and — click one — a working mock of
    what it delivers. Ordered by <a href="https://github.com/${esc(data.repo)}/issues/${data.epic}">epic #${data.epic}</a>.
    Snapshot: ${esc(data.generatedAt.slice(0, 10))}.</p>
  <div class="rm-legend">${legend}<span style="margin-left:auto">click a ticket ↓</span></div>
  <div class="graph-wrap">${svgGraph(issues)}</div>
  <section id="panel" aria-live="polite"></section>
  <footer class="stamp"><span>v ${esc(version)} · ${esc(builtAt)}</span><span class="src">source: <code>site/roadmap/tickets.json</code></span></footer>
</main>
<script>var DATA = ${JSON.stringify(clientData)};<\/script>
<script>${CLIENT_JS}</script>
</body>
</html>`;

  const outDir = path.join(DIST, 'roadmap');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`Built dist/roadmap/index.html — ${issues.length} tickets`);
}

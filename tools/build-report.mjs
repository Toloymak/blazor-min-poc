#!/usr/bin/env node
// Builds a self-contained HTML report from results/experiments.jsonl.
// Usage: node tools/build-report.mjs <out.html> [--home <href>] [--repo <url>]
//   Writes a complete HTML document for a static site (report.html next to the landing page), with a link back to
//   the landing page (--home, default "./") and, if --repo is given, to the README. --standalone is accepted and ignored
//   (it was the only mode left).
// Output is deterministic: same input gives the same bytes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opts = { home: './', repo: null };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--standalone') { /* no-op: the standalone page is the only output */ }
  else if (a === '--home' || a === '--repo') { const v = argv[++i]; if (v == null) { console.error(`missing value for ${a}`); process.exit(2); } opts[a.slice(2)] = v; }
  else if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
  else pos.push(a);
}
const OUT = pos[0];
if (!OUT || pos.length > 1) {
  console.error('usage: node tools/build-report.mjs <out.html> [--home <href>] [--repo <url>]');
  process.exit(2);
}
if (opts.repo != null && !/^https:\/\/\S+$/.test(opts.repo)) { console.error('--repo must be an https:// URL'); process.exit(2); }

// ---------- config ----------
const TARGET = 1_100_000;
const IDS = { baseline: 'baseline', recipe: 'i86601-recipe', honest: 'f-honest', extreme: 'f-extreme', coreclr: 'c-honest-coreclr',
  honest2: 'f2-honest', extreme2: 'f2-extreme', honestBundle: 'f2-honest-bundle' };
// The data file tags the bundle as "other". It holds the managed assemblies, so the report counts it as managed.
const GROUP_OVERRIDE = { '_framework/b.bin': 'managed' };
// Round 2 runs are told apart by their id prefix (r2-*, f2-*); all of them are also the last lines of the file.
const roundOf = (r) => (/^(r2|f2)-/.test(r.id) ? 2 : 1);
// Round 2 mechanisms: brotli of "to" minus brotli of "from" (both from the data).
const R2_MECH = [
  { label: 'Bundle of the 32 assemblies into one file (b.bin)', from: 'r2-base-br', to: 'r2-b-group' },
  { label: 'Native function stubs selected by name (pdb, simd, misc, jitleft, AOT lookups)', from: 'r2-x-names', to: 'f2-extreme' },
  { label: 'Mono.Cecil metadata pass (attributes, consts, property/event metadata)', from: 'r2-c1-slim-aggr', to: 'r2-m-props-notasks' },
  { label: 'Aggressive terser + smaller boot config', from: 'r2-n-tnh-gufa', to: 'r2-c1-slim-aggr' },
  { label: 'wasm-opt -tnh --gufa -Oz --converge', from: 'r2-b-group', to: 'r2-n-tnh-gufa' },
];
const GROUPS = ['native', 'js', 'managed', 'other'];
const GROUP_LABEL = { native: 'Native runtime', js: 'JS loader', managed: 'Managed assemblies', other: 'Other files' };
const VARIANT_LABEL = { template: 'Template', 'issue-86601-recipe': 'Issue #86601 recipe', honest: 'Honest', extreme: 'Extreme' };
// Workload A/B pairs: off = no native relink, on = relink.
const WORKLOAD_PAIRS = [
  { label: 'Template app', off: 'baseline-norelink', on: 'baseline' },
  { label: 'Honest default app', off: 's-norelink', on: 'h00-default' },
  { label: 'Honest, same managed levers', off: 'ab-honest-managed-norelink', on: 'ab-honest-managed-relink' },
  { label: 'Honest, all levers (final)', off: 'ab-honest-managed-norelink', on: 'f-honest' },
  { label: 'Extreme (final)', off: 'ab-extreme-managed-norelink', on: 'f-extreme' },
  { label: 'EmccLinkOptimizationFlag=-Oz', off: 's-linkOz-norelink', on: 's-linkOz' },
];
const LEVER_SETS = [
  { key: 'honest-alone', label: 'Honest: each lever alone', note: 'Each run adds one lever to h00-default (parallel wave w1).', test: (r) => r.variant === 'honest' && /^s-/.test(r.id) },
  { key: 'honest-steps', label: 'Honest: chain and combination', note: 'Serial chain h01–h27 (each row on top of the row above), then the combination steps c-honest-*.', test: (r) => r.variant === 'honest' && /^(h\d\d|c-honest)/.test(r.id) },
  { key: 'extreme-steps', label: 'Extreme: steps', note: 'e00 is the code rewrite vs c-honest-managed; each later step is on top of the one before.', test: (r) => r.variant === 'extreme' && /^e\d\d/.test(r.id) },
  { key: 'extreme-alone', label: 'Extreme: single changes', note: 'x-* runs: one change each, on top of e04-minify (x-subst2a / x-subst2c on top of e05-combo).', test: (r) => r.variant === 'extreme' && /^x-/.test(r.id) },
];
for (const s of LEVER_SETS) { const t = s.test; s.test = (r) => roundOf(r) === 1 && t(r); s.label = 'Round 1 · ' + s.label; }
// Sizes of single assemblies inside the round-2 bundle, each compressed alone (the bundle has no per-file sizes).
// Source: RESULTS.md, round 2, "Result" section.
const R2_ALONE = { coreLib: 408_929, stj: 120_906, partsSum: 818_901 };
const NOTHING_LIMIT = 1000; // |delta| below this, reverted = "did nothing"

// ---------- read + scrub ----------
const raw = fs.readFileSync(path.join(ROOT, 'results/experiments.jsonl'), 'utf8');
const lines = raw.split('\n').filter((l) => l.trim() !== '');
const scrubLog = {};
function scrubStr(s) {
  const rules = [
    [/\/Users\/[^/\s"']+/g, '~', 'absolute macOS home path'],
    [/\/home\/[^/\s"']+/g, '~', 'absolute Linux home path'],
  ];
  for (const [re, rep, what] of rules) {
    s = s.replace(re, () => { scrubLog[what] = (scrubLog[what] || 0) + 1; return rep; });
  }
  return s;
}
function scrub(v) {
  if (typeof v === 'string') return scrubStr(v);
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = scrub(v[k]); return o; }
  return v;
}
const runs = lines.map((l, i) => {
  try { return scrub(JSON.parse(l)); } catch (e) { throw new Error(`results/experiments.jsonl line ${i + 1}: ${e.message}`); }
});
const byId = new Map(runs.map((r) => [r.id, r]));
function get(id) { const r = byId.get(id); if (!r) throw new Error(`run "${id}" not found in experiments.jsonl`); return r; }

// ---------- helpers ----------
const fmt = (n) => (n == null ? '—' : String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/^/, n < 0 ? '−' : ''));
const sfmt = (n) => (n == null ? '—' : n > 0 ? '+' + fmt(n) : n < 0 ? fmt(n) : '0');
const kb = (n) => (n / 1000).toFixed(1) + ' kB';
const mb = (n) => (n / 1e6).toFixed(2) + ' MB';
const pct = (n, d) => ((100 * n) / d).toFixed(2) + '%';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shortName = (n) => n.replace(/^_framework\//, '');
const cleanChange = (c) => String(c || '').replace(/\s*\((cumulative serial chain|single lever vs|single change vs)[^)]*\)/g, '');
const fileGroup = (f) => GROUP_OVERRIDE[f.name] || f.group;
function groupSums(r) {
  const g = { native: 0, js: 0, managed: 0, other: 0 };
  const gr = { native: 0, js: 0, managed: 0, other: 0 };
  for (const f of r.files || []) { const k = fileGroup(f); g[k] = (g[k] || 0) + (f.brotli || 0); gr[k] = (gr[k] || 0) + (f.raw || 0); }
  return { brotli: g, raw: gr };
}
const fileBrotli = (r, re) => (r.files || []).filter((f) => re.test(shortName(f.name))).reduce((a, f) => a + f.brotli, 0);
const native = (r) => (r.files || []).find((f) => f.group === 'native') || null;
function checkPill(c) {
  if (c === 'pass') return '<span class="pill ok"><span aria-hidden="true">✓</span> pass</span>';
  if (c === 'fail') return '<span class="pill bad"><span aria-hidden="true">✕</span> fail</span>';
  return `<span class="pill mute"><span aria-hidden="true">–</span> ${esc(c ?? '—')}</span>`;
}
function decisionPill(d) {
  const cls = d === 'kept' ? 'kept' : d === 'reverted' ? 'rev' : 'exp';
  return `<span class="tag ${cls}">${esc(d ?? '—')}</span>`;
}

// ---------- key runs ----------
const B = get(IDS.baseline), R = get(IDS.recipe), H = get(IDS.honest), X = get(IDS.extreme), CC = get(IDS.coreclr);
const H2 = get(IDS.honest2), X2 = get(IDS.extreme2), HB = get(IDS.honestBundle);
const gX2 = groupSums(X2);
const roundLine = (r1, r2, kind) => `<p class="rline">Round 1 <span data-check="${kind}-r1">${fmt(r1.brotli_total)}</span> → round 2 <strong>${fmt(r2.brotli_total)}</strong> <span class="muted">(${sfmt(r2.brotli_total - r1.brotli_total)})</span></p>`;

// ---------- 1. verdict ----------
function card(kind, title, sub, r, extra) {
  const gap = r.brotli_total - TARGET;
  const saved = B.brotli_total - r.brotli_total;
  return `<div class="vcard ${kind}">
  <div class="vhead"><span class="vname">${title}</span><span class="vsub">${sub}</span></div>
  <div class="vnum"><span data-check="${kind}-brotli">${fmt(r.brotli_total)}</span> <span class="unit">bytes brotli</span></div>
  <div class="vmeta">${mb(r.brotli_total)} · raw <span data-check="${kind}-raw">${fmt(r.raw_total)}</span>${r.gzip_total != null ? ` · gzip <span data-check="${kind}-gzip">${fmt(r.gzip_total)}</span>` : ''}</div>
  <dl class="vgap">
    <div><dt>Over target</dt><dd><span data-check="${kind}-gap">${sfmt(gap)}</span> <span class="muted">(${pct(gap, B.brotli_total)} of baseline)</span></dd></div>
    ${kind === 'baseline' ? '<div><dt>Saved vs baseline</dt><dd>—</dd></div>' : `<div><dt>Saved vs baseline</dt><dd>${fmt(saved)} <span class="muted">(${pct(saved, B.brotli_total)})</span></dd></div>`}
  </dl>${extra || ''}
</div>`;
}
const verdict = `
<section class="verdict" aria-labelledby="verdict-h">
  <h2 id="verdict-h" class="sr-only">Verdict</h2>
  <p class="status"><span class="pill bad big"><span aria-hidden="true">✕</span> Target not reached</span></p>
  <p class="lead">The target is <strong>${fmt(TARGET)} bytes</strong> brotli. After two rounds, the smallest build, <strong>Extreme</strong>, is <strong>${fmt(X2.brotli_total)}</strong> bytes: <strong>${sfmt(X2.brotli_total - TARGET)}</strong> over the target. <strong>Honest</strong>, which uses only stock Blazor APIs, is <strong>${fmt(H2.brotli_total)}</strong> bytes: <strong>${sfmt(H2.brotli_total - TARGET)}</strong> over.</p>
  <div class="vrow">
    ${card('baseline', 'Baseline', '<code>dotnet new blazorwasm</code>', B)}
    <span class="arrow" aria-hidden="true">→</span>
    ${card('honest', 'Honest', 'stock APIs: host builder, <code>Router</code>, <code>HttpClient</code>; round-2 post-processing, no code change', H2, roundLine(H, H2, 'honest') + `<p class="rline">Honest + bundle (experiment, not default): <span data-check="honest-bundle">${fmt(HB.brotli_total)}</span></p>`)}
    <span class="arrow" aria-hidden="true">→</span>
    ${card('extreme', 'Extreme', 'own router, JS <code>fetch</code>, ILLink stubs, one assembly bundle, native stubs, <code>wasm-opt</code>, terser', X2, roundLine(X, X2, 'extreme'))}
    <span class="arrow" aria-hidden="true">→</span>
    <div class="vcard target">
      <div class="vhead"><span class="vname">Target</span><span class="vsub">set by the owner</span></div>
      <div class="vnum"><span data-check="target">${fmt(TARGET)}</span> <span class="unit">bytes brotli</span></div>
      <div class="vmeta">${mb(TARGET)} · ${pct(TARGET, B.brotli_total)} of baseline</div>
      <p class="vnote">From <a href="https://github.com/dotnet/runtime/issues/86601">dotnet/runtime #86601</a>, a user report: “minimum size … in .net 7 is 1.1 MB”. The same recipe on .NET 11 measures <strong data-check="recipe-brotli">${fmt(R.brotli_total)}</strong> bytes with this metric (${sfmt(R.brotli_total - TARGET)}).</p>
    </div>
  </div>
  <p class="fineprint">Bytes = sum of the files a browser downloads on a cold first load plus a visit to every page, compressed with brotli quality 11. From round 2 on, the app is served from the final <code>.br</code> files with <code>Content-Encoding: br</code>, and the bytes transferred equal the sum of the <code>.br</code> files (the round-1 Extreme final gives the same ${fmt(get('r2-base-br').brotli_total)} bytes both ways, run <code>r2-base-br</code>). .NET SDK 11.0.100, stock Mono runtime, Release publish. 1 MB = 1,000,000 bytes, 1 kB = 1,000 bytes.</p>
</section>`;

// ---------- 2. where the bytes are ----------
const stackRows = [
  { r: B, name: 'Baseline', sub: B.id },
  { r: R, name: 'Issue #86601 recipe', sub: R.id },
  { r: H, name: 'Honest, round 1', sub: H.id },
  { r: H2, name: 'Honest, round 2', sub: H2.id },
  { r: HB, name: 'Honest + bundle (experiment)', sub: HB.id },
  { r: X, name: 'Extreme, round 1', sub: X.id },
  { r: X2, name: 'Extreme, round 2', sub: X2.id },
];
const stackMax = Math.ceil(Math.max(...stackRows.map((s) => s.r.brotli_total)) / 500_000) * 500_000;
const ticks = []; for (let t = 0; t <= stackMax; t += 500_000) ticks.push(t);
const P = (v) => ((100 * v) / stackMax).toFixed(4) + '%';
function stackBar({ r, name, sub }) {
  const g = groupSums(r).brotli;
  const segs = GROUPS.filter((k) => g[k] > 0).map((k) =>
    `<span class="seg s-${k}" style="width:${((100 * g[k]) / r.brotli_total).toFixed(4)}%" tabindex="0" data-tip="${esc(fmt(g[k]) + ' bytes\n' + GROUP_LABEL[k] + ' · ' + name + '\n' + pct(g[k], r.brotli_total) + ' of this build')}"><span class="seglab">${kb(g[k])}</span></span>`).join('');
  return `<div class="srow">
  <div class="slabel"><span class="sname">${esc(name)}</span><code class="sid">${esc(sub)}</code></div>
  <div class="strack"><div class="sbar" style="width:${P(r.brotli_total)}">${segs}</div><span class="stotal" style="left:${P(r.brotli_total)}">${fmt(r.brotli_total)}</span></div>
</div>`;
}
const legend = `<div class="legend" aria-label="Legend">${GROUPS.map((k) => `<span class="lg"><span class="sw s-${k}"></span>${GROUP_LABEL[k]}</span>`).join('')}<span class="lg"><span class="sw tline"></span>Target ${fmt(TARGET)}</span></div>`;
const stackTable = `<div class="tablewrap"><table class="num">
<thead><tr><th>Build</th>${GROUPS.map((k) => `<th>${GROUP_LABEL[k]}</th>`).join('')}<th>Total brotli</th><th>Total raw</th><th>Files</th></tr></thead>
<tbody>${stackRows.map(({ r, name }) => { const g = groupSums(r).brotli; return `<tr><th scope="row">${esc(name)} <code>${esc(r.id)}</code></th>${GROUPS.map((k) => `<td data-check="grp-${r.id}-${k}">${fmt(g[k])}</td>`).join('')}<td><strong>${fmt(r.brotli_total)}</strong></td><td>${fmt(r.raw_total)}</td><td>${(r.files || []).length}</td></tr>`; }).join('')}</tbody></table></div>`;
const whereBytes = `
<section aria-labelledby="where-h">
  <h2 id="where-h">Where the bytes are</h2>
  <p class="intro">Brotli bytes per file group. The native runtime is <code>dotnet.native.wasm</code>. In the baseline, “other” is mostly ICU data (<code>icudt_EFIGS.dat</code>) and the Bootstrap CSS. In round 2, the managed group of Extreme (and of “Honest + bundle”) is one file, <code>b.bin</code>: the data file tags it “other”, this page counts it as managed. Compressed as one file, the assemblies are smaller than compressed one by one: all parts compressed alone sum to ${fmt(R2_ALONE.partsSum)} (from <code>RESULTS.md</code>), the bundle is ${fmt(gX2.brotli.managed)}.</p>
  ${legend}
  <div class="stack" role="img" aria-label="Stacked bars of brotli bytes per group; values are in the table below">
    <div class="sgrid">${ticks.map((t) => `<span class="tick${t % 1_000_000 ? ' half' : ''}" style="left:${P(t)}"><span>${t === 0 ? '0' : (t / 1e6).toFixed(1) + ' MB'}</span></span>`).join('')}<span class="tgt" style="left:${P(TARGET)}"><span>target</span></span></div>
    ${stackRows.map(stackBar).join('\n')}
  </div>
  <details class="tview"><summary>Table view (exact bytes)</summary>${stackTable}</details>
</section>`;

// ---------- 3. levers ----------
function baseCheck(r) { const b = r.base ? byId.get(r.base) : null; return b ? b.check : null; }
function runItem(r) {
  let d = r.delta_brotli, computed = false;
  if (d == null && r.base && byId.get(r.base) && byId.get(r.base).brotli_total != null && r.brotli_total != null) { d = r.brotli_total - byId.get(r.base).brotli_total; computed = true; }
  const tip = `${sfmt(d)} bytes brotli${computed ? ' (brotli minus base brotli; delta field is empty)' : ''}\n${cleanChange(r.change)}\nvs ${r.base}\n${r.reason || ''}${r.check !== 'pass' ? '\ncheck: ' + r.check + (baseCheck(r) === 'fail' ? ' (inherited from the chain)' : '') : ''}`;
  return { id: r.id, label: cleanChange(r.change), delta: d, tip, computed };
}
function leverChart(items) {
  items = items.filter((it) => it.delta != null).sort((a, b) => a.delta - b.delta || a.id.localeCompare(b.id));
  if (!items.length) return '<p class="muted">No kept runs in this set.</p>';
  const maxSave = Math.max(0, ...items.map((r) => -r.delta));
  const maxGrow = Math.max(0, ...items.map((r) => r.delta));
  const span = maxSave + maxGrow || 1;
  const zero = (100 * maxGrow) / span;
  return `<div class="lchart" style="--zero:${zero.toFixed(4)}%">
${items.map((it) => {
    const d = it.delta; const w = (100 * Math.abs(d)) / span;
    const style = d <= 0 ? `left:${zero.toFixed(4)}%;width:${w.toFixed(4)}%` : `left:${(zero - w).toFixed(4)}%;width:${w.toFixed(4)}%`;
    return `<div class="lrow" tabindex="0" data-tip="${esc(it.tip)}">
  <div class="llabel"><code>${esc(it.id)}</code><span>${esc(it.label)}</span></div>
  <div class="ltrack"><span class="lbar ${d > 0 ? 'grow' : 'save'}" style="${style}"></span></div>
  <div class="lval">${sfmt(d)}${it.computed ? '*' : ''}</div>
</div>`;
  }).join('\n')}
</div>`;
}
const mechItems = R2_MECH.map((m) => { const a = get(m.from), b = get(m.to); const d = b.brotli_total - a.brotli_total; return { id: `${m.from} → ${m.to}`, label: m.label, delta: d, tip: `${sfmt(d)} bytes brotli\n${m.label}\n${fmt(a.brotli_total)} (${m.from}) → ${fmt(b.brotli_total)} (${m.to})` }; });
const mechSum = mechItems.reduce((a, m) => a + m.delta, 0);
const ALL_SETS = [
  { key: 'r2-mech', label: 'Round 2 · Extreme mechanisms', note: `Each bar is the brotli total of one run minus another run, both from the data. Together ${sfmt(mechSum)}; with NativeNames=true (r2-x-names, ${sfmt(get('r2-x-names').delta_brotli)}) this is the full round-2 change of Extreme: ${fmt(X.brotli_total)} → ${fmt(X2.brotli_total)} (${sfmt(X2.brotli_total - X.brotli_total)}).`, items: mechItems, r2: true },
  { key: 'r2-kept', label: 'Round 2 · all kept runs', note: 'Every kept round-2 run against its base run (finals f2-* left out). * = the delta field is empty in the data, so the bar shows brotli minus base brotli.', items: runs.filter((r) => roundOf(r) === 2 && r.decision === 'kept' && !/^f2-/.test(r.id)).map(runItem), r2: true },
  ...LEVER_SETS.map((st) => ({ ...st, items: runs.filter((r) => r.decision === 'kept' && r.delta_brotli != null && st.test(r)).map(runItem) })),
];
const r2Reverted = runs.filter((r) => roundOf(r) === 2 && (r.decision === 'reverted' || r.check === 'fail'));
const nothing = runs.filter((r) => roundOf(r) === 1 && r.decision === 'reverted' && r.delta_brotli != null && Math.abs(r.delta_brotli) < NOTHING_LIMIT);
const broke = runs.filter((r) => roundOf(r) === 1).filter((r) => r.build === 'failed' || (r.check === 'fail' && baseCheck(r) !== 'fail'));
const inheritedFails = runs.filter((r) => roundOf(r) === 1 && r.check === 'fail' && baseCheck(r) === 'fail');
const errText = (r) => r.build === 'failed' ? r.build_error : r.check_error;
const levers = `
<section aria-labelledby="lever-h">
  <h2 id="lever-h">What each lever saved</h2>
  <p class="intro">Measured brotli delta of each <strong>kept</strong> run against its <code>base</code> run. Longer bar = more bytes saved. A bar left of zero made the download bigger. Round 2 worked on Extreme only (Honest got the same post-processing, no code change).</p>
  <div class="tabs" role="tablist" aria-label="Lever set">${ALL_SETS.map((s, i) => `<button role="tab" id="tab-${s.key}" aria-controls="panel-${s.key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(s.label)}</button>`).join('')}</div>
  ${ALL_SETS.map((s, i) => `<div role="tabpanel" id="panel-${s.key}" aria-labelledby="tab-${s.key}"${i ? ' hidden' : ''}><p class="setnote">${esc(s.note)}</p><div class="legend"><span class="lg"><span class="sw save"></span>saved bytes</span><span class="lg"><span class="sw grow"></span>made it bigger</span></div>${leverChart(s.items)}</div>`).join('\n')}
  <div class="lists">
    <div>
      <h3>Round 2 · reverted or failed</h3>
      <div class="tablewrap"><table class="small"><thead><tr><th>Run</th><th>Change</th><th class="r">Δ brotli</th><th>Check</th><th>Reason</th></tr></thead><tbody>
      ${r2Reverted.map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(cleanChange(r.change))}</td><td class="r num">${sfmt(r.delta_brotli)}</td><td>${checkPill(r.check)} ${decisionPill(r.decision)}</td><td>${esc(r.reason)}${r.check_error ? `<details><summary>Exact error</summary><pre>${esc(r.check_error)}</pre></details>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small"><code>r2-x-canary</code> was meant to fail: it stubs a function that is called, to prove that a trap makes the check fail loudly.</p>
    </div>
    <div>
      <h3>Round 1 · did nothing (|Δ| under ${fmt(NOTHING_LIMIT)} bytes, reverted)</h3>
      <div class="tablewrap"><table class="small"><thead><tr><th>Run</th><th>Change</th><th class="r">Δ brotli</th><th>Reason</th></tr></thead><tbody>
      ${nothing.map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(cleanChange(r.change))}${baseCheck(r) === 'fail' ? ' <span class="muted">(check fails only because h11 is in the chain)</span>' : ''}</td><td class="r num">${sfmt(r.delta_brotli)}</td><td>${esc(r.reason)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div>
      <h3>Round 1 · broke the build or the app</h3>
      <ul class="broke">
      ${broke.map((r) => `<li><div class="bhead"><code>${esc(r.id)}</code> ${r.build === 'failed' ? '<span class="pill bad">build failed</span>' : '<span class="pill bad">app check failed</span>'} ${decisionPill(r.decision)}</div><div>${esc(cleanChange(r.change))}</div><div class="reason">${esc(r.reason)}</div>${errText(r) ? `<details><summary>Exact error</summary><pre>${esc(errText(r))}</pre></details>` : ''}</li>`).join('\n')}
      </ul>
      <p class="muted small">${inheritedFails.length} more runs in the serial chain (h12–h27) failed the check only because the reverted h11 stayed in the chain. The same levers pass on their own (s-* runs) and in the c-honest-* combination.</p>
    </div>
  </div>
</section>`;

// ---------- 4. workload ----------
const packSha = get('baseline-norelink').native_wasm_sha256;
function wlRow(id, side) {
  const r = get(id); const n = native(r);
  const same = r.native_wasm_sha256 && r.native_wasm_sha256 === packSha;
  return `<tr class="${side}"><td>${side === 'off' ? 'no relink' : 'relink'}</td><td><code>${esc(r.id)}</code></td><td><code>${esc((r.native_wasm_sha256 || '—').slice(0, 16))}</code>${same ? ' <span class="muted">= runtime pack</span>' : ''}</td><td class="r">${fmt(n && n.raw)}</td><td class="r">${fmt(n && n.brotli)}</td><td class="r">${fmt(r.raw_total)}</td><td class="r"><strong>${fmt(r.brotli_total)}</strong></td></tr>`;
}
const workloadFails = runs.filter((r) => r.group === 'workload-ab' && r.build === 'failed');
const workload = `
<section aria-labelledby="wl-h">
  <h2 id="wl-h">Workload effect</h2>
  <p class="intro">The <code>wasm-tools</code> workload lets the build relink <code>dotnet.native.wasm</code>. All runs in this section are from round 1. Without it (<code>WasmBuildNative=false</code>) the native file is byte-identical to the runtime pack, and the best <strong>Honest</strong> is <strong data-check="norelink-honest">${fmt(get('ab-honest-managed-norelink').brotli_total)}</strong> bytes and the best <strong>Extreme</strong> is <strong data-check="norelink-extreme">${fmt(get('ab-extreme-managed-norelink').brotli_total)}</strong> bytes. The workload is essential.</p>
  <div class="tablewrap"><table class="num wl">
  <thead><tr><th>Side</th><th>Run</th><th>native sha256 (16)</th><th class="r">native raw</th><th class="r">native brotli</th><th class="r">cold raw</th><th class="r">cold brotli</th></tr></thead>
  ${WORKLOAD_PAIRS.map((p) => { const off = get(p.off), on = get(p.on); return `<tbody><tr class="pairhead"><th colspan="7">${esc(p.label)} <span class="delta">relink saves ${fmt(off.brotli_total - on.brotli_total)} bytes brotli</span></th></tr>${wlRow(p.off, 'off')}${wlRow(p.on, 'on')}</tbody>`; }).join('\n')}
  </table></div>
  <p class="intro">The big native savings come from <code>InvariantGlobalization</code> and <code>InvariantTimezone</code>: the relink then leaves ICU out of the native file. In .NET 11 these switches and <code>WasmEnableSIMD=false</code> stop the build without relink. <code>EmccLinkOptimizationFlag=-Oz</code> is silently ignored without relink (native file identical to the pack). Builds that stopped:</p>
  <ul class="plain">${workloadFails.map((r) => `<li><code>${esc(r.id)}</code>: ${esc(r.reason)}</li>`).join('')}</ul>
</section>`;

// ---------- 5. trade-offs (text from RESULTS.md) ----------
const r2js = (re) => fileBrotli(X2, re);
const floor2 = gX2.brotli.native + gX2.brotli.js + R2_ALONE.coreLib + R2_ALONE.stj;
const tradeoffs = `
<section aria-labelledby="give-h">
  <h2 id="give-h">What Extreme gives up</h2>
  <div class="two prose">
    <div>
      <p>Still real Blazor: Razor components rendered by the stock <code>WebAssemblyRenderer</code>, started by the stock <code>WebAssemblyHostBuilder</code>, on the stock Mono runtime pack (relinked with the stock emscripten from the workload). binaryen and terser only rewrite the output; they do not change behaviour.</p>
      <h3>Replaced or patched</h3>
      <ol>
        <li><code>Router</code> / <code>RouteView</code> / <code>@page</code> → a hand-written router in <code>App.razor</code> (<code>switch</code> on <code>NavigationManager.ToBaseRelativePath</code>, <code>LocationChanged</code>, <code>INavigationInterception.EnableNavigationInterceptionAsync</code>). Works under any <code>&lt;base href&gt;</code>.</li>
        <li><code>NavLink</code> → plain <code>&lt;a&gt;</code>.</li>
        <li><code>HttpClient</code> / System.Net.Http / STJ in app code → <code>fetch()</code> through <code>IJSRuntime.InvokeAsync&lt;string&gt;</code>, with a one-line JS helper that parses JSON in JS and returns plain text lines.</li>
        <li>ILLink substitutions (method bodies replaced by stubs): <code>AddEnvironmentVariables</code>, <code>WebAssemblyCultureProvider.ThrowIfCultureChangeIsUnsupported</code> / <code>LoadCurrentCultureResourcesAsync</code>, <code>Console.get_Error</code>, <code>JsonStreamConfigurationSource.Build</code>, <code>DomainNameHelper.TryGetUnicodeEquivalent</code>.</li>
        <li>Post-processing: <code>wasm-opt -Oz --converge</code> on <code>dotnet.native.wasm</code>, terser on the JS files, new sha256 integrity values written into the boot config inside <code>dotnet.js</code>, <code>.br</code>/<code>.gz</code>/<code>.map</code> removed.</li>
      </ol>
    </div>
    <div>
      <h3>Blazor features lost in Extreme (on top of Honest)</h3>
      <ul>
        <li>No <code>@page</code> routing: no route templates, parameters or constraints, no <code>NotFound</code> page component, no <code>FocusOnNavigate</code>, no <code>NavLink</code> active class, no lazy-loaded assemblies by route.</li>
        <li>No <code>HttpClient</code> service and no <code>System.Net.Http</code>. HTTP only through JS interop.</li>
        <li>Environment variables are not in <code>IConfiguration</code>. <code>appsettings.json</code> and <code>appsettings.{env}.json</code> are ignored.</li>
        <li>No culture switching or satellite assemblies (already gone with invariant globalization).</li>
        <li><code>Console.Error</code> is null: if a root-component update fails, the error write throws instead of printing.</li>
        <li>Unicode (IDN) host names in <code>Uri</code> are not converted.</li>
        <li>Post-processed files must be rebuilt with <code>build.sh</code> (integrity values are rewritten). A hand edit breaks loading.</li>
      </ul>
      <h3>Lost in round 2 (Extreme)</h3>
      <ul>
        <li>Loading an assembly with an embedded or separate PDB, or anything that needs zlib inside the runtime, traps (native stubs).</li>
        <li>AOT-compiled assemblies cannot be used: the AOT lookup functions trap.</li>
        <li>Interpreter SIMD paths trap if SIMD were ever turned on again.</li>
        <li>The runtime thread dump and the regression-test entry point trap.</li>
        <li>Reflection over compiler-only attributes (for example <code>[CompilerGenerated]</code>, <code>[Nullable]</code>, <code>[TypeForwardedFrom]</code>, <code>[InternalsVisibleTo]</code>, <code>[AssemblyMetadata]</code>) returns nothing. Reflection over properties and events of framework types (outside the kept CoreLib namespaces <code>System</code>, <code>System.Threading*</code>, <code>System.Runtime*</code>) finds none. Framework <code>const</code> fields are not visible to reflection.</li>
        <li>The bundle has one integrity value, so it fails as a whole if one byte changes. There is no per-assembly caching. The browser downloads all assemblies before start (as before).</li>
      </ul>
      <h3>Lost in both variants (settings)</h3>
      <p>Culture-specific formatting (invariant culture), time zones (UTC only), EventSource / metrics / diagnostics, stack traces in exceptions, dynamic code paths (<code>DynamicCodeSupport=false</code>: DI and expression trees use slower reflection paths), SIMD (slower runtime), wasm exception handling (emscripten's JS-based fallback), debugger, readable framework names in logs (Bit.Minifier aggressive).</p>
    </div>
  </div>
</section>
<section aria-labelledby="block-h">
  <h2 id="block-h">What blocks going lower</h2>
  <p class="intro">Extreme round-2 final, brotli: native <strong>${fmt(gX2.brotli.native)}</strong> · JS <strong>${fmt(gX2.brotli.js)}</strong> · managed <strong>${fmt(gX2.brotli.managed)}</strong> · HTML and data ${fmt(gX2.brotli.other)}. Each further saving needs an option the owner ruled out: no fork or custom build of the runtime, and the stock Blazor host and renderer stay.</p>
  <div class="three prose">
    <div><h3>Native · ${fmt(gX2.brotli.native)}</h3><p>What is left is the Mono interpreter, GC, metadata loader, marshalling, emmalloc and libc. Going lower needs a <strong>custom runtime build</strong> (rejected).</p></div>
    <div><h3>JS · ${fmt(gX2.brotli.js)}</h3><p><code>dotnet.runtime.js</code> ${fmt(r2js(/^dotnet\.runtime\./))} (includes the jiterpreter), <code>blazor.webassembly.js</code> ${fmt(r2js(/^blazor\.webassembly\.js$/))}, <code>dotnet.native.js</code> ${fmt(r2js(/^dotnet\.native\.[a-z0-9]+\.js$/))}, <code>dotnet.js</code> ${fmt(r2js(/^dotnet\.js$/))}. Going lower needs <strong>changing the runtime or Blazor JS logic</strong> (rejected). Removing the jiterpreter exports made the check fail.</p></div>
    <div><h3>Managed · ${fmt(gX2.brotli.managed)}</h3><p>Compressed alone, CoreLib is ${fmt(R2_ALONE.coreLib)} and System.Text.Json ${fmt(R2_ALONE.stj)}. STJ goes only if JS interop stops using reflection-based JSON, which needs a <strong>custom host or renderer</strong> (rejected). DI, logging, options and configuration (about 45k) also need a custom host. A host bypass with <code>UnsafeAccessorType</code> was not measured.</p></div>
  </div>
  <p class="callout">Native + JS + CoreLib + System.Text.Json alone (each compressed separately) are <strong data-check="floor">${fmt(floor2)}</strong> bytes. Reaching ${fmt(TARGET)} would need ${fmt(X2.brotli_total - TARGET)} more bytes saved, from parts that only a rejected option can touch.</p>
  <h3>If a runtime fork were allowed</h3>
  <p class="estimate"><strong>Estimates from research, not measurements.</strong> Native part: about 22–27K brotli less with different build flags on stock source, about 42–57K with small patches, about 60–95K with deep changes. With JS and CoreLib included: about 95–160K (small patches) to about 140–250K (deep changes). The cost: an own runtime pack that must be rebuilt on every monthly servicing release, late security fixes, and no vendor support.</p>
  <p class="intro">CoreCLR on wasm (<code>UseMonoRuntime=false</code>, round 1, run <code>${esc(CC.id)}</code>) publishes and passes the check, but it is <strong data-check="coreclr-delta">${sfmt(CC.delta_brotli)}</strong> bytes brotli vs Mono. Reverted.</p>
</section>`;

// ---------- 6. per-file ----------
function fileTable(r, label) {
  const files = [...r.files].sort((a, b) => b.brotli - a.brotli || a.name.localeCompare(b.name));
  const g = groupSums(r);
  return `<div class="tablewrap"><table class="num sortable" aria-label="${esc(label)} files">
<thead><tr><th><button data-sort="text">File</button></th><th><button data-sort="text">Group</button></th><th class="r"><button data-sort="num">Raw</button></th><th class="r"><button data-sort="num" aria-sort="descending">Brotli</button></th><th class="r"><button data-sort="num">Share of brotli</button></th></tr></thead>
<tbody>${files.map((f) => `<tr><td data-v="${esc(shortName(f.name))}"><code>${esc(shortName(f.name))}</code></td><td data-v="${fileGroup(f)}"><span class="sw s-${fileGroup(f)}"></span>${fileGroup(f)}${fileGroup(f) !== f.group ? ` <span class="muted">(bundle; “${f.group}” in data)</span>` : ''}</td><td class="r" data-v="${f.raw}">${fmt(f.raw)}</td><td class="r" data-v="${f.brotli}">${fmt(f.brotli)}</td><td class="r" data-v="${f.brotli}">${pct(f.brotli, r.brotli_total)}</td></tr>`).join('')}</tbody>
<tfoot>${GROUPS.map((k) => `<tr><th>${GROUP_LABEL[k]}</th><td>${k}</td><td class="r">${fmt(g.raw[k])}</td><td class="r">${fmt(g.brotli[k])}</td><td class="r">${pct(g.brotli[k], r.brotli_total)}</td></tr>`).join('')}<tr class="total"><th>Total (${files.length} files)</th><td></td><td class="r">${fmt(r.raw_total)}</td><td class="r">${fmt(r.brotli_total)}</td><td class="r"></td></tr></tfoot>
</table></div>`;
}
const perFile = `
<section aria-labelledby="files-h">
  <h2 id="files-h">Files in the final builds</h2>
  <p class="intro">Every file of the cold load. In round 2 Extreme loads ${X2.files.length} files. Click a column header to sort. Hash parts in names are the build fingerprints.</p>
  <div class="tabs" role="tablist" aria-label="Final build">
    <button role="tab" id="tab-fx2" aria-controls="panel-fx2" aria-selected="true" tabindex="0">Extreme, round 2 (${X2.files.length} files)</button>
    <button role="tab" id="tab-fh2" aria-controls="panel-fh2" aria-selected="false" tabindex="-1">Honest, round 2 (${H2.files.length} files)</button>
    <button role="tab" id="tab-fx" aria-controls="panel-fx" aria-selected="false" tabindex="-1">Extreme, round 1 (${X.files.length})</button>
    <button role="tab" id="tab-fh" aria-controls="panel-fh" aria-selected="false" tabindex="-1">Honest, round 1 (${H.files.length})</button>
  </div>
  <div role="tabpanel" id="panel-fx2" aria-labelledby="tab-fx2">${fileTable(X2, 'Extreme round 2')}</div>
  <div role="tabpanel" id="panel-fh2" aria-labelledby="tab-fh2" hidden>${fileTable(H2, 'Honest round 2')}</div>
  <div role="tabpanel" id="panel-fx" aria-labelledby="tab-fx" hidden>${fileTable(X, 'Extreme round 1')}</div>
  <div role="tabpanel" id="panel-fh" aria-labelledby="tab-fh" hidden>${fileTable(H, 'Honest round 1')}</div>
</section>`;

// ---------- 7. all experiments ----------
const uniq = (k) => [...new Set(runs.map((r) => r[k]).filter((v) => v != null))].sort();
const opt = (k, labels) => `<option value="">All</option>` + uniq(k).map((v) => `<option value="${esc(v)}">${esc((labels && labels[v]) || v)} (${runs.filter((r) => r[k] === v).length})</option>`).join('');
const searchText = (r) => [r.id, r.change, r.reason, r.props, r.base, r.group, r.post].filter(Boolean).join(' ').toLowerCase();
const allRuns = `
<section aria-labelledby="all-h">
  <h2 id="all-h">All experiments</h2>
  <p class="intro">All ${runs.length} runs from <code>results/experiments.jsonl</code>, in file order. Round 2 runs are the ones whose id starts with <code>r2-</code> or <code>f2-</code> (the data has no round field; these are also the last ${runs.filter((r) => roundOf(r) === 2).length} lines). Failed and reverted runs are shown too. Click a row for its settings, errors and file list. “—” means the value was not measured or not captured.</p>
  <div class="filters" role="search">
    <label>Round <select id="f-round"><option value="">All</option>${[1, 2].map((n) => `<option value="${n}">Round ${n} (${runs.filter((r) => roundOf(r) === n).length})</option>`).join('')}</select></label>
    <label>Variant <select id="f-variant">${opt('variant', VARIANT_LABEL)}</select></label>
    <label>Group <select id="f-group">${opt('group')}</select></label>
    <label>Decision <select id="f-decision">${opt('decision')}</select></label>
    <label>Check <select id="f-check">${opt('check')}</select></label>
    <label class="grow">Search <input id="f-q" type="search" placeholder="id, property, reason…" autocomplete="off"></label>
    <span class="count" id="f-count" aria-live="polite">${runs.length} of ${runs.length} runs</span>
  </div>
  <div class="tablewrap"><table class="num runs sortable" id="runs">
  <thead><tr><th><button data-sort="text">Run</button></th><th><button data-sort="num">Round</button></th><th><button data-sort="text">Variant</button></th><th><button data-sort="text">Group</button></th><th class="chg">Change</th><th class="r"><button data-sort="num">Brotli</button></th><th class="r"><button data-sort="num">Δ vs base</button></th><th class="r"><button data-sort="num">vs target</button></th><th><button data-sort="text">Check</button></th><th><button data-sort="text">Decision</button></th></tr></thead>
  <tbody>
${runs.map((r, i) => `<tr class="run" tabindex="0" aria-expanded="false" data-i="${i}" data-round="${roundOf(r)}" data-variant="${esc(r.variant)}" data-group="${esc(r.group)}" data-decision="${esc(r.decision)}" data-check="${esc(r.check)}" data-q="${esc(searchText(r))}"><td data-v="${esc(r.id)}"><code>${esc(r.id)}</code></td><td data-v="${roundOf(r)}">${roundOf(r)}</td><td data-v="${esc(r.variant)}">${esc(VARIANT_LABEL[r.variant] || r.variant)}</td><td data-v="${esc(r.group)}">${esc(r.group)}</td><td class="chg">${esc(cleanChange(r.change))}</td><td class="r" data-v="${r.brotli_total ?? ''}">${fmt(r.brotli_total)}</td><td class="r" data-v="${r.delta_brotli ?? ''}">${sfmt(r.delta_brotli)}</td><td class="r" data-v="${r.distance_to_target ?? ''}">${sfmt(r.distance_to_target)}</td><td data-v="${esc(r.check)}">${checkPill(r.check)}</td><td data-v="${esc(r.decision)}">${decisionPill(r.decision)}</td></tr>`).join('\n')}
  </tbody></table></div>
</section>`;

// ---------- 8. method ----------
const pathmapNote = get('w-h00-default-repeat');
const repeat = get('e04-repeat');
const method = `
<section aria-labelledby="method-h">
  <h2 id="method-h">Method</h2>
  <div class="two prose">
    <div>
      <h3>Metric</h3>
      <p>The sum of bytes of exactly the files a browser downloads on a cold first load and a visit to every page. Each file is compressed with brotli quality 11, window 24 (node zlib; gives the same bytes as <code>brotli -q 11</code>, checked against the CLI). gzip is level 9. Raw is the uncompressed size.</p>
      <h3>File list</h3>
      <p>A headless Chromium (Playwright 1.65.1) loads <code>/</code> with an empty cache, then visits Counter and Fetch inside the app. The file list comes from the browser network log, not from a directory listing. <code>dir_raw_total</code> in the data is the size of the whole publish folder, for comparison only.</p>
      <h3>Served bytes (round 2)</h3>
      <p>From round 2 on, a gate serves the app from the final <code>.br</code> files with <code>Content-Encoding: br</code> and reads the transferred bytes from the browser network log. In every run the served total equals the sum of the <code>.br</code> files. The gzip column comes from the same app served from <code>.gz</code> files.</p>
      <h3>Functional check</h3>
      <p>Every measured build must pass, or it is not kept:</p>
      <ul>
        <li>Home renders.</li>
        <li>The nav link to Counter works without a full page reload.</li>
        <li>Two clicks show <code>Current count: 2</code>.</li>
        <li>Fetch shows text from <code>data.json</code>, and <code>data.json</code> is in the network log.</li>
        <li>Back and forward work.</li>
        <li>A direct load of <code>/counter</code> in a fresh context works and counts (deep link).</li>
        <li>Zero console errors, page errors and failed requests.</li>
      </ul>
      <p>The issue #86601 recipe got a load-only check, because that template has one page.</p>
      <h3>Stress page and canary (native stubs)</h3>
      <p>A stubbed native function traps when it is called. To prove such a trap is caught, the canary run <code>r2-x-canary</code> stubs <code>mono_wasm_load_runtime</code>, a function that does run: the check fails loudly (“Failed to start platform”). Every kept stub group also had to pass a stress page that is built only into a test copy of the app and never shipped: an exception thrown and caught, nested try/finally with an <code>int.Parse</code> failure, GC under allocation load, number/decimal/Half formatting, parsing, <code>DateTime.Now</code>, <code>DateTime.Parse</code>, <code>Guid</code>, LINQ, <code>Dictionary</code>, string operations, delegates, <code>Task.Delay</code> and a failed HTTP request (404). It needs 15 of 15 and no console error except the expected 404. The full AOT stub group failed (trap at startup) and was reverted.</p>
    </div>
    <div>
      <h3>Environment</h3>
      <ul>
        <li>Microsoft .NET SDK 11.0.100 (installed with <code>dotnet-install.sh</code>), <code>wasm-tools</code> workload, stock Mono runtime pack, Release publish.</li>
        <li>Linux build host: Ubuntu 22.04 on WSL2, 12 cores, 39 GB RAM. All numbers come from it, except <code>baseline-mac</code> (macOS, no workload: <code>dotnet workload install wasm-tools</code> failed with “Inadequate permissions”).</li>
        <li>binaryen version_125 (<code>wasm-opt</code>), terser 5.51.2, Bit.Minifier 11.0.0-pre-20, node v24.21.0.</li>
        <li>The Mono relink needs <code>libatomic.so.1</code> for emscripten's bundled node. Without it every relink failed with exit code 127.</li>
      </ul>
      <h3>Parallel runs</h3>
      <p>Up to 6 publishes ran at the same time (7 in the last wave), each in its own source copy and port. <code>${esc(repeat.id)}</code> repeats <code>${esc(repeat.base)}</code> in another wave and gave byte-identical totals (Δ ${sfmt(repeat.delta_brotli)}). Before <code>PathMap</code> was added, <code>${esc(pathmapNote.id)}</code> from a different checkout path gave the same raw total and the same native hash, but brotli differed by ${fmt(Math.abs(pathmapNote.delta_brotli))} bytes (the path was in the app assembly). <code>PathMap</code> in <code>Directory.Build.props</code> removes that.</p>
      <h3>Property names</h3>
      <p>Checked against the .NET 11.0.100 SDK and packs. Not read by .NET 11 (no effect): <code>WasmNativeCompileOptimizationFlag</code>, <code>WasmNativeLinkOptimizationFlag</code>, <code>BlazorWebAssemblyPreserveCollationData</code>, <code>BlazorWebAssemblyJiterpreter</code>, <code>BlazorIcuDataFileName</code>, <code>WasmFingerprintAssets</code>, <code>WasmFingerprintBootConfig</code>.</p>
      <h3>Data</h3>
      <p>${runs.length} runs, one per line in <code>results/experiments.jsonl</code>. Δ is against the run in the <code>base</code> field. Some older runs were filled in later from logs; their missing fields show as “—”. Rebuild this page with <code>node tools/build-report.mjs &lt;out.html&gt;</code>.</p>
    </div>
  </div>
</section>`;

// ---------- page ----------
const CSS = String.raw`
/* Layout: one reading column, max 72rem; verdict cards first, then charts, tables, method. */
:root{
  --page:#f3f3ef; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#6c6a64;
  --grid:#e1e0d9; --axis:#c3c2b7; --line:rgba(11,11,11,.10); --hover:rgba(11,11,11,.04);
  --s-native:#2a78d6; --s-js:#eb6834; --s-managed:#1baf7a; --s-other:#eda100;
  --save:#2a78d6; --grow:#eb6834; --target:#0b0b0b;
  --ok:#006300; --ok-bg:rgba(12,163,12,.12); --bad:#b42f2f; --bad-bg:rgba(208,59,59,.12);
  --accent:#2a5bc4; --code-bg:rgba(11,11,11,.05);
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --page:#0d0d0d; --surface:#1a1a19; --ink:#f0efec; --ink2:#c3c2b7; --muted:#9b998f;
  --grid:#2c2c2a; --axis:#4a4a46; --line:rgba(255,255,255,.10); --hover:rgba(255,255,255,.05);
  --s-native:#3987e5; --s-js:#d95926; --s-managed:#199e70; --s-other:#c98500;
  --save:#3987e5; --grow:#d95926; --target:#f0efec;
  --ok:#3fbf3f; --ok-bg:rgba(12,163,12,.18); --bad:#ef7b7b; --bad-bg:rgba(230,103,103,.18);
  --accent:#8fb0ff; --code-bg:rgba(255,255,255,.07); color-scheme:dark}}
:root[data-theme="dark"]{
  --page:#0d0d0d; --surface:#1a1a19; --ink:#f0efec; --ink2:#c3c2b7; --muted:#9b998f;
  --grid:#2c2c2a; --axis:#4a4a46; --line:rgba(255,255,255,.10); --hover:rgba(255,255,255,.05);
  --s-native:#3987e5; --s-js:#d95926; --s-managed:#199e70; --s-other:#c98500;
  --save:#3987e5; --grow:#d95926; --target:#f0efec;
  --ok:#3fbf3f; --ok-bg:rgba(12,163,12,.18); --bad:#ef7b7b; --bad-bg:rgba(230,103,103,.18);
  --accent:#8fb0ff; --code-bg:rgba(255,255,255,.07); color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--page);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.5}
.wrap{max-width:72rem;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:28px}
header .eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0}
h1{font-size:clamp(26px,4vw,34px);line-height:1.15;margin:4px 0 0;text-wrap:balance;letter-spacing:-.01em}
h2{font-size:21px;margin:0 0 6px;text-wrap:balance}
h3{font-size:15px;margin:14px 0 6px}
section{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding-block:20px;padding-inline:clamp(14px,3vw,24px);min-width:0}
p{margin:0 0 10px} .intro{color:var(--ink2);max-width:68ch}
a{color:var(--accent)}
code{font-family:var(--mono);font-size:.88em;background:var(--code-bg);padding:.05em .3em;border-radius:4px;overflow-wrap:anywhere}
pre{font-family:var(--mono);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--code-bg);padding:8px 10px;border-radius:6px;margin:6px 0 0;max-height:16rem;overflow:auto}
.muted{color:var(--muted)} .small{font-size:13px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.num,.r,.lval,.stotal,.vnum{font-variant-numeric:tabular-nums}
.r{text-align:right}
/* pills */
.pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap}
.pill.ok{color:var(--ok);background:var(--ok-bg)} .pill.bad{color:var(--bad);background:var(--bad-bg)} .pill.mute{color:var(--muted);background:var(--code-bg)}
.pill.big{font-size:14px;padding:4px 12px}
.tag{font-size:12px;padding:1px 7px;border-radius:4px;border:1px solid var(--line);white-space:nowrap}
.tag.kept{font-weight:600;color:var(--ink)} .tag.rev{color:var(--ink2);text-decoration:line-through;text-decoration-color:var(--muted)} .tag.exp{color:var(--muted);border-style:dashed}
/* verdict */
.verdict{border-width:1px;border-color:var(--bad-bg);box-shadow:inset 0 0 0 1px var(--bad-bg)}
.status{margin:0 0 8px}
.lead{font-size:17px;max-width:70ch}
.vrow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr;gap:10px;align-items:stretch;margin:14px 0 10px}
.arrow{align-self:center;color:var(--muted);font-size:18px}
.vcard{border:1px solid var(--line);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:6px;min-width:0;background:var(--page)}
.vcard.target{border-style:dashed}
.vhead{display:flex;flex-direction:column}
.vname{font-weight:700;font-size:15px} .vsub{font-size:12px;color:var(--muted)}
.vnum{font-size:22px;font-weight:650;line-height:1.2} .unit{font-size:12px;font-weight:400;color:var(--muted)}
.vmeta{font-size:12.5px;color:var(--ink2)}
.vgap{margin:4px 0 0;display:flex;flex-direction:column;gap:4px;font-size:13px}
.vgap div{display:flex;flex-direction:column} .vgap dt{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)} .vgap dd{margin:0;font-weight:600}
.rline{font-size:12.5px;color:var(--ink2);margin:0}
.estimate{border:1px dashed var(--axis);border-radius:6px;padding:8px 12px;max-width:80ch;color:var(--ink2)}
.vnote{font-size:12.5px;color:var(--ink2);margin:0}
.fineprint{font-size:12.5px;color:var(--muted);margin:0;max-width:80ch}
@media (max-width:900px){.vrow{grid-template-columns:1fr 1fr}.arrow{display:none}}
@media (max-width:440px){.vrow{grid-template-columns:1fr}}
/* legend */
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--ink2);margin:6px 0 10px}
.lg{display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:4px}
.s-native{background:var(--s-native)} .s-js{background:var(--s-js)} .s-managed{background:var(--s-managed)} .s-other{background:var(--s-other)}
.sw.save{background:var(--save)} .sw.grow{background:var(--grow)} .sw.tline{width:2px;height:14px;border-radius:0;background:var(--target)}
/* stacked chart */
.stack{position:relative;padding:22px 0 4px;display:flex;flex-direction:column;gap:14px}
.sgrid{position:absolute;top:0;bottom:0;left:var(--lab);right:var(--rpad);pointer-events:none}
.stack{--lab:12rem;--rpad:5.5rem}
.tick{position:absolute;top:0;bottom:0;border-left:1px solid var(--grid)}
.tick span{position:absolute;top:0;transform:translateX(-50%);font-size:11px;color:var(--muted);white-space:nowrap}
.tick:first-child span{transform:none}
.tgt{position:absolute;top:14px;bottom:0;border-left:2px solid var(--target);z-index:2}
.tgt span{position:absolute;top:-14px;left:4px;font-size:11px;font-weight:600;color:var(--ink);white-space:nowrap}
.srow{display:grid;grid-template-columns:var(--lab) 1fr;align-items:center;position:relative}
.slabel{display:flex;flex-direction:column;padding-right:10px;min-width:0}
.sname{font-weight:600;font-size:14px} .sid{font-size:11px;background:none;padding:0;color:var(--muted)}
.strack{position:relative;height:28px;margin-right:var(--rpad)}
.sbar{display:flex;height:100%;gap:2px}
.seg{height:100%;min-width:2px;display:flex;align-items:center;overflow:visible;cursor:default;position:relative}
.seg:first-child{border-radius:0}.seg:last-child{border-radius:0 4px 4px 0}
.seg:hover,.seg:focus-visible{filter:brightness(1.12)}
.seglab{font-size:11.5px;font-weight:600;color:#fff;padding-left:6px;white-space:nowrap}
.s-other .seglab{color:#0b0b0b}
.seglab.hide{visibility:hidden}
.stotal{position:absolute;top:50%;transform:translateY(-50%);padding-left:8px;font-size:12.5px;font-weight:600;white-space:nowrap}
@media (max-width:640px){.tick.half span{display:none}.stack{--lab:0px;--rpad:4.6rem}.srow{grid-template-columns:1fr;gap:4px}.slabel{flex-direction:row;gap:8px;align-items:baseline}}
details.tview{margin-top:10px} summary{cursor:pointer;color:var(--accent);font-size:13.5px}
/* tabs */
.tabs{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 4px;border-bottom:1px solid var(--line)}
.tabs button{font:inherit;font-size:13.5px;border:0;background:none;color:var(--ink2);padding:6px 10px;border-bottom:2px solid transparent;cursor:pointer;margin-bottom:-1px}
.tabs button[aria-selected="true"]{color:var(--ink);font-weight:600;border-bottom-color:var(--ink)}
.tabs button:hover{background:var(--hover)}
.setnote{font-size:13px;color:var(--muted);margin:8px 0 0}
/* lever chart */
.lchart{display:flex;flex-direction:column;gap:2px}
.lrow{display:grid;grid-template-columns:minmax(0,18rem) minmax(0,1fr) 6.5rem;gap:10px;align-items:center;padding:3px 4px;border-radius:4px}
.lrow:hover,.lrow:focus-visible{background:var(--hover)}
.llabel{display:flex;flex-direction:column;min-width:0;font-size:12.5px;line-height:1.3}
.llabel code{background:none;padding:0;font-size:12px;font-weight:600}
.llabel span{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ltrack{position:relative;height:16px}
.ltrack::before{content:"";position:absolute;left:var(--zero);top:-3px;bottom:-3px;border-left:1px solid var(--axis)}
.lbar{position:absolute;top:2px;height:12px;min-width:2px}
.lbar.save{background:var(--save);border-radius:0 4px 4px 0}
.lbar.grow{background:var(--grow);border-radius:4px 0 0 4px}
.lval{text-align:right;font-size:12.5px;font-weight:600}
@media (max-width:640px){.lrow{grid-template-columns:minmax(0,1fr) 5.5rem}.llabel{grid-column:1/-1}.llabel span{white-space:normal}}
/* two/three columns */
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:14px}
.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
@media (max-width:820px){.two,.three{grid-template-columns:minmax(0,1fr)}}
.prose p,.prose li{max-width:68ch} .prose ul,.prose ol{padding-left:1.2em;margin:0 0 10px} .prose li{margin-bottom:4px}
.callout{border-left:3px solid var(--bad);padding:8px 12px;background:var(--bad-bg);border-radius:0 6px 6px 0;max-width:80ch}
ul.plain{padding-left:1.2em;margin:0;font-size:13.5px}
ul.broke{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;font-size:13px}
ul.broke li{border:1px solid var(--line);border-radius:6px;padding:8px 10px}
.bhead{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:2px}
.reason{color:var(--ink2)}
/* tables */
.tablewrap{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:5px 8px;border-bottom:1px solid var(--grid);text-align:left;vertical-align:top}
thead th{position:sticky;top:0;background:var(--surface);font-size:12px;color:var(--ink2);font-weight:600;white-space:nowrap}
th.r,td.r{text-align:right;white-space:nowrap}
table.num td{white-space:nowrap}
table.small td{white-space:normal} table.small td.r,table.small td:first-child{white-space:nowrap}
.lists{display:flex;flex-direction:column;gap:18px;margin-top:18px}
.lists>div{min-width:0}
ul.broke{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))}
tfoot th,tfoot td{font-weight:600;background:var(--page)} tfoot tr.total th,tfoot tr.total td{border-top:2px solid var(--axis)}
th button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
th button::after{content:" ↕";color:var(--muted);font-weight:400}
th button[aria-sort="ascending"]::after{content:" ↑";color:var(--ink)} th button[aria-sort="descending"]::after{content:" ↓";color:var(--ink)}
table.wl .pairhead th{background:var(--page);font-size:13px;color:var(--ink)} .delta{font-weight:400;color:var(--ink2);margin-left:8px}
table.wl tr.off td{color:var(--ink2)}
/* runs table */
.filters{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;margin:10px 0}
.filters label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
.filters label.grow{flex:1 1 14rem}
select,input[type=search]{font:inherit;font-size:13.5px;color:var(--ink);background:var(--page);border:1px solid var(--axis);border-radius:6px;padding:5px 8px;min-width:0;max-width:100%}
.count{font-size:13px;color:var(--ink2);margin-left:auto;padding-bottom:6px}
table.runs td.chg,table.runs th.chg{white-space:normal;min-width:16rem;max-width:30rem}
tr.run{cursor:pointer} tr.run:hover,tr.run:focus-visible{background:var(--hover)}
tr.run[aria-expanded="true"]{background:var(--hover)}
tr.detail td{background:var(--page);white-space:normal;padding:10px 12px}
.dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:6px 16px;font-size:12.5px;margin-bottom:8px}
.dgrid div{display:flex;flex-direction:column}.dgrid dt{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}.dgrid dd{margin:0;overflow-wrap:anywhere}
.dfiles{max-height:18rem;overflow:auto;border:1px solid var(--line);border-radius:6px;margin-top:6px}
.dfiles table{font-size:12px}
/* tooltip */
#tip{position:fixed;z-index:50;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 4px 18px rgba(0,0,0,.18);border-radius:6px;padding:7px 10px;font-size:12.5px;max-width:22rem}
#tip .v{font-weight:700;font-size:13.5px;font-variant-numeric:tabular-nums}
#tip .l{color:var(--ink2)}
footer{font-size:12.5px;color:var(--muted);text-align:center}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (forced-colors:active){.seg,.lbar,.sw{forced-color-adjust:none;border:1px solid CanvasText}}
`;

function client() {
  // Tooltip: anchored to the mark (not the pointer), so scrolling moves it with the mark instead of hiding it.
  var tip = document.getElementById('tip'); var anchor = null;
  function place() {
    if (!anchor) return;
    var r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { hideTip(); return; }
    var w = tip.offsetWidth, h = tip.offsetHeight, vw = document.documentElement.clientWidth;
    var cx = anchor.__x != null ? anchor.__x : r.left + Math.min(r.width, 240) / 2;
    var left = Math.min(Math.max(8, cx - w / 2), vw - w - 8);
    var top = r.top - h - 8; if (top < 8) top = r.bottom + 8;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function showTip(el, x) {
    var t = el.getAttribute('data-tip'); if (!t) return;
    if (anchor !== el) {
      tip.textContent = '';
      t.split('\n').forEach(function (line, i) { if (!line) return; var d = document.createElement('div'); d.className = i === 0 ? 'v' : 'l'; d.textContent = line; tip.appendChild(d); });
    }
    anchor = el; el.__x = x; tip.hidden = false; tip.setAttribute('data-open', 'true'); place();
  }
  function hideTip() { anchor = null; tip.hidden = true; tip.removeAttribute('data-open'); }
  function tipTarget(e) { return e.target && e.target.closest ? e.target.closest('[data-tip]') : null; }
  document.addEventListener('pointerover', function (e) { if (e.pointerType === 'touch') return; var el = tipTarget(e); if (el) showTip(el, e.clientX); });
  document.addEventListener('pointermove', function (e) { if (e.pointerType === 'touch') return; var el = tipTarget(e); if (el) showTip(el, e.clientX); else if (anchor && !anchor.contains(document.activeElement)) hideTip(); });
  // Tap: show on the tapped mark, tap again or elsewhere to close.
  document.addEventListener('click', function (e) {
    var el = tipTarget(e);
    if (el) { if (anchor === el && el.__tapped) { el.__tapped = false; hideTip(); } else { el.__tapped = true; showTip(el, e.clientX); } }
    else if (anchor) hideTip();
  });
  document.addEventListener('focusin', function (e) { var el = tipTarget(e); if (el) showTip(el, null); });
  document.addEventListener('focusout', function (e) { var el = tipTarget(e); if (el && anchor === el && !el.__tapped) hideTip(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);

  // hide segment labels that do not fit
  function fitLabels() { document.querySelectorAll('.seglab').forEach(function (s) { s.classList.remove('hide'); if (s.offsetWidth + 4 > s.parentElement.clientWidth) s.classList.add('hide'); }); }
  fitLabels(); window.addEventListener('resize', fitLabels);

  // tabs
  document.querySelectorAll('[role=tablist]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role=tab]'));
    function select(t) {
      tabs.forEach(function (o) { var on = o === t; o.setAttribute('aria-selected', on); o.tabIndex = on ? 0 : -1; document.getElementById(o.getAttribute('aria-controls')).hidden = !on; });
      fitLabels();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) { var n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (n) { var nt = tabs[(i + n + tabs.length) % tabs.length]; select(nt); nt.focus(); e.preventDefault(); } });
    });
  });

  // data
  var RUNS = JSON.parse(document.getElementById('runs-data').textContent);
  function fmt(n) { if (n == null) return '—'; var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (n < 0 ? '−' : '') + s; }

  // run details
  var runsTable = document.getElementById('runs');
  function closeDetail(tr) { var n = tr.nextElementSibling; if (n && n.classList.contains('detail')) n.remove(); tr.setAttribute('aria-expanded', 'false'); }
  function field(dl, k, v, mono) { var d = document.createElement('div'); var dt = document.createElement('dt'); dt.textContent = k; var dd = document.createElement('dd'); if (mono) { var c = document.createElement('code'); c.textContent = v == null || v === '' ? '—' : String(v); dd.appendChild(c); } else dd.textContent = v == null || v === '' ? '—' : String(v); d.appendChild(dt); d.appendChild(dd); dl.appendChild(d); }
  function block(td, title, text) { if (!text) return; var h = document.createElement('h3'); h.textContent = title; td.appendChild(h); var p = document.createElement('pre'); p.textContent = text; td.appendChild(p); }
  function openDetail(tr) {
    var r = RUNS[+tr.getAttribute('data-i')];
    var row = document.createElement('tr'); row.className = 'detail'; var td = document.createElement('td'); td.colSpan = 10; row.appendChild(td);
    var dl = document.createElement('dl'); dl.className = 'dgrid';
    field(dl, 'id', r.id, true); field(dl, 'base', r.base, true); field(dl, 'time', r.time); field(dl, 'host', r.host);
    field(dl, 'raw total', fmt(r.raw_total)); field(dl, 'brotli total', fmt(r.brotli_total)); field(dl, 'gzip total', fmt(r.gzip_total)); field(dl, 'publish dir raw', fmt(r.dir_raw_total));
    field(dl, 'build', r.build); field(dl, 'check', r.check); field(dl, 'decision', r.decision); field(dl, 'relinked', r.relinked == null ? null : String(r.relinked));
    field(dl, 'native sha256', r.native_wasm_sha256, true); field(dl, 'post-process', r.post); field(dl, 'parallel wave', r.parallel_wave); field(dl, 'duration (s)', r.duration_s);
    td.appendChild(dl);
    var p = document.createElement('p'); var b = document.createElement('strong'); b.textContent = 'Change: '; p.appendChild(b); p.appendChild(document.createTextNode(r.change || '—')); td.appendChild(p);
    var p2 = document.createElement('p'); var b2 = document.createElement('strong'); b2.textContent = 'Reason: '; p2.appendChild(b2); p2.appendChild(document.createTextNode(r.reason || '—')); td.appendChild(p2);
    block(td, 'MSBuild properties', r.props ? r.props.split(' -p:').join('\n-p:') : '');
    block(td, 'Build error', r.build_error); block(td, 'Check error', r.check_error);
    var h = document.createElement('h3');
    if (r.files && r.files.length) {
      h.textContent = 'Files (' + r.files.length + ')'; td.appendChild(h);
      var wrap = document.createElement('div'); wrap.className = 'dfiles'; var t = document.createElement('table'); t.className = 'num';
      var th = document.createElement('thead'); th.innerHTML = '<tr><th>File</th><th>Group</th><th class="r">Raw</th><th class="r">Brotli</th></tr>'; t.appendChild(th);
      var tb = document.createElement('tbody');
      r.files.slice().sort(function (a, b) { return b.brotli - a.brotli; }).forEach(function (f) {
        var tr2 = document.createElement('tr');
        [f.name, f.group, fmt(f.raw), fmt(f.brotli)].forEach(function (v, i) { var c = document.createElement('td'); if (i > 1) c.className = 'r'; c.textContent = v; tr2.appendChild(c); });
        tb.appendChild(tr2);
      });
      t.appendChild(tb); wrap.appendChild(t); td.appendChild(wrap);
    } else { h.textContent = 'Files'; td.appendChild(h); var np = document.createElement('p'); np.className = 'muted'; np.textContent = '— (no file list captured for this run)'; td.appendChild(np); }
    tr.after(row); tr.setAttribute('aria-expanded', 'true');
  }
  runsTable.addEventListener('click', function (e) { if (e.target.closest('thead')) return; var tr = e.target.closest('tr.run'); if (!tr) return; if (tr.getAttribute('aria-expanded') === 'true') closeDetail(tr); else openDetail(tr); });
  runsTable.addEventListener('keydown', function (e) { var tr = e.target.closest && e.target.closest('tr.run'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); } });

  // filters
  var ids = ['round', 'variant', 'group', 'decision', 'check'];
  var q = document.getElementById('f-q'), count = document.getElementById('f-count');
  function apply() {
    var want = {}; ids.forEach(function (k) { want[k] = document.getElementById('f-' + k).value; });
    var term = q.value.trim().toLowerCase(); var n = 0, all = 0;
    runsTable.querySelectorAll('tr.run').forEach(function (tr) {
      all++;
      var ok = ids.every(function (k) { return !want[k] || tr.getAttribute('data-' + k) === want[k]; }) && (!term || tr.getAttribute('data-q').indexOf(term) >= 0);
      if (!ok && tr.getAttribute('aria-expanded') === 'true') closeDetail(tr);
      tr.hidden = !ok; if (ok) n++;
    });
    count.textContent = n + ' of ' + all + ' runs';
  }
  ids.forEach(function (k) { document.getElementById('f-' + k).addEventListener('change', apply); });
  q.addEventListener('input', apply);

  // sortable tables
  document.querySelectorAll('table.sortable').forEach(function (table) {
    var btns = Array.prototype.slice.call(table.querySelectorAll('thead th button[data-sort]'));
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var th = btn.closest('th'); var col = Array.prototype.indexOf.call(th.parentElement.children, th);
        var num = btn.getAttribute('data-sort') === 'num';
        var dir = btn.getAttribute('aria-sort') === 'descending' ? 'ascending' : btn.getAttribute('aria-sort') === 'ascending' ? 'descending' : (num ? 'descending' : 'ascending');
        btns.forEach(function (b) { b.removeAttribute('aria-sort'); }); btn.setAttribute('aria-sort', dir);
        var tbody = table.tBodies[0];
        tbody.querySelectorAll('tr.run[aria-expanded="true"]').forEach(closeDetail);
        var rows = Array.prototype.slice.call(tbody.rows);
        rows.sort(function (a, b) {
          var x = a.cells[col].getAttribute('data-v'), y = b.cells[col].getAttribute('data-v');
          var c;
          if (num) { var xe = x === '' || x == null, ye = y === '' || y == null; if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1; c = +x - +y; } else c = String(x).localeCompare(String(y));
          return dir === 'ascending' ? c : -c;
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      });
    });
  });
}

const dataJson = JSON.stringify(runs).replace(/</g, '\\u003c');
const TITLE = '<title>Blazor WASM Size Experiments</title>\n';
const DESC = '<meta name="description" content="Size experiments for a minimal Blazor WebAssembly app on .NET 11: what each setting saves, and why the 1,100,000-byte brotli target is not reached.">\n';
const STYLE = `<style>${CSS}</style>\n`;
const body = `<div class="wrap">
<header>
  <p class="eyebrow">.NET SDK 11.0.100 · stock Mono runtime · Release publish · ${runs.length} runs</p>
  <h1>Blazor WebAssembly size experiments</h1>
</header>
${verdict}
${whereBytes}
${levers}
${workload}
${tradeoffs}
${perFile}
${allRuns}
${method}
<footer>Generated from <code>results/experiments.jsonl</code> (${runs.length} lines) by <code>tools/build-report.mjs</code>.</footer>
</div>
<div id="tip" role="tooltip" hidden></div>
<script type="application/json" id="runs-data">${dataJson}</script>
<script>(${client.toString()})();</script>
`;
// A full document with its own base rules and site navigation.
const SITE_CSS = `<style>
:root{color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark}}
body{margin:0} [hidden]{display:none!important} img{max-width:100%}
.sitenav{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;padding-block:12px 0}
.sitenav a{color:var(--accent);font-weight:600}
</style>
`;
const navLinks = [`<a href="${esc(opts.home)}">← Demo home</a>`];
if (opts.repo) navLinks.push(`<a href="${esc(opts.repo)}">README and source</a>`);
const standaloneHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${TITLE}${DESC}${STYLE}${SITE_CSS}</head>
<body>
${body.replace('<div class="wrap">\n', `<div class="wrap">\n<nav class="sitenav" aria-label="Site">${navLinks.join('')}</nav>\n`)}</body>
</html>
`;
const html = standaloneHtml;

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, html);
const scrubSummary = Object.keys(scrubLog).sort().map((k) => `${k}: ${scrubLog[k]}`).join(', ') || 'none';
console.log(`wrote ${OUT} (${Buffer.byteLength(html)} bytes, ${runs.length} runs; scrubbed: ${scrubSummary})`);

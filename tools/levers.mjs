// The headline list of ways to reduce the download size: the same rows, order and numbers as the lever table at the top
// of README.md ("How to reduce Blazor WebAssembly download size"). Numbers are read from results/experiments.jsonl.
// Each saving is one setting alone on the default Honest app (h00-default), or one step on top of earlier steps
// (the base run), so the savings do not add up exactly.
// Used by tools/assemble-site.mjs (landing page) and tools/build-report.mjs (report page).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// [label (HTML), kind, ...run ids]
//   delta: saving of one run against its base run (delta field, or brotli minus base brotli when the field is empty)
//   pair:  brotli of run A minus brotli of run B
//   range: two pairs, shown as "about Xk to Yk"
const ROWS = [
  ['Native relink with the <code>wasm-tools</code> workload, plus the settings that need it', 'range', 'ab-honest-managed-norelink', 'f-honest', 'ab-extreme-managed-norelink', 'f-extreme'],
  ['<code>InvariantGlobalization=true</code>', 'delta', 's-invglob'],
  ['<code>Extreme</code> code changes: own router, HTTP through JS <code>fetch</code>', 'delta', 'e00-extreme'],
  ['<code>EventSourceSupport=false</code>', 'delta', 's-noeventsource'],
  ['Bit.Minifier', 'delta', 's-bitmin'],
  ['One bundle file for all assemblies', 'delta', 'r2-b-group'],
  ['<code>InvariantTimezone=true</code>, <code>BlazorEnableTimeZoneSupport=false</code>', 'delta', 's-invtz'],
  ['<code>MetricsSupport=false</code>', 'delta', 's-nometrics'],
  ['<code>DynamicCodeSupport=false</code>', 'delta', 'c-honest-dyncode'],
  ['<code>WasmEnableSIMD=false</code>', 'delta', 's-nosimd'],
  ['Native function stubs', 'pair', 'r2-x-names', 'f2-extreme'],
  ['terser on the JS files', 'delta', 'e04-minify'],
  ['Mono.Cecil metadata pass', 'delta', 'r2-m-props-notasks'],
  ['<code>wasm-opt -Oz</code>', 'delta', 'e03-wasmopt'],
];

export function loadLog(file = path.join(ROOT, 'results', 'experiments.jsonl')) {
  return new Map(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((o) => [o.id, o]));
}

// -> [{ label, saved, savedText, runs, runText }]
export function levers(log = loadLog()) {
  const br = (id) => { const r = log.get(id); if (!r || r.brotli_total == null) throw new Error(`levers: run ${id} has no brotli total`); return r.brotli_total; };
  const delta = (id) => { const r = log.get(id); return r.delta_brotli ?? (br(id) - br(r.base)); };
  const n = (v) => v.toLocaleString('en-US');
  return ROWS.map(([label, kind, ...ids]) => {
    if (kind === 'delta') { const s = -delta(ids[0]); return { label, saved: s, savedText: n(s), runs: ids, runText: ids[0] }; }
    if (kind === 'pair') { const s = br(ids[0]) - br(ids[1]); return { label, saved: s, savedText: n(s), runs: ids, runText: `${ids[0]} → ${ids[1]}` }; }
    const a = br(ids[0]) - br(ids[1]), b = br(ids[2]) - br(ids[3]);
    const lo = Math.floor(Math.min(a, b) / 50_000) * 50, hi = Math.round(Math.max(a, b) / 50_000) * 50;
    return { label, saved: Math.min(a, b), savedText: `about ${lo}k to ${hi}k`, runs: ids, runText: `${ids[0]} → ${ids[1]}, ${ids[2]} → ${ids[3]}` };
  });
}

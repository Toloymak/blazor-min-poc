// Append finished runs to results/experiments.jsonl (append-only) and copy trace files to results/runs/<id>/.
// Usage: node tools/collect.mjs <meta.json>   meta = [{id, variant, group, base, change, decision, reason, parallel_wave, from?}]
// The facts come from out/<id>.result.json; `from` = "mac" marks runs measured on the Mac. Existing ids are skipped.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const jsonl = path.join(root, 'results', 'experiments.jsonl');
fs.mkdirSync(path.join(root, 'results', 'runs'), { recursive: true });
const have = new Map();
if (fs.existsSync(jsonl)) for (const l of fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)) { const o = JSON.parse(l); have.set(o.id, o); }
// no absolute home paths / user names in committed results
function scrubDir(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { scrubDir(p); continue; }
    const t = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, t.replace(/\/home\/[a-z0-9_-]+/g, '~').replace(/\/Users\/[a-zA-Z0-9_-]+/g, '~').split(process.env.SCRUB_USER || 'nobody-user').join('<user>'));
  }
}
const meta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const m of meta) {
  if (have.has(m.id)) { console.log(`skip ${m.id} (already logged)`); continue; }
  let facts = m.facts ?? null;
  const rf = path.join(root, 'out', `${m.id}.result.json`);
  if (!facts && fs.existsSync(rf)) facts = JSON.parse(fs.readFileSync(rf, 'utf8'));
  if (!facts) { console.log(`MISSING facts for ${m.id}`); continue; }
  const base = m.base ? have.get(m.base) : null;
  const o = {
    id: m.id, time: facts.time ?? null, variant: m.variant, group: m.group, base: m.base ?? null, change: m.change,
    props: facts.props ?? null, post: facts.post ?? null, host: m.from ?? 'linux-host',
    raw_total: facts.raw_total ?? null, brotli_total: facts.brotli_total ?? null, gzip_total: facts.gzip_total ?? null, dir_raw_total: facts.dir_raw_total ?? null,
    delta_brotli: base?.brotli_total != null && facts.brotli_total != null ? facts.brotli_total - base.brotli_total : null,
    distance_to_target: facts.brotli_total != null ? facts.brotli_total - 1100000 : null,
    files: facts.files ?? null, native_wasm_sha256: facts.native_wasm_sha256 ?? null, relinked: facts.relinked ?? null,
    check: facts.check ?? 'not-run', check_error: facts.check_error ?? null, build: facts.build ?? null, build_error: facts.build_error ?? null,
    decision: m.decision, reason: m.reason, parallel_wave: m.parallel_wave ?? null, duration_s: facts.duration_s ?? null,
  };
  fs.appendFileSync(jsonl, JSON.stringify(o) + '\n'); have.set(o.id, o);
  const src = path.join(root, 'out', `${m.id}.run`), dst = path.join(root, 'results', 'runs', m.id);
  if (fs.existsSync(src)) { fs.cpSync(src, dst, { recursive: true }); scrubDir(dst); }
  console.log(`logged ${m.id} br=${o.brotli_total} delta=${o.delta_brotli} ${o.decision}`);
}

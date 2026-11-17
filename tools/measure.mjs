// Size report for a publish wwwroot. Usage: node tools/measure.mjs <wwwroot> <netlog.json> [label]
// Brotli = quality 11, lgwin 24 (same as `brotli -q 11` CLI defaults), via node zlib.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = path.resolve(process.argv[2]);
const log = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const label = process.argv[4] ?? '';
const br = buf => zlib.brotliCompressSync(buf, { params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
  [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;

const gz = buf => zlib.gzipSync(buf, { level: 9 }).length;
const BASE = process.env.BASE_PATH ?? '/';
const files = new Map();
for (const e of log) {
  let rel = e.path;
  if (BASE !== '/' && rel.startsWith(BASE)) rel = '/' + rel.slice(BASE.length);
  let f = path.join(dir, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    if (path.extname(rel) === '' ) { rel = '/index.html'; f = path.join(dir, rel); }
    else continue;
  }
  if (!files.has(rel)) files.set(rel, f);
}
// served totals: what the browser got over the wire (encoded body bytes), and the sum of the .br/.gz files of the same set
const served = { transfer: 0, encodedFiles: 0, enc: new Set(), n: 0 };
const seenPath = new Set();
for (const e of log) { if (seenPath.has(e.path) || e.transfer == null) continue; seenPath.add(e.path); served.transfer += e.transfer; served.enc.add(e.enc ?? 'identity'); served.n++; }
const rows = [...files].map(([rel, f]) => { const b = fs.readFileSync(f); return { rel, raw: b.length, br: br(b), gz: gz(b) }; })
  .sort((a, b) => b.br - a.br);
const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);

const all = [];
(function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : all.push(p); } })(dir);
const plain = all.filter(p => !/\.(br|gz)$/.test(p));
const dirRaw = plain.reduce((s, p) => s + fs.statSync(p).size, 0);
const dirBr = plain.reduce((s, p) => s + br(fs.readFileSync(p)), 0);
const allRaw = all.reduce((s, p) => s + fs.statSync(p).size, 0);

const encExt = process.env.SERVE_ENCODED === 'gzip' ? '.gz' : '.br';
for (const [rel, f] of files) served.encodedFiles += fs.existsSync(f + encExt) ? fs.statSync(f + encExt).size : NaN;
const res = { label, served: { transferTotal: served.transfer, encodedFilesTotal: served.encodedFiles, encodings: [...served.enc], responses: served.n }, coldFiles: rows.length, coldRaw: sum(rows, 'raw'), coldBr: sum(rows, 'br'), coldGz: sum(rows, 'gz'),
  dirFiles: plain.length, dirRaw, dirBr, dirAllFilesInclBrGz: all.length, dirAllRaw: allRaw, files: rows };
console.log(`== ${label} ${dir}`);
console.log(`COLD-LOAD files=${res.coldFiles} raw=${res.coldRaw} brotli=${res.coldBr} gzip9=${res.coldGz}`);
if (process.env.SERVE_ENCODED) console.log(`SERVED encoding=${[...served.enc]} transfer=${served.transfer} sum-of-${encExt}-files=${served.encodedFiles} equal=${served.transfer === served.encodedFiles}`);
console.log(`DIRECTORY (no .br/.gz) files=${res.dirFiles} raw=${res.dirRaw} brotli=${res.dirBr}; incl .br/.gz files=${all.length} raw=${allRaw}`);
const group = r => /dotnet\.native.*\.wasm$/.test(r.rel) ? "native" : /\/b\.bin$/.test(r.rel) ? "managed" : /\.(js|json)$/.test(r.rel) && r.rel.includes('_framework') ? 'js-loader' : /\.(wasm|dll)$/.test(r.rel) ? 'managed' : /\.dat$/.test(r.rel) ? 'icu' : 'other';
const groups = {};
for (const r of rows) { const g = group(r); groups[g] ??= { raw: 0, br: 0, n: 0 }; groups[g].raw += r.raw; groups[g].br += r.br; groups[g].n++; }
res.groups = groups;
console.log('GROUPS ' + Object.entries(groups).map(([g, v]) => `${g}: n=${v.n} raw=${v.raw} br=${v.br}`).join(' | '));
console.log('top 10 by brotli:');
for (const r of rows.slice(0, 10)) console.log(`  ${String(r.br).padStart(9)} br  ${String(r.raw).padStart(9)} raw  ${r.rel}`);
if (process.env.ALLFILES) for (const r of rows.slice(10)) console.log(`  ${String(r.br).padStart(9)} br  ${String(r.raw).padStart(9)} raw  ${r.rel}`);
// The .br files next to the cold-load files (made by build.sh / compress.mjs) must give the same total as the
// brotli computed here; if they ever disagree, stop instead of reporting a number that is not what is served.
{
  const withBr = [...files.values()].filter(f => fs.existsSync(f + '.br'));
  if (withBr.length === files.size && files.size) {
    const sumBr = withBr.reduce((s, f) => s + fs.statSync(f + '.br').size, 0);
    console.log(`BR-FILES sum=${sumBr} computed=${res.coldBr} equal=${sumBr === res.coldBr}`);
    if (sumBr !== res.coldBr) { console.error('ERROR: .br files on disk and computed brotli differ'); process.exitCode = 1; }
  }
}
fs.writeFileSync(process.argv[3].replace(/\.json$/, '') + '.sizes.json', JSON.stringify(res, null, 1));

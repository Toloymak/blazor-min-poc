// Write <file>.br (brotli q11, window 24 = `brotli -q 11 -w 24`) and <file>.gz (gzip -9) next to every file
// of a wwwroot, after all post-processing. Old .br/.gz files are replaced.
// Usage: node tools/compress.mjs <wwwroot>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root = path.resolve(process.argv[2]);
const all = [];
(function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : all.push(p); } })(root);
for (const p of all.filter(p => /\.(br|gz)$/.test(p))) fs.rmSync(p);
let n = 0;
for (const p of all.filter(p => !/\.(br|gz)$/.test(p))) {
  const b = fs.readFileSync(p);
  fs.writeFileSync(p + '.br', zlib.brotliCompressSync(b, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }));
  fs.writeFileSync(p + '.gz', zlib.gzipSync(b, { level: 9 }));
  n++;
}
console.log(`compressed ${n} files in ${root}`);

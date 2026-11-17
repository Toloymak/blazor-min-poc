// Per-assembly brotli sizes of the parts of a bundle (each part compressed on its own), from the table in index.html.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const root = path.resolve(process.argv[2]);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const T = JSON.parse(html.match(/T=(\{.*?\});/)[1]);
const js = fs.readFileSync(path.join(root, '_framework', 'dotnet.js'), 'utf8');
const bin = fs.readFileSync(path.join(root, '_framework', 'b.bin'));
const br = b => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
let sum = 0;
const rows = Object.entries(T).map(([k, [o, l]]) => {
  const m = js.match(new RegExp(`virtualPath:"([^"]+)",name:"${k}"`));
  const b = br(bin.subarray(o, o + l)); sum += b; return [m ? m[1] : k, l, b];
}).sort((a, b) => b[2] - a[2]);
for (const r of rows) console.log(`PART ${r[0]} raw=${r[1]} br_alone=${r[2]}`);
console.log(`PARTS sum_alone=${sum} bundle_br=${br(bin)}`);

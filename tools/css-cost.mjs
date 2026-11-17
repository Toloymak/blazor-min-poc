// What the inline page styles cost each app: CSS raw bytes, and the brotli bytes inline vs as a separate file.
import fs from 'node:fs';
import zlib from 'node:zlib';
const br = b => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
for (const v of ['honest', 'extreme']) {
  const h = fs.readFileSync(`artifacts/${v}/wwwroot/index.html`, 'utf8');
  const m = h.match(/<style>([\s\S]*?)<\/style>/);
  const none = h.replace(/\s*<style>[\s\S]*?<\/style>/, '').replace(/ data-app="[^"]*"/, '');
  const link = h.replace(m[0], '<link rel="stylesheet" href="app.css">');
  const B = s => br(Buffer.from(s));
  console.log(`CSS ${v} raw=${Buffer.byteLength(m[1])} index.html.br=${B(h)} without-styles=${B(none)} inline-adds=${B(h) - B(none)} as-file-adds=${B(link) - B(none) + br(Buffer.from(m[1]))}`);
}

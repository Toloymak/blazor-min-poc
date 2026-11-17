// Joint-compression bundle: concatenate the managed assemblies (optionally also dotnet.native.wasm) into one file
// _framework/b.bin, fetched once; Blazor.start({ loadBootResource }) hands each slice to the runtime as a Response.
// The stock loader only checks integrity when it does the fetch itself; for a returned Response it does not,
// so the bundle is protected by its own sha256 `integrity` on the single fetch instead.
// Usage: node tools/bundle.mjs <wwwroot>   Env: BUNDLE_WASM=1, BUNDLE_ORDER=alpha|size|group|boot
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(process.argv[2]);
const fw = path.join(root, '_framework');
const dotnetJs = fs.readdirSync(fw).find(f => /^dotnet(\.[a-z0-9]+)?\.js$/.test(f));
const boot = fs.readFileSync(path.join(fw, dotnetJs), 'utf8');
const dlls = [...new Set([...boot.matchAll(/["']?name["']?\s*:\s*"([^"]+\.dll)"/g)].map(m => m[1]))];
const wasm = [...boot.matchAll(/["']?wasmNative["']?\s*:\s*\[\s*\{\s*["']?name["']?\s*:\s*"([^"]+)"/g)].map(m => m[1])[0];
let names = [...dlls];
const order = process.env.BUNDLE_ORDER ?? 'group';
const size = n => fs.statSync(path.join(fw, n)).size;
if (order === 'alpha') names.sort();
if (order === 'size') names.sort((a, b) => size(b) - size(a));
if (order === 'group') { // CoreLib first, then System.*, then Microsoft.Extensions.*, then ASP.NET Core / JSInterop, then the app
  const rank = n => /^System\.Private\.CoreLib/.test(n) ? 0 : /^System\./.test(n) ? 1 : /^Microsoft\.Extensions\./.test(n) ? 2 : /^Microsoft\./.test(n) ? 3 : 4;
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
if (process.env.BUNDLE_WASM && wasm) names = [wasm, ...names];
const parts = names.map(n => fs.readFileSync(path.join(fw, n)));
const bin = Buffer.concat(parts);
fs.writeFileSync(path.join(fw, 'b.bin'), bin);
for (const n of names) fs.rmSync(path.join(fw, n));
const sri = 'sha256-' + crypto.createHash('sha256').update(bin).digest('base64');
// table: name -> [offset, length]
let off = 0; let table = {};
names.forEach((n, i) => { table[n] = [off, parts[i].length]; off += parts[i].length; });
if (process.env.BOOT_SLIM) {
  // Boot config: bundled entries lose their hash/cache fields (the bundle has its own integrity) and get short names.
  let js = fs.readFileSync(path.join(fw, dotnetJs), 'utf8');
  const short = {};
  names.forEach((n, i) => {
    const k = i.toString(36);
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(["']?name["']?\\s*:\\s*)"${esc}"(\\s*,\\s*["']?hash["']?\\s*:\\s*"[^"]*")?(\\s*,\\s*["']?cache["']?\\s*:\\s*"[^"]*")?`, 'g');
    const before = js; js = js.replace(re, `$1"${k}"`);
    if (js !== before) short[k] = table[n];
    else short[n] = table[n];
  });
  fs.writeFileSync(path.join(fw, dotnetJs), js);
  table = short;
}
const loader = `<script>var B=fetch("_framework/b.bin",{integrity:"${sri}"}).then(function(r){return r.arrayBuffer()}),T=${JSON.stringify(table)};` +
  `Blazor.start({${process.env.JITERP_OFF ? 'configureRuntime:function(r){r.withRuntimeOptions(["--no-jiterpreter-traces-enabled","--no-jiterpreter-interp-entry-enabled","--no-jiterpreter-jit-call-enabled"])},' : ''}loadBootResource:function(t,n){var e=T[n];if(e)return B.then(function(a){return new Response(new Uint8Array(a,e[0],e[1]),{headers:{"content-type":/\\.wasm$/.test(n)?"application/wasm":"application/octet-stream"}})})}})</script>`;
const idxPath = path.join(root, 'index.html');
let html = fs.readFileSync(idxPath, 'utf8');
if (!html.includes('_framework/blazor.webassembly.js"></script>')) throw new Error('blazor script tag not found');
html = html.replace('<script src="_framework/blazor.webassembly.js"></script>', '<script src="_framework/blazor.webassembly.js" autostart="false"></script>' + loader);
fs.writeFileSync(idxPath, html);
console.log(`bundle b.bin: ${names.length} files, ${bin.length} bytes, order=${order}, wasm=${!!process.env.BUNDLE_WASM}; loader ${loader.length} bytes`);

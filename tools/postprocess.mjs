// Post-process a Blazor WASM publish wwwroot (Extreme variant). Usage: node tools/postprocess.mjs <wwwroot>
// Env: WASMOPT=1 (wasm-opt on dotnet.native.wasm), MINIFY=1 (terser on JS), WASMOPT_FLAGS (override).
// Every changed file gets its new sha256 written into the boot config (embedded in dotnet.js) so integrity checks pass.
// Precompressed .br/.gz copies and .map files are deleted (they would be stale).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { minify } from 'terser';

const root = path.resolve(process.argv[2]);
const fw = path.join(root, '_framework');
const sri = f => 'sha256-' + crypto.createHash('sha256').update(fs.readFileSync(f)).digest('base64');
const files = fs.readdirSync(fw);
const pick = re => files.filter(f => re.test(f)).map(f => path.join(fw, f));
const changed = new Map(); // old sri -> file
const before = f => { if (![...changed.values()].includes(f)) changed.set(sri(f), f); };
const TERSER_OPTS = process.env.TERSER_AGGR
  ? { module: true, toplevel: true, ecma: 2020, compress: { passes: 3, unsafe: true, unsafe_arrows: true, unsafe_methods: true, pure_getters: true, booleans_as_integers: false }, mangle: { toplevel: true }, format: { comments: false, wrap_func_args: false } }
  : { module: true, ecma: 2020, compress: { passes: 2 }, mangle: true, format: { comments: false } };
// binaryen tools: the pinned npm package (tools/package.json, binaryen 125.0.0), so one version is used everywhere
const binDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'node_modules', '.bin');
const tool = n => process.env[n.toUpperCase().replace('-', '_')] ?? path.join(binDir, n);
const log = (f, a, b) => console.log(`${path.basename(f)}: ${a} -> ${b} (${b - a})`);

for (const f of files.filter(f => /\.(br|gz|map)$/.test(f))) fs.rmSync(path.join(fw, f));
for (const f of fs.readdirSync(fw)) before(path.join(fw, f));
if (process.env.METASTRIP) {
  // Mono.Cecil metadata pass (tools/MetaStrip), METASTRIP = space-free list like "attrs,consts,props"
  const rc = fs.readdirSync(path.join(root, '..')).find(n => n.endsWith('.runtimeconfig.json'));
  const appName = rc ? rc.replace('.runtimeconfig.json', '') : '';
  const tool = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'MetaStrip', 'bin', 'Release', 'net11.0', 'MetaStrip');
  execFileSync('dotnet', ['build', path.dirname(tool).replace(/bin.*$/, ''), '-c', 'Release', '-v:q'], { stdio: 'inherit' });
  execFileSync(tool, [fw, ...process.env.METASTRIP.split(',').map(x => '--' + x), '--app', appName], { stdio: 'inherit' });
}

if (process.env.WASMOPT) {
  for (const f of pick(/^dotnet\.native.*\.wasm$/)) {
    before(f); const a = fs.statSync(f).size;
    if (process.env.NATIVE_STUB) {
      // needs a native link that kept the name section (-p:NativeNames=true); regexes separated by ';'
      execFileSync('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'wasmstub.mjs'), f, f, ...process.env.NATIVE_STUB.split(';')], { stdio: 'inherit' });
    }
    if (process.env.METADCE_DROP) {
      // wasm-metadce: keep every export except those matching METADCE_DROP (a regex), so code only they reach goes away.
      const mod = new WebAssembly.Module(fs.readFileSync(f));
      const drop = new RegExp(process.env.METADCE_DROP);
      const ex = WebAssembly.Module.exports(mod), im = WebAssembly.Module.imports(mod);
      const graph = [{ name: 'outside', root: true, reaches: ex.filter(e => !drop.test(e.name)).map((e, i) => 'e' + ex.indexOf(e)) },
        ...ex.map((e, i) => ({ name: 'e' + i, export: e.name })), ...im.map((m, i) => ({ name: 'i' + i, import: [m.module, m.name] }))];
      const gf = f + '.graph.json'; fs.writeFileSync(gf, JSON.stringify(graph));
      const dropped = ex.filter(e => drop.test(e.name)).map(e => e.name);
      console.log(`metadce: dropping ${dropped.length} exports: ${dropped.join(' ')}`);
      execFileSync(tool('wasm-metadce'), ['--graph-file', gf, f, '-o', f, '--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-exception-handling', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals', '--enable-reference-types', '--enable-multivalue'], { stdio: ['ignore', 'ignore', 'inherit'] });
      fs.rmSync(gf);
    }
    const flags = (process.env.WASMOPT_FLAGS?.replaceAll('@', ' ') ?? '-Oz --enable-bulk-memory --enable-bulk-memory-opt --enable-exception-handling --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue').split(' ');
    execFileSync(tool('wasm-opt'), [...flags, f, '-o', f], { stdio: 'inherit' });
    log(f, a, fs.statSync(f).size);
  }
}

if (process.env.MINIFY) {
  const js = [...pick(/^dotnet\.native.*\.js$/), ...pick(/^dotnet\.runtime.*\.js$/), ...pick(/^blazor\.webassembly.*\.js$/)];
  for (const f of js) {
    before(f); const a = fs.statSync(f).size;
    const r = await minify(fs.readFileSync(f, 'utf8'), TERSER_OPTS);
    fs.writeFileSync(f, r.code); log(f, a, fs.statSync(f).size);
  }
}

// Rewrite integrity hashes in the boot config (dotnet.js) and index.html, then minify dotnet.js itself.
const bootFiles = [...pick(/^dotnet\.[a-z0-9]*\.?js$/).filter(f => !/native|runtime/.test(f)), path.join(root, 'index.html')];
for (const f of bootFiles) {
  let s = fs.readFileSync(f, 'utf8'); let n = 0;
  for (const [old, file] of changed) { const nw = sri(file); if (s.includes(old)) { s = s.split(old).join(nw); n++; } }
  fs.writeFileSync(f, s);
  if (n) console.log(`${path.basename(f)}: updated ${n} integrity hashes`);
}
if (process.env.MINIFY) {
  for (const f of bootFiles.filter(f => f.endsWith('.js'))) {
    const a = fs.statSync(f).size; const old = sri(f);
    const r = await minify(fs.readFileSync(f, 'utf8'), TERSER_OPTS);
    fs.writeFileSync(f, r.code); log(f, a, fs.statSync(f).size);
    const idx = path.join(root, 'index.html'); const h = fs.readFileSync(idx, 'utf8');
    if (h.includes(old)) fs.writeFileSync(idx, h.split(old).join(sri(f)));
  }
}

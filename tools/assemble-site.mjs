// Assemble the demo site (both variants + landing page) from the build.sh outputs. One code path for both hosts:
//   node tools/assemble-site.mjs <base-path> <out-dir> [sizes-honest.json sizes-extreme.json] [--host pages|appservice]
//   artifacts/honest/wwwroot  -> <out>/honest/,  artifacts/extreme/wwwroot -> <out>/extreme/
// <base href> of each app is rewritten to <base>honest/ or <base>extreme/ (sub-path hosting).
// --host pages (default, GitHub Pages):
//   - Pages compresses with gzip itself and ignores precompressed files: .br/.gz are dropped.
//   - Deep links (no SPA fallback on Pages): known routes get a copy of index.html as <route>.html (Pages serves
//     /x/counter from counter.html with 200); any other path hits the single root 404.html, which redirects to
//     <base><app>/?p=<rest>; a tiny inline script in index.html puts the path back with history.replaceState.
//   - Search engines: robots.txt at the site root, and <meta name="robots" content="noindex, nofollow"> injected into
//     the landing page and both index.html (Pages cannot send headers). This happens here, not in build.sh, so the
//     measured artifacts stay unchanged; the byte cost of the tag is printed.
// --host appservice (tools Host/, Azure App Service): the host does the SPA fallback and sends X-Robots-Tag on every
//   response, so no route copies, no 404.html, no meta tag. .br/.gz are kept and re-made for every file changed here.
// Landing-page numbers come from the measured (un-injected) build: the sizes json files written by measure.mjs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const hostIdx = args.indexOf('--host'); const host = hostIdx >= 0 ? args.splice(hostIdx, 2)[1] : 'pages';
// --repo https://github.com/<owner>/<repo>: link to the repository (source and documentation) from the landing page and the report (omit when unknown)
const repoIdx = args.indexOf('--repo'); const repo = repoIdx >= 0 ? args.splice(repoIdx, 2)[1] : (process.env.REPO_URL || null);
let [base, out, sh, se] = args;
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const br = b => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } });
const gz = b => zlib.gzipSync(b, { level: 9 });
const writeHtml = (file, html) => {
  fs.writeFileSync(file, html);
  if (host === 'appservice') { const b = Buffer.from(html); fs.writeFileSync(file + '.br', br(b)); fs.writeFileSync(file + '.gz', gz(b)); }
};
const META = '<meta name="robots" content="noindex, nofollow">';
const metaCost = [];
const injectMeta = (name, html) => {
  const withMeta = html.replace(/<head>/i, '<head>' + META);
  const a = Buffer.from(html), b = Buffer.from(withMeta);
  const sg = n => (n >= 0 ? "+" : "") + n;
  metaCost.push(`${name}: ${sg(b.length - a.length)} raw, ${sg(br(b).length - br(a).length)} brotli, ${sg(gz(b).length - gz(a).length)} gzip`);
  return withMeta;
};

const routes = ['counter', 'fetch'];
const restore = `<script>(function(){var q=new URLSearchParams(location.search),p=q.get("p");if(p!==null){q.delete("p");var s=q.toString();history.replaceState(null,"",document.baseURI.replace(/[^/]*$/,"")+p.replace(/^\\//,"")+(s?"?"+s:"")+location.hash)}})()</script>`;
for (const v of ['honest', 'extreme']) {
  const src = path.join(root, 'artifacts', v, 'wwwroot');
  const dst = path.join(out, v);
  fs.cpSync(src, dst, { recursive: true });
  if (host === 'pages') for (const d of [dst, path.join(dst, '_framework')]) for (const f of fs.readdirSync(d)) if (/\.(br|gz)$/.test(f)) fs.rmSync(path.join(d, f));
  let html = fs.readFileSync(path.join(dst, 'index.html'), 'utf8');
  if (!/<base href="[^"]*"\s*\/?>/.test(html)) throw new Error(`no <base href> in ${v}/index.html`);
  html = html.replace(/<base href="[^"]*"\s*\/?>/, `<base href="${base}${v}/">${host === 'pages' ? restore : ''}`);
  if (host === 'pages') html = injectMeta(`${v}/index.html`, html);
  writeHtml(path.join(dst, 'index.html'), html);
  if (host === 'pages') for (const r of routes) fs.writeFileSync(path.join(dst, `${r}.html`), html);
}
if (host === 'pages') {
  fs.writeFileSync(path.join(out, '404.html'), `<!DOCTYPE html><meta charset="utf-8">${META}<title>Redirecting</title>
<script>
// Single 404 page for two SPAs under one Pages site: send /<base>/<app>/<rest> to /<base>/<app>/?p=<rest>.
var b=${JSON.stringify(base)},l=location,m=l.pathname.slice(b.length).match(/^(honest|extreme)(\\/.*)?$/);
if(l.pathname.indexOf(b)===0&&m){var q=l.search?"&"+l.search.slice(1):"";l.replace(b+m[1]+"/?p="+encodeURIComponent((m[2]||"/").slice(1))+q+l.hash)}
else document.write('<p>Not found. <a href="'+b+'">Home</a></p>');
</script>`);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
}
// crawlers read robots.txt only at the domain root: effective on App Service and on a user/custom-domain Pages site,
// no effect for a project site under /<repo>/ (that is why Pages also gets the meta tag)
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

const fmt = n => n == null ? 'n/a' : n.toLocaleString('en-US');
const readSizes = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const SH = readSizes(sh), SE = readSizes(se);
// Measured runs from the log: the template baseline and the savings of the main changes (brotli bytes, each run
// against its base run in the log).
const log = new Map(fs.readFileSync(path.join(root, 'results', 'experiments.jsonl'), 'utf8').split('\n').filter(Boolean)
  .map(l => JSON.parse(l)).map(o => [o.id, o]));
const TEMPLATE = log.get('baseline')?.brotli_total ?? null;
const WAYS = [
  ['h02-invglob', 'Invariant globalization (no ICU data, ICU left out of the native file)', 'both'],
  ['e00-extreme', 'Own router and JS <code>fetch</code> instead of <code>Router</code> and <code>HttpClient</code>', 'Extreme'],
  ['h05-noeventsource', '<code>EventSourceSupport=false</code>', 'both'],
  ['c-honest-bitmin', 'Bit.Minifier on the trimmed assemblies', 'both'],
  ['r2-b-group', 'All assemblies in one bundle, compressed together', 'Extreme'],
  ['h03-invtz', 'Invariant time zones', 'both'],
  ['h09-nometrics', '<code>MetricsSupport=false</code>', 'both'],
  ['c-honest-dyncode', '<code>DynamicCodeSupport=false</code>', 'both'],
  ['h20-nosimd', 'Native relink without SIMD', 'both'],
  ['r2-m-props-notasks', 'Metadata pass with Mono.Cecil (attributes, consts, property metadata)', 'both'],
  ['e04-minify', 'terser on the JavaScript files', 'both'],
  ['e03-wasmopt', '<code>wasm-opt</code> on <code>dotnet.native.wasm</code>', 'both'],
  ['r2-x-combo', 'Unused native runtime functions replaced by stubs', 'both'],
  ['c-honest-bitmin-aggr', 'Bit.Minifier aggressive mode', 'both'],
].map(([id, label, where]) => {
  const r = log.get(id), base = r?.base ? log.get(r.base) : null;
  // delta field, or brotli minus the base run's brotli when the field is empty in the log
  const d = r?.delta_brotli ?? (r?.brotli_total != null && base?.brotli_total != null ? r.brotli_total - base.brotli_total : null);
  return { id, label, where, d };
}).filter(w => w.d != null && w.d < 0).sort((x, y) => x.d - y.d);
const saving = (s, name) => s && TEMPLATE != null
  ? `<strong>${name}</strong>: ${fmt(s.coldBr)} bytes brotli, ${fmt(TEMPLATE - s.coldBr)} fewer than the template (${(100 * (TEMPLATE - s.coldBr) / TEMPLATE).toFixed(1)}% smaller)`
  : `<strong>${name}</strong>: n/a`;
const row = (name, s) => `<tr><td><a href="${name}/">${name}</a></td><td>${fmt(s?.coldRaw)}</td><td>${fmt(s?.coldBr)}</td><td>${fmt(s?.coldGz)}</td><td>${s?.coldFiles ?? 'n/a'}</td></tr>`;
const served = host === 'pages'
  ? 'This demo on GitHub Pages is served with gzip (Pages does not send brotli), so the transfer here is close to the gzip column.'
  : 'This host sends the build\'s own brotli files (quality 11) when the browser accepts brotli, so the transfer here is the brotli column.';
let landing = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blazor WebAssembly minification on .NET 11</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:.3rem .5rem;text-align:right}td:first-child,th:first-child{text-align:left}</style>
</head><body>
<h1>Blazor WebAssembly minification on .NET 11</h1>
<p>${saving(SH, 'Honest')}.<br>${saving(SE, 'Extreme')}.</p>
<h2>Ways to reduce the download size</h2>
<p>Measured brotli bytes each change saved, against the build just before it (same 3-page app, .NET 11, stock runtime).
Honest uses only stock Blazor APIs; Extreme also changes code.</p>
<table><tr><th>Change</th><th>Used in</th><th>Brotli bytes saved</th></tr>
${WAYS.map(w => `<tr><td>${w.label}</td><td>${w.where === 'both' ? 'Honest and Extreme' : w.where}</td><td>${fmt(-w.d)}</td></tr>`).join('\n')}
</table>
<h2>Totals</h2>
<table><tr><th>Variant</th><th>Cold load raw bytes</th><th>brotli -q 11</th><th>gzip -9</th><th>Files</th></tr>
<tr><td>template (<code>dotnet new blazorwasm</code>)</td><td>${fmt(log.get('baseline')?.raw_total)}</td><td>${fmt(TEMPLATE)}</td><td>n/a</td><td>${log.get('baseline')?.files?.length ?? 'n/a'}</td></tr>
${row('honest', SH)}
${row('extreme', SE)}
</table>
<p>Sizes are the files a headless browser downloads on a cold load of all pages, measured by <code>measure.sh</code>
on the build made by <code>build.sh</code> (before this page and the apps' <code>&lt;base href&gt;</code>${host === 'pages' ? ' and robots meta tag' : ''} were adjusted for this site).</p>
<p>${served}</p>
<p><a href="report.html">Detailed report of every measured run</a>${repo ? ` · <a href="${repo}">Source and documentation</a>` : ''}</p>
</body></html>
`;
if (host === 'pages') landing = injectMeta('index.html (landing)', landing);
writeHtml(path.join(out, 'index.html'), landing);
// detailed report page (tools/build-report.mjs reads results/experiments.jsonl)
execFileSync('node', [path.join(root, 'tools', 'build-report.mjs'), path.join(out, 'report.html'), '--home', './', ...(repo ? ['--repo', repo] : [])], { stdio: ['ignore', 'ignore', 'inherit'] });
{
  let rep = fs.readFileSync(path.join(out, 'report.html'), 'utf8');
  if (host === 'pages') rep = injectMeta('report.html', rep);
  writeHtml(path.join(out, 'report.html'), rep);
}
// App Service: Content-Security-Policy per HTML page, with the sha256 of each inline script (no 'unsafe-inline' for
// scripts). The host reads <out>/.csp.json at startup; dot files are never served.
if (host === 'appservice') {
  const csp = {};
  const policy = html => {
    const hashes = [];
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/type\s*=\s*"application\/json"/.test(m[1])) continue; // data block, never executed
      hashes.push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
    }
    return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hashes.length ? ' ' + hashes.join(' ') : ''}; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
  };
  for (const f of ['index.html', 'report.html', 'honest/index.html', 'extreme/index.html'])
    csp['/' + f] = policy(fs.readFileSync(path.join(out, f), 'utf8'));
  fs.writeFileSync(path.join(out, '.csp.json'), JSON.stringify(csp, null, 1));
}
for (const c of metaCost) console.log(`robots meta tag cost - ${c}`);
console.log(`site assembled in ${out} with base ${base} for ${host}`);

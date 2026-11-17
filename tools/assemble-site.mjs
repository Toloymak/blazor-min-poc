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
import { levers } from './levers.mjs';

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
const WAYS = levers(log); // same rows and numbers as the lever table at the top of README.md
// Recipe finals (the published numbers, before page styles) from the log; the demo as served comes from the sizes
// json measured on this build (with the apps' page styles).
// Every number in the cards and the totals table comes from the log (like the README): recipe finals = f2-* runs,
// demo as served with page styles = f3-*-style runs. The sizes files of this build only feed one separate line.
const RECIPE = { honest: log.get('f2-honest')?.brotli_total ?? null, extreme: log.get('f2-extreme')?.brotli_total ?? null };
const STYLED = { honest: log.get('f3-honest-style') ?? null, extreme: log.get('f3-extreme-style') ?? null };
const pctSmaller = v => TEMPLATE != null && v != null ? (100 * (TEMPLATE - v) / TEMPLATE).toFixed(1) : 'n/a';
const plus = n => n == null ? 'n/a' : (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
const card = (name, blurb) => `<article class="v">
<h2>${name}</h2>
<p class="big">${fmt(RECIPE[name.toLowerCase()])}<span>bytes brotli, recipe final</span></p>
<p class="pct">${pctSmaller(RECIPE[name.toLowerCase()])}% smaller than the template</p>
<p class="m">${blurb}</p>
<p class="m">Demo as served, with page styles: ${fmt(STYLED[name.toLowerCase()]?.brotli_total)} (${plus(STYLED[name.toLowerCase()]?.brotli_total != null && RECIPE[name.toLowerCase()] != null ? STYLED[name.toLowerCase()].brotli_total - RECIPE[name.toLowerCase()] : null)} bytes)</p>
<a class="btn" href="${name.toLowerCase()}/">Open ${name}</a>
</article>`;
// bar widths as classes (no style= attributes: the host CSP allows only the hashed <style> block)
const maxSave = Math.max(...WAYS.map(w => w.saved));
const barCls = w => 'w' + Math.max(1, Math.round(100 * w.saved / maxSave));
const barCss = [...new Set(WAYS.map(barCls))].map(c => `.${c}{width:${c.slice(1)}%}`).join('');
const row = (label, raw, brv, gzv, files) => `<tr><td>${label}</td><td>${fmt(raw)}</td><td>${fmt(brv)}</td><td>${fmt(gzv)}</td><td>${files ?? 'n/a'}</td></tr>`;
const served = host === 'pages'
  ? 'This demo on GitHub Pages is served with gzip (Pages does not send brotli), so the transfer here is close to the gzip column.'
  : 'This host sends the build\'s own brotli files (quality 11) when the browser accepts brotli, so the transfer here is the brotli column.';
const fh = log.get('f2-honest'), fx = log.get('f2-extreme'), tb = log.get('baseline');
let landing = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blazor WebAssembly minification on .NET 11</title>
<style>:root{color-scheme:light dark;--p:light-dark(#f7f5f0,#17161b);--i:light-dark(#1c1b21,#ecebf1);--m:light-dark(#5e5b66,#a7a3b2);--l:light-dark(#dbd6cc,#34323c);--a:light-dark(#512bd4,#a993f5);--n:ui-monospace,monospace}
body{margin:0 auto;max-width:60rem;padding:2.5rem 1rem 5rem;background:var(--p);color:var(--i);font:1.0625rem/1.6 system-ui,sans-serif}
a{color:var(--a)}:focus-visible{outline:2px solid var(--a);outline-offset:3px}
h1{font-size:clamp(2rem,5vw,3rem);line-height:1.1;letter-spacing:-.025em;margin:0 0 1rem;max-width:20ch}
.lead{font-size:1.1875rem;color:var(--m);max-width:42rem;margin:0 0 2.5rem}
h2{font-size:1.375rem;letter-spacing:-.01em;margin:3.5rem 0 .75rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:1rem 3rem;border-top:1px solid var(--l)}
.v h2{margin:1.5rem 0 .25rem;font-size:1rem;color:var(--m);font-weight:600}
.big{font:600 clamp(2.5rem,6vw,3.5rem)/1 var(--n);font-variant-numeric:tabular-nums;letter-spacing:-.03em;margin:0}
.big span{display:block;font:400 .875rem system-ui,sans-serif;color:var(--m);letter-spacing:0;margin-top:.5rem}
.pct{font:600 1.125rem var(--n);color:var(--a);margin:.75rem 0}
.m{color:var(--m);font-size:.9375rem;margin:.25rem 0}
.btn{display:inline-block;margin-top:1rem;padding:.55rem 1.25rem;border-radius:.375rem;background:var(--a);color:var(--p);font-weight:600;text-decoration:none}
.note{color:var(--m);font-size:.9375rem;max-width:44rem}
ol{list-style:none;padding:0;margin:0;border-top:1px solid var(--l)}
li{display:grid;grid-template-columns:minmax(0,1fr) 9.5rem;gap:.25rem 1.5rem;padding:.6rem 0;border-bottom:1px solid var(--l);align-items:center}
li b{font:600 1rem var(--n);font-variant-numeric:tabular-nums;text-align:right}
li i{grid-column:1/-1;display:block;height:.375rem;background:var(--l);border-radius:1px}
li i>s{display:block;height:100%;background:var(--a)}
code{font:.9em var(--n)}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:.5rem .75rem .5rem 0;border-bottom:1px solid var(--l);text-align:right;white-space:nowrap}
th{font-weight:600;font-size:.875rem;color:var(--m)}th:first-child,td:first-child{text-align:left;white-space:normal}
td{font-family:var(--n);font-size:.9375rem}td:first-child{font-family:inherit}
footer{margin-top:4rem;padding-top:1rem;border-top:1px solid var(--l);display:flex;gap:2rem;flex-wrap:wrap}
${barCss}</style>
</head><body>
<h1>Blazor WebAssembly minification on .NET 11</h1>
<p class="lead">The same three-page Blazor WebAssembly app, built and measured in more than 160 configurations. Two final variants are kept. The template downloads ${fmt(TEMPLATE)} bytes brotli.</p>
<section class="cards">
${card('Honest', 'Stock Blazor APIs only. All savings come from build settings and post-processing.')}
${card('Extreme', 'Also changes code: its own router, HTTP through JS <code>fetch</code>, one bundle for all assemblies.')}
</section>
<h2>Ways to reduce the download size</h2>
<p class="note">Brotli bytes each change saved. Each saving was measured alone or as one step on top of earlier steps, so the savings do not add up exactly. The ${repo ? `<a href="${repo}#how-to-reduce-blazor-webassembly-download-size">README</a>` : 'README'} has the details.</p>
<ol>
${WAYS.map(w => `<li><span>${w.label}</span><b>${w.savedText}</b><i><s class="${barCls(w)}"></s></i></li>`).join('\n')}
</ol>
<h2>Totals</h2>
<p class="note">Files a headless browser downloads on a cold load of all pages, measured by <code>measure.sh</code>. "Recipe final" is the build before page styles; "demo as served" is this site's apps with their page styles (${host === 'pages' ? 'the robots meta tag and ' : ''}the per-app <code>&lt;base href&gt;</code> are added after measuring).</p>
<div class="tw"><table>
<tr><th>Build</th><th>Raw</th><th>Brotli</th><th>Gzip -9</th><th>Files</th></tr>
${row('Template (<code>dotnet new blazorwasm</code>)', tb?.raw_total, TEMPLATE, null, tb?.files?.length)}
${row('Honest, recipe final', fh?.raw_total, fh?.brotli_total, fh?.gzip_total, fh?.files?.length)}
${row('Honest, demo as served, with page styles', STYLED.honest?.raw_total, STYLED.honest?.brotli_total, STYLED.honest?.gzip_total, STYLED.honest?.files?.length)}
${row('Extreme, recipe final', fx?.raw_total, fx?.brotli_total, fx?.gzip_total, fx?.files?.length)}
${row('Extreme, demo as served, with page styles', STYLED.extreme?.raw_total, STYLED.extreme?.brotli_total, STYLED.extreme?.gzip_total, STYLED.extreme?.files?.length)}
</table></div>
${SH?.coldBr != null && SE?.coldBr != null ? `<p class="note">This build measured ${fmt(SH.coldBr)} (Honest) and ${fmt(SE.coldBr)} (Extreme) bytes brotli. Totals differ by a few hundred bytes between build machines.</p>\n` : ''}<p class="note">${served}</p>
<footer><a href="report.html">Detailed report of every measured run</a>${repo ? `<a href="${repo}">Source and documentation</a>` : ''}</footer>
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
    // styles: hashes of the <style> blocks; a page that still uses style="" attributes (the report's charts)
    // keeps 'unsafe-inline' for styles (with a hash in the list, browsers would ignore 'unsafe-inline')
    const styleHashes = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    const styleSrc = /\sstyle="/.test(html) ? "'self' 'unsafe-inline'" : `'self'${styleHashes.length ? ' ' + styleHashes.join(' ') : ''}`;
    return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hashes.length ? ' ' + hashes.join(' ') : ''}; style-src ${styleSrc}; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
  };
  for (const f of ['index.html', 'report.html', 'honest/index.html', 'extreme/index.html'])
    csp['/' + f] = policy(fs.readFileSync(path.join(out, f), 'utf8'));
  fs.writeFileSync(path.join(out, '.csp.json'), JSON.stringify(csp, null, 1));
}
for (const c of metaCost) console.log(`robots meta tag cost - ${c}`);
console.log(`site assembled in ${out} with base ${base} for ${host}`);

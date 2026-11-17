// Static server with SPA fallback to index.html. Serves raw files (no compression).
// Usage: node tools/serve.mjs <wwwrootDir> [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// true when `file` is inside `dir` (no `..` escape, no absolute jump)
const inside = (dir, file) => { const r = path.relative(dir, file); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

const root = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 5080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.dat': 'application/octet-stream',
  '.txt': 'text/plain', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.map': 'application/json', '.pdb': 'application/octet-stream',
};

// SERVE_ENCODED=br|gzip: answer with the precompressed <file>.br / <file>.gz bytes (exactly those bytes) and
// Content-Encoding when the browser accepts it. A missing precompressed file is served raw and counted in `missingEncoded`.
export const missingEncoded = new Set();
function encodedVariant(req, file) {
  const want = process.env.SERVE_ENCODED;
  if (!want) return null;
  const accept = String(req.headers['accept-encoding'] ?? '');
  const ext = want === 'br' ? '.br' : '.gz';
  if (!accept.includes(want)) return null;
  if (fs.existsSync(file + ext)) return { name: want, file: file + ext };
  missingEncoded.add(path.basename(file));
  return null;
}

export function start(dir = root, p = port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    let file = path.join(dir, rel);
    if (!inside(dir, file)) { res.writeHead(403); return res.end(); }
    let st = fs.existsSync(file) ? fs.statSync(file) : null;
    if (st?.isDirectory()) { file = path.join(file, 'index.html'); st = fs.existsSync(file) ? fs.statSync(file) : null; }
    if (!st) {
      // SPA fallback only for navigation-like paths (no extension)
      if (path.extname(rel) === '') { file = path.join(dir, 'index.html'); st = fs.statSync(file); }
      else { res.writeHead(404); return res.end('not found'); }
    }
    const enc = encodedVariant(req, file);
    if (enc) {
      const est = fs.statSync(enc.file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Content-Encoding': enc.name, 'Content-Length': est.size, 'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding' });
      return fs.createReadStream(enc.file).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(p, '127.0.0.1', () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().then(() => console.log(`serving ${root} on http://127.0.0.1:${port}`));
}

// GitHub-Pages-like server: site mounted under `prefix` (e.g. /some-repo/), directory -> index.html,
// a directory without trailing slash -> 301 to slash, no SPA fallback; unknown paths -> <site>/404.html with status 404.
export function startPages(dir, p, prefix = '/some-repo/') {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const pn = decodeURIComponent(url.pathname);
    const send = (file, code) => {
      const enc = encodedVariant(req, file);
      if (enc) {
        const est = fs.statSync(enc.file);
        res.writeHead(code, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Content-Encoding': enc.name, 'Content-Length': est.size, 'Cache-Control': 'no-store' });
        return fs.createReadStream(enc.file).pipe(res);
      }
      const st = fs.statSync(file);
      res.writeHead(code, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    };
    const notFound = () => { const f = path.join(dir, '404.html'); fs.existsSync(f) ? send(f, 404) : (res.writeHead(404), res.end('404')); };
    if (!pn.startsWith(prefix) && pn + '/' !== prefix) return notFound();
    if (pn + '/' === prefix) { res.writeHead(301, { Location: prefix }); return res.end(); }
    const file = path.join(dir, pn.slice(prefix.length));
    if (!inside(dir, file)) return notFound();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!pn.endsWith('/')) { res.writeHead(301, { Location: pn + '/' + url.search }); return res.end(); }
      const idx = path.join(file, 'index.html');
      return fs.existsSync(idx) ? send(idx, 200) : notFound();
    }
    if (fs.existsSync(file)) return send(file, 200);
    if (fs.existsSync(file + '.html')) return send(file + '.html', 200);
    return notFound();
  });
  return new Promise(r => server.listen(p, '127.0.0.1', () => r(server)));
}

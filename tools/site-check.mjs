// Site-level gate: the landing page and report.html load with zero console errors, the report's "Demo home" link goes
// back to the landing page, and the robots signal is present (Pages: <meta name="robots"> in landing, both apps and
// the report; App Service: X-Robots-Tag header, and report.html arrives brotli-encoded).
// Usage: node tools/site-check.mjs pages <site-dir> <prefix e.g. /some-repo/>
//        node tools/site-check.mjs host <origin e.g. http://127.0.0.1:6103>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startPages } from './serve.mjs';
const [mode, a, b] = process.argv.slice(2);
let origin, prefix = '/', server = null;
if (mode === 'pages') { prefix = b ?? '/some-repo/'; server = await startPages(path.resolve(a), 5096, prefix); origin = 'http://127.0.0.1:5096'; }
else origin = a;
const fails = []; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const br = await chromium.launch(); const p = await (await br.newContext()).newPage(); const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(e.message));
const r1 = await p.goto(origin + prefix); ok(r1.status() === 200, `landing 200`);
ok(await p.locator('a[href="report.html"]').count() === 1, 'landing links to report.html');
const r2 = await p.goto(origin + prefix + 'report.html'); ok(r2.status() === 200, 'report.html 200');
await p.waitForLoadState('load');
const bars = await p.locator('.lchart .lrow').count(), segs = await p.locator('.stack .seg').count();
ok(bars > 0 && segs > 0, `report charts render (${bars} lever bars, ${segs} stacked segments)`);
ok((await p.locator('h2').first().textContent()).startsWith('Ways to reduce'), `report starts with the ways to reduce the size`);
if (mode === 'host') {
  const h = r2.headers();
  ok(h['content-encoding'] === 'br', `report.html served brotli (${h['content-encoding']})`);
  ok(h['x-robots-tag'] === 'noindex, nofollow', 'report.html has X-Robots-Tag');
  ok((r1.headers()['x-robots-tag'] ?? '') === 'noindex, nofollow', 'landing has X-Robots-Tag');
}
await p.getByText('Demo home').first().click();
await p.waitForLoadState('load');
ok(new URL(p.url()).pathname === prefix || new URL(p.url()).pathname === prefix + 'index.html', `"Demo home" goes to the landing page (${new URL(p.url()).pathname})`);
if (mode === 'pages') {
  for (const f of ['index.html', 'report.html', 'honest/index.html', 'extreme/index.html'])
    ok(fs.readFileSync(path.join(a, f), 'utf8').includes('<meta name="robots" content="noindex, nofollow">'), `robots meta tag in ${f}`);
}
ok(errs.length === 0, `zero console errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
await br.close(); server?.close();
console.log(fails.length ? 'SITECHECK FAILED' : 'SITECHECK PASSED'); process.exit(fails.length ? 1 : 0);

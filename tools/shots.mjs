// Screenshots of the demo site (PNG): landing, apps and report, light and dark, desktop and phone width.
// Usage: node tools/shots.mjs <site-dir> <out-dir> [prefix=/some-repo/]   (Pages-like server)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startPages } from './serve.mjs';
const [dir, outDir, prefix = '/some-repo/'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const server = await startPages(path.resolve(dir), 5097, prefix);
const base = `http://127.0.0.1:5097${prefix}`;
const b = await chromium.launch();
const shots = [
  ['landing', '', null],
  ['extreme-home', 'extreme/', 'h1'],
  ['extreme-counter', 'extreme/counter', 'counter'],
  ['extreme-fetch', 'extreme/fetch', 'li'],
  ['honest-counter', 'honest/counter', 'counter'],
  ['report-top', 'report.html', null],
];
const jobs = [];
for (const [name, url, wait] of shots) for (const theme of ['light', 'dark']) jobs.push([name, url, wait, theme, 1280]);
jobs.push(['landing', '', null, 'light', 390], ['extreme-counter', 'extreme/counter', 'counter', 'light', 390]);
const errs = [];
for (const [name, url, wait, theme, width] of jobs) {
  const ctx = await b.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: theme, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(`${name}: ${m.text()}`); });
  await p.goto(base + url);
  if (wait === 'counter') { const btn = p.getByRole('button', { name: 'Click me' }); await btn.waitFor({ timeout: 30000 }); for (let i = 0; i < 3; i++) await btn.click(); }
  else if (wait) await p.locator(wait).first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(300);
  const f = path.join(outDir, `${name}-${theme}-${width}.png`);
  await p.screenshot({ path: f, fullPage: name !== 'report-top' });
  console.log('shot', f);
  await ctx.close();
}
await b.close(); server.close();
console.log(errs.length ? 'SHOTS console errors: ' + errs.join(' | ') : 'SHOTS done, zero console errors');

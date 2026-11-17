// Functional check + cold-load network log for a Blazor WASM publish.
// Usage: node tools/check.mjs <wwwrootDir> [netlog.json]
// Env: FETCH_PATH (default "fetch"), DATA_FILE (default "data.json"), DATA_TEXT (default "Hello from data.json"), PORT
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { start, startPages, missingEncoded } from './serve.mjs';

const dir = path.resolve(process.argv[2]);
const out = process.argv[3];
const FETCH_PATH = process.env.FETCH_PATH ?? 'fetch';
const DATA_FILE = process.env.DATA_FILE ?? 'data.json';
const DATA_TEXT = process.env.DATA_TEXT ?? 'Hello from data.json';
const port = Number(process.env.PORT ?? 5080);
const BASE_PATH = process.env.BASE_PATH ?? '/'; // e.g. /some-repo/extreme/
// CHECK_ORIGIN: test an already running server (e.g. the App Service host) instead of starting one
const origin = process.env.CHECK_ORIGIN ?? `http://127.0.0.1:${port}`;
const root = origin + BASE_PATH;
const SITE_DIR = process.env.SITE_DIR; // serve this dir in Pages-like mode instead of SPA mode

const server = process.env.CHECK_ORIGIN ? null : SITE_DIR ? await startPages(path.resolve(SITE_DIR), port, process.env.SITE_PREFIX) : await start(dir, port);
const browser = await chromium.launch();
const failures = [];
const errors = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };

function watch(page, log) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  // zero requests to other origins (no CDN, font or library)
  page.on('request', r => { const u = r.url(); if (!u.startsWith('data:') && new URL(u).origin !== origin) errors.push(`cross-origin request: ${u}`); });
  page.on('response', async r => {
    const u = new URL(r.url());
    if (u.origin !== origin) return;
    let size = 0, transfer = null;
    try { size = (await r.body()).length; } catch {}
    try { transfer = (await r.request().sizes()).responseBodySize; } catch {}
    log.push({ path: u.pathname, status: r.status(), type: r.request().resourceType(), size, transfer, enc: r.headers()['content-encoding'] ?? null });
  });
}

let coldLog = null, log = [];
try {
  // Phase 1: cold load of / then visit every page by client-side navigation.
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  watch(page, log);
  const t0 = Date.now();
  await page.goto(root, { waitUntil: 'load' });
  await page.locator('h1', { hasText: 'Hello, world!' }).waitFor({ timeout: 30000 });
  ok(true, `Home renders (${Date.now() - t0} ms)`);
  if (process.env.LOAD_ONLY) { coldLog = [...log]; throw new Error('LOAD_ONLY'); }
  await page.evaluate(() => { window.__noReload = 42; });

  await page.locator('a[href="counter"]').first().click();
  await page.waitForURL(root + 'counter');
  const status = page.locator('[role=status]');
  await status.waitFor({ timeout: 10000 });
  ok(await page.evaluate(() => window.__noReload === 42), 'nav to Counter without full reload');
  ok((await status.textContent()).includes('Current count: 0'), 'Counter starts at 0');
  await page.getByRole('button', { name: 'Click me' }).click();
  await page.getByRole('button', { name: 'Click me' }).click();
  await page.locator('[role=status]', { hasText: 'Current count: 2' }).waitFor({ timeout: 5000 }).catch(() => {});
  ok((await status.textContent()).includes('Current count: 2'), 'click increments counter (0 -> 2)');

  await page.locator(`a[href="${FETCH_PATH}"]`).first().click();
  await page.waitForURL(root + FETCH_PATH);
  await page.getByText(DATA_TEXT).first().waitFor({ timeout: 10000 }).catch(() => {});
  ok(await page.getByText(DATA_TEXT).first().isVisible().catch(() => false), `Fetch page shows "${DATA_TEXT}"`);
  ok(log.some(e => e.path.endsWith('/' + DATA_FILE) && e.status === 200), `network log has ${DATA_FILE} request`);
  ok(await page.evaluate(() => window.__noReload === 42), 'nav to Fetch without full reload');

  await page.goBack();
  await page.waitForURL(root + 'counter');
  await page.locator('[role=status]').waitFor({ timeout: 5000 }).catch(() => {});
  ok(await page.locator('[role=status]').isVisible().catch(() => false), 'back button returns to Counter');
  ok(await page.evaluate(() => window.__noReload === 42), 'back without full reload');
  await page.goForward();
  await page.waitForURL(root + FETCH_PATH);
  ok(true, 'forward button works');
  coldLog = [...log];

  // Phase 2: direct URL load of /counter in a fresh context.
  const ctx2 = await browser.newContext({ serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  watch(p2, []);
  const r = await p2.goto(root + 'counter');
  await p2.locator('[role=status]').waitFor({ timeout: 30000 }).catch(() => {});
  ok(r.status() === 200 || (SITE_DIR && p2.url() === root + 'counter'), `direct load /counter returns 200 (or Pages 404.html redirect back to it): ${r.status()} ${p2.url()}`);
  ok(await p2.locator('[role=status]').isVisible().catch(() => false), 'direct load /counter renders Counter');
  await p2.getByRole('button', { name: 'Click me' }).click();
  await p2.locator('[role=status]', { hasText: 'Current count: 1' }).waitFor({ timeout: 5000 }).catch(() => {});
  ok((await p2.locator('[role=status]').textContent()).includes('Current count: 1'), 'counter works after direct load');

  await page.waitForTimeout(300);
  if (process.env.SERVE_ENCODED && !process.env.CHECK_ORIGIN) ok(missingEncoded.size === 0, `every downloaded file was served as ${process.env.SERVE_ENCODED}${missingEncoded.size ? ': missing ' + [...missingEncoded].join(',') : ''}`);
  ok(errors.length === 0, `zero console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

} catch (e) {
  if (e.message === 'LOAD_ONLY' && errors.length === 0) { console.log('LOAD-ONLY PASSED'); if (out) fs.writeFileSync(out, JSON.stringify(coldLog, null, 1)); await browser.close(); server.close(); process.exit(0); }
  failures.push('exception: ' + e.message);
  console.log('FAIL exception: ' + e.message);
} finally {
  if (errors.length) console.log('ERRORS: ' + errors.join(' | '));
  if (out) fs.writeFileSync(out, JSON.stringify(coldLog ?? log, null, 1));
  await browser.close();
  server?.close();
}
console.log(failures.length ? `CHECK FAILED (${failures.length})` : 'CHECK PASSED');
process.exit(failures.length ? 1 : 0);

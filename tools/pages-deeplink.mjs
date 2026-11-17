// Extra Pages gate: unknown deep links go through the root 404.html and come back to the right app.
// Usage: node tools/pages-deeplink.mjs <site-dir> [prefix=/some-repo/]
import { chromium } from 'playwright';
import path from 'node:path';
import { startPages } from './serve.mjs';
const dir = path.resolve(process.argv[2]); const prefix = process.argv[3] ?? '/some-repo/';
const server = await startPages(dir, 5095, prefix);
const b = await chromium.launch(); let fails = 0;
for (const [url, expectPath, text] of [
  ['extreme/no-such-page?q=1', 'extreme/no-such-page?q=1', 'Not found.'],
  ['honest/no-such-page', 'honest/no-such-page', 'Not found.'],
  ['extreme/counter/', 'extreme/counter/', 'Current count: 0'],
]) {
  const p = await (await b.newContext()).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:5095${prefix}${url}`);
  await p.getByText(text).first().waitFor({ timeout: 20000 }).catch(() => {});
  const ok = await p.getByText(text).first().isVisible().catch(() => false);
  const final = new URL(p.url()); const want = prefix + expectPath;
  const urlOk = final.pathname + final.search === want;
  console.log(`${ok && urlOk ? 'PASS' : 'FAIL'} ${url} -> ${final.pathname + final.search} shows "${text}": ${ok}${errs.length ? ' errors: ' + errs.join('|') : ''}`);
  if (!(ok && urlOk)) fails++;
}
await b.close(); server.close();
console.log(fails ? 'DEEPLINK FAILED' : 'DEEPLINK PASSED'); process.exit(fails ? 1 : 0);

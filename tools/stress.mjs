// Run the stress page of ExtremeStress: every action must succeed, and no error may reach the console
// except the one expected 404 for the failed-request test. A wasm trap ("RuntimeError: unreachable") fails it.
// Usage: node tools/stress.mjs <wwwroot>
import { chromium } from 'playwright';
import path from 'node:path';
import { start } from './serve.mjs';
const dir = path.resolve(process.argv[2]); const port = Number(process.env.PORT ?? 5080) + 500;
const server = await start(dir, port);
const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
p.on('console', m => { if (m.type() === 'error' && !/404|no-such-file/.test(m.text())) errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto(`http://127.0.0.1:${port}/stress`);
await p.getByRole('button', { name: 'Run' }).click({ timeout: 30000 }).catch(e => errs.push('no button: ' + e.message));
await p.locator('#result', { hasText: 'STRESS OK' }).waitFor({ timeout: 30000 }).catch(() => {});
const text = (await p.locator('#result').textContent().catch(() => '')) ?? '';
await b.close(); server.close();
const okCount = Number((text.match(/STRESS OK (\d+)/) ?? [])[1] ?? 0);
const good = okCount === 15 && !text.includes('!!') && errs.length === 0;
console.log(`${good ? 'STRESS PASSED' : 'STRESS FAILED'} ok=${okCount}/15 ${text.slice(0, 400)}${errs.length ? ' ERRORS: ' + errs.join(' | ').slice(0, 500) : ''}`);
process.exit(good ? 0 : 1);

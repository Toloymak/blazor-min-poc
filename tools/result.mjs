// Build the per-run facts object from env + out/<label>.run/ files. Paths/user names are scrubbed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const run = process.argv[2];
const e = process.env;
const scrub = s => s == null ? s : String(s).split(os.homedir()).join('~').split(os.userInfo().username).join('<user>');
let sizes = null; try { sizes = JSON.parse(fs.readFileSync(path.join(run, 'sizes.json'), 'utf8')); } catch {}
let checkError = null;
try { const c = fs.readFileSync(path.join(run, 'check.log'), 'utf8'); const m = c.split('\n').filter(l => /^(FAIL|ERRORS)/.test(l)); if (m.length) checkError = scrub(m.join(' | ').slice(0, 400)); } catch {}
const grp = r => /dotnet\.native.*\.wasm$/.test(r) ? "native" : /\/b\.bin$/.test(r) ? "managed" : /_framework\/.*\.js$/.test(r) ? 'js' : /\.(wasm|dll)$/.test(r) ? 'managed' : 'other';
const res = {
  id: e.STEP_LABEL, time: new Date().toISOString(), project: e.STEP_PROJECT, props: e.STEP_PROPS, post: e.STEP_POST || null,
  raw_total: sizes?.coldRaw ?? null,
  // served from .br: the metric is the transferred body bytes from the network log
  brotli_total: (e.SERVE_ENCODED === 'br' && sizes?.served?.transferTotal) ? sizes.served.transferTotal : (sizes?.coldBr ?? null),
  gzip_total: sizes?.coldGz ?? null, served: sizes?.served ?? null, dir_raw_total: sizes?.dirRaw ?? null,
  files: sizes ? sizes.files.map(f => ({ name: f.rel.replace(/^\//, ''), group: grp(f.rel), raw: f.raw, brotli: f.br })) : null,
  native_wasm_sha256: e.STEP_NATIVE_SHA || null, native_wasm_sha256_before_postprocess: e.STEP_NATIVE_SHA_PREPOST || null,
  relinked: e.STEP_RELINKED === '' ? null : e.STEP_RELINKED === 'true',
  check: e.STEP_CHECK, check_error: checkError, build: e.STEP_BUILD, build_error: scrub(e.STEP_BUILD_ERROR) || null,
  duration_s: Number(e.STEP_DURATION),
};
for (const r of [run]) fs.writeFileSync(path.join(r, 'result.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));

# Blazor WebAssembly minification on .NET 11 — results

What each change saves in the download of the same 3-page Blazor WebAssembly app (Home, Counter, Fetch), measured in brotli bytes.
Two final variants are kept: **Honest** uses only stock Blazor APIs (all savings come from build settings and post-processing),
**Extreme** also changes code. All final numbers come from the Linux build machine (Ubuntu 22.04 / WSL2), except rows marked `host=mac`.

## Ways to reduce the download size, and what each saves

Brotli bytes saved by each change, measured against the run just before it (run ids are in `results/experiments.jsonl`):

| change | used in | brotli bytes saved | run |
|---|---|---:|---|
| Invariant globalization (no ICU data; the relink leaves ICU out of the native file) | Honest, Extreme | 661,194 | `h02-invglob` |
| Own router and JS `fetch` instead of `Router` and `HttpClient` | Extreme | 137,828 | `e00-extreme` |
| `EventSourceSupport=false` | Honest, Extreme | 96,951 | `h05-noeventsource` |
| Bit.Minifier on the trimmed assemblies (+17,176 more in aggressive mode) | Honest, Extreme | 78,547 | `c-honest-bitmin` |
| All assemblies in one bundle, compressed together | Extreme | 75,030 | `r2-b-group` |
| Invariant time zones | Honest, Extreme | 63,341 | `h03-invtz` |
| `MetricsSupport=false` | Honest, Extreme | 52,095 | `h09-nometrics` |
| `DynamicCodeSupport=false` | Honest, Extreme | 30,502 | `c-honest-dyncode` |
| Native relink without SIMD | Honest, Extreme | 28,098 | `h20-nosimd` |
| terser on the JavaScript files | Honest, Extreme | 21,916 | `e04-minify` |
| Metadata pass with Mono.Cecil (attributes, consts, property metadata) | Honest, Extreme | 20,134 | `r2-m-props-notasks` |
| `wasm-opt` on `dotnet.native.wasm` | Honest, Extreme | 18,608 | `e03-wasmopt` |
| Unused native runtime functions replaced by stubs (about 9.4k more for the AOT lookup functions) | Honest, Extreme | 14,597 | `r2-x-combo` |

Every other change that was tried, including the ones that did nothing or broke the app, is in the tables below.

## Totals against the template

Metric: sum over the files a headless Chromium downloads on a cold load of `/` plus client-side visits to
Counter and Fetch (taken from the browser network log, not a directory listing). Brotli = quality 11, window 24
(node zlib, gives the same bytes as `brotli -q 11`; checked on the Mac against the CLI). gzip = level 9.

| variant | cold-load raw | brotli | gzip -9 | files | brotli saved vs template | check |
|---|---:|---:|---:|---:|---:|---|
| template baseline (`dotnet new blazorwasm`, relink by default) | 8,447,649 | 2,589,350 | — | 50 | — | pass |
| template baseline, no workload (Mac) | 8,494,253 | 2,627,714 | 3,252,043 | 50 | — | pass |
| issue #86601 recipe on .NET 11 (empty template, invariant globalization) | 5,404,848 | 1,735,678 | 2,091,866 | 43 | 853,672 | load-only pass |
| Honest round 1 final | 4,616,080 | 1,519,331 | 1,823,357 | 43 | 1,070,019 | pass |
| Extreme round 1 final | 4,013,671 | 1,333,578 | 1,599,659 | 39 | 1,255,772 | pass |
| **Honest final, round 2** (`./build.sh honest`, served from `.br`) | **4,243,612** | **1,424,673** | 1,706,941 | 43 | **1,164,677 (45.0%)** | pass |
| **Extreme final, round 2** (`./build.sh extreme`, served from `.br`) | **3,851,361** | **1,211,018** | 1,507,342 | 8 | **1,378,332 (53.2%)** | pass |

Round 2 details are at the end of this file.

Machine-readable log of every run: `results/experiments.jsonl` (one line per run, append-only),
raw trace files per run (file list with sizes, check log, build-log slice, network log) were kept locally in `results/runs/<id>/` and are not published.

## Build machine tooling

The system `dotnet` on the Linux build machine (`/usr/bin/dotnet` → `/usr/lib/dotnet`) is the Ubuntu package with SDKs
8.0.134, 10.0.111, 11.0.100. I used a user-local copy of Microsoft's SDK so the toolchain is the stock one
and under my control. (`dotnet workload install wasm-tools` on the system dotnet also worked, but it is not used.)
Commands run on the Linux build machine, in order:

```bash
curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
bash /tmp/dotnet-install.sh --version 11.0.100 --install-dir "$HOME/.dotnet-wasm" --no-path
DOTNET_ROOT=$HOME/.dotnet-wasm PATH=$HOME/.dotnet-wasm:$PATH dotnet workload install wasm-tools
mkdir -p ~/.local/binaryen && curl -sSL https://github.com/WebAssembly/binaryen/releases/download/version_125/binaryen-version_125-x86_64-linux.tar.gz | tar -xz -C ~/.local/binaryen --strip-components=1
cd tools && npm ci && npx playwright install chromium-headless-shell      # playwright 1.65.1, terser 5.51.2; node v24.21.0 was already in ~/.local/node
cd /tmp && apt-get download libatomic1 && dpkg -x libatomic1_*.deb ~/.local/libatomic   # no sudo; clean way: sudo apt-get install -y libatomic1
# experiment only (closure compiler, did not work, see below):
(cd ~/.dotnet-wasm/packs/Microsoft.NET.Runtime.Emscripten.6.0.2.Sdk.linux-x64/11.0.0/tools/emscripten && npm install google-closure-compiler)
# actionlint 1.7.12 into ~/.local/bin (tools/final.sh)
```

Env lines (also in `scripts/build-env.sh`, sourced by `tools/step.sh` and `build.sh`):

```bash
export DOTNET_ROOT=$HOME/.dotnet-wasm
export PATH=$HOME/.dotnet-wasm:$HOME/.local/binaryen/bin:$HOME/.local/node/bin:$PATH
export LD_LIBRARY_PATH=$HOME/.local/libatomic/usr/lib/x86_64-linux-gnu   # only for the no-sudo libatomic
```

Why libatomic: emscripten's bundled node (`Microsoft.NET.Runtime.Emscripten.6.0.2.Node.linux-x64`) failed with
`error while loading shared libraries: libatomic.so.1`, so every relink failed (`emcc ... compiler.mjs --symbols-only failed (returned 127)`).

On the Mac, `dotnet workload install wasm-tools` failed with: `Inadequate permissions. Run the command with elevated privileges.`
Only the `baseline-mac` row was measured on the Mac.

## Scripts

- `measure.sh <publish-dir> [label] [netlog]` — runs the check, then `tools/measure.mjs` (raw / brotli / gzip, per-file, per-group).
- `tools/check.mjs <wwwroot> [netlog.json]` — functional check (Playwright): Home renders; nav link to Counter without a full
  reload; two clicks → `Current count: 2`; nav to Fetch shows text from `data.json`, and `data.json` is in the network log;
  back and forward; direct load of `/counter` in a fresh context works and counts; zero console errors / page errors / failed requests.
  `SITE_DIR`/`SITE_PREFIX`/`BASE_PATH` run it against the Pages-like server.
- `tools/serve.mjs` — static server with SPA fallback and `application/wasm`; `startPages()` behaves like GitHub Pages.
- `tools/step.sh` — one measured run (clean, publish, optional post-process, check, measure, `out/<id>.result.json`).
- `tools/matrix.sh <steps> [N]` — N runs in parallel, each in its own copy under `~/work/blazor-min/run-<id>/`, own port.
- `tools/collect.mjs` — appends runs to `results/experiments.jsonl` and copies trace files (paths scrubbed).
- `tools/postprocess.mjs` — Extreme post-processing: wasm-opt, terser, integrity hash rewrite in the boot config (inside `dotnet.js`).
- `build.sh honest|extreme` — the single final recipe, used by build machine and CI.
- `tools/AsmSize`, `tools/why.py` — analysis: IL bytes per namespace/type; why ILLink kept a type (from `_TrimmerDumpDependencies`).
- `tools/pull.sh` — copies files from build machine back to the Mac (tar+base64 through the job log; the build machine driver has no pull command).

## Final per-file breakdown (cold load)

### Honest final (`f-honest`)

| group | file | raw | brotli |
|---|---|---:|---:|
| native | dotnet.native.8rql3syuii.wasm | 1,194,651 | 402,831 |
| js | dotnet.runtime.uyfhwbfd13.js | 197,545 | 47,485 |
| js | dotnet.native.dwghn6ef1t.js | 191,037 | 39,741 |
| js | blazor.webassembly.js | 86,069 | 23,059 |
| js | dotnet.js | 48,508 | 13,194 |
| managed | System.Private.CoreLib.k2nghw1umi.dll | 1,483,776 | 458,997 |
| managed | System.Text.Json.kgt01q0izs.dll | 351,232 | 123,623 |
| managed | Microsoft.AspNetCore.Components.niy980s385.dll | 216,576 | 81,016 |
| managed | System.Net.Http.o57lq7cmuu.dll | 121,344 | 46,588 |
| managed | Microsoft.AspNetCore.Components.WebAssembly.02td3eil5j.dll | 116,224 | 41,797 |
| managed | System.Private.Uri.ldsjrjq0bu.dll | 60,416 | 24,486 |
| managed | Microsoft.AspNetCore.Components.Web.9bh1bh85no.dll | 56,320 | 20,148 |
| managed | Microsoft.Extensions.DependencyInjection.upse3job7s.dll | 39,936 | 17,423 |
| managed | System.Collections.Immutable.ldaqywj3nr.dll | 44,544 | 17,025 |
| managed | Microsoft.JSInterop.vi9r7xtoqf.dll | 38,912 | 16,067 |
| managed | System.Runtime.InteropServices.JavaScript.lxign7ug1q.dll | 41,472 | 15,779 |
| managed | System.Linq.ob64z4yock.dll | 24,576 | 10,490 |
| managed | Microsoft.Extensions.Logging.Abstractions.pbrvjjfyx7.dll | 24,576 | 9,791 |
| managed | System.Text.Encodings.Web.7jxkx3ta7m.dll | 27,648 | 8,640 |
| managed | Microsoft.Extensions.DependencyInjection.Abstractions.vb33vkelbf.dll | 22,016 | 8,431 |
| managed | System.Collections.ok3nolyres.dll | 20,480 | 8,024 |
| managed | System.Security.Cryptography.163gm14pam.dll | 19,968 | 7,876 |
| managed | Honest.ckhc4lyz5h.dll | 17,920 | 7,791 |
| managed | Microsoft.Extensions.Logging.h78t1eemql.dll | 14,848 | 6,766 |
| managed | Microsoft.Extensions.Options.v3dj0uue4b.dll | 14,848 | 6,340 |
| managed | System.Net.Http.Json.aa27hzsdk8.dll | 14,848 | 6,270 |
| managed | System.Text.RegularExpressions.boxy783pkg.dll | 13,824 | 6,164 |
| managed | System.Console.74014c5gwj.dll | 13,312 | 5,504 |
| managed | System.Memory.jj3u0rxyj9.dll | 12,288 | 5,297 |
| managed | Microsoft.Extensions.Configuration.EnvironmentVariables.9wnmu7vw3m.dll | 11,264 | 4,366 |
| managed | Microsoft.JSInterop.WebAssembly.buroq86r6p.dll | 10,240 | 4,134 |
| managed | Microsoft.Extensions.Primitives.izqy4a1q7r.dll | 9,216 | 3,722 |
| managed | Microsoft.Extensions.Configuration.Json.2aea8hk2in.dll | 8,704 | 3,558 |
| managed | Microsoft.Extensions.Configuration.4zfvmea80t.dll | 7,680 | 3,117 |
| managed | System.Net.Primitives.z8d2l0cgf0.dll | 7,168 | 2,583 |
| managed | System.Diagnostics.DiagnosticSource.5yaafke1tt.dll | 6,656 | 2,398 |
| managed | System.IO.Pipelines.dsx9dd5jbp.dll | 5,120 | 2,004 |
| managed | Microsoft.Extensions.Configuration.Abstractions.nm8g679zha.dll | 5,632 | 1,900 |
| managed | System.Collections.Concurrent.xzq7ithzej.dll | 5,120 | 1,741 |
| managed | Microsoft.Extensions.Hosting.Abstractions.zazhlv11gr.dll | 4,608 | 1,551 |
| managed | System.ComponentModel.aq52w6sc9s.dll | 4,608 | 1,429 |
| other | index.html | 282 | 117 |
| other | data.json | 68 | 68 |

| group | files | raw | brotli | share of brotli |
|---|---:|---:|---:|---:|
| native | 1 | 1,194,651 | 402,831 | 26.5% |
| js | 4 | 523,159 | 123,479 | 8.1% |
| managed | 36 | 2,897,920 | 992,836 | 65.3% |
| other | 2 | 350 | 185 | 0.0% |
| **total** | 43 | 4,616,080 | 1,519,331 | |

### Extreme final (`f-extreme`)

The boot manifest is not a separate file in .NET 11: it is embedded in `dotnet.js`.

| group | file | raw | brotli |
|---|---|---:|---:|
| native | dotnet.native.vxluvzqb7z.wasm | 1,125,784 | 384,310 |
| js | dotnet.runtime.uyfhwbfd13.js | 196,675 | 47,268 |
| js | blazor.webassembly.js | 85,963 | 22,987 |
| js | dotnet.native.dwghn6ef1t.js | 60,188 | 17,732 |
| js | dotnet.js | 44,546 | 12,805 |
| managed | System.Private.CoreLib.dpr8dxlrb6.dll | 1,358,336 | 420,038 |
| managed | System.Text.Json.xd7i5wuinv.dll | 346,624 | 122,078 |
| managed | Microsoft.AspNetCore.Components.y4bilfl9zu.dll | 151,552 | 56,443 |
| managed | Microsoft.AspNetCore.Components.WebAssembly.eg40dv99d8.dll | 113,152 | 40,969 |
| managed | System.Private.Uri.7dagu66xcj.dll | 55,296 | 22,285 |
| managed | Microsoft.AspNetCore.Components.Web.81n7lkq292.dll | 52,736 | 18,351 |
| managed | Microsoft.Extensions.DependencyInjection.07ebelm2ex.dll | 39,424 | 17,357 |
| managed | System.Collections.Immutable.o8vfnbm6w0.dll | 44,544 | 17,064 |
| managed | Microsoft.JSInterop.yo8orcc5a5.dll | 38,912 | 16,000 |
| managed | System.Runtime.InteropServices.JavaScript.y46e6vquur.dll | 35,328 | 13,889 |
| managed | Microsoft.Extensions.Logging.Abstractions.2xo05iq1lo.dll | 24,576 | 10,026 |
| managed | System.Linq.jif9eqv8lx.dll | 19,968 | 8,565 |
| managed | Microsoft.Extensions.DependencyInjection.Abstractions.9wrnpu4ocl.dll | 21,504 | 8,431 |
| managed | System.Text.Encodings.Web.5q9afiikwp.dll | 26,112 | 8,269 |
| managed | System.Collections.r9xaa2ppl5.dll | 20,480 | 8,017 |
| managed | System.Security.Cryptography.5c3nqui20n.dll | 19,968 | 7,972 |
| managed | Microsoft.Extensions.Logging.n9tx56zatu.dll | 14,848 | 6,716 |
| managed | Microsoft.Extensions.Options.ohnbeqluag.dll | 14,336 | 6,266 |
| managed | System.Text.RegularExpressions.if5ptq72t9.dll | 12,800 | 5,758 |
| managed | System.Memory.lhfwguehrp.dll | 12,288 | 5,306 |
| managed | Microsoft.JSInterop.WebAssembly.qyr29tddnm.dll | 10,240 | 4,095 |
| managed | Extreme.80as9q7ru1.dll | 9,216 | 3,957 |
| managed | Microsoft.Extensions.Primitives.pdi09exouw.dll | 7,680 | 2,787 |
| managed | Microsoft.Extensions.Configuration.v0ft8kb7pk.dll | 6,656 | 2,603 |
| managed | System.Diagnostics.DiagnosticSource.mtfp2ogjwu.dll | 6,656 | 2,423 |
| managed | Microsoft.Extensions.Configuration.Json.5n4c7ovebo.dll | 5,632 | 2,015 |
| managed | System.IO.Pipelines.61zsrla4cq.dll | 5,120 | 2,001 |
| managed | Microsoft.Extensions.Configuration.EnvironmentVariables.iqs82hz8xv.dll | 6,144 | 1,960 |
| managed | Microsoft.Extensions.Configuration.Abstractions.wi4m2zvcjk.dll | 5,632 | 1,850 |
| managed | System.Collections.Concurrent.yy9dekodl8.dll | 5,120 | 1,743 |
| managed | Microsoft.Extensions.Hosting.Abstractions.aqmpai5k0k.dll | 4,608 | 1,589 |
| managed | System.ComponentModel.aq52w6sc9s.dll | 4,608 | 1,429 |
| other | index.html | 351 | 156 |
| other | data.json | 68 | 68 |

| group | files | raw | brotli | share of brotli |
|---|---:|---:|---:|---:|
| native | 1 | 1,125,784 | 384,310 | 28.8% |
| js | 4 | 387,372 | 100,792 | 7.6% |
| managed | 32 | 2,500,096 | 848,252 | 63.6% |
| other | 2 | 419 | 224 | 0.0% |
| **total** | 39 | 4,013,671 | 1,333,578 | |

## All runs

Δ is against the `base` column of `results/experiments.jsonl` (shown in the change text for chains). `—` = not measured (build failed or field not captured).

### Baselines

| id | change | raw | brotli | Δ brotli vs base | check | decision | reason | host |
|---|---|---:|---:|---:|---|---|---|---|
| baseline-mac | dotnet new blazorwasm, Release publish, Mac, no wasm-tools workload (prebuilt native) | 8,494,253 | 2,627,714 | — | pass | experiment-only | reference: Mac without workload | mac |
| baseline | dotnet new blazorwasm, Release publish on the Linux build machine with wasm-tools (default relink) | 8,447,649 | 2,589,350 | — | pass | experiment-only | baseline row | build machine |
| baseline-norelink | WasmBuildNative=false | 8,487,593 | 2,625,727 | +36,377 | pass | experiment-only | workload A/B (a) | build machine |
| i86601-recipe | blazorwasm --empty, HttpClient registration removed, InvariantGlobalization=true, BlazorEnableTimeZoneSupport=false, BlazorWebAssemblyPreserveCollationData=false (ignored by .NET 11); load-only check (template has one page) | 5,404,848 | 1,735,678 | -853,672 | pass | experiment-only | reference: the minimal recipe from dotnet/runtime #86601 | build machine |
| h00-default | Honest app (3 pages, Router, NavLink, HttpClient + STJ source-gen), no size settings | 8,205,260 | 2,563,523 | -25,827 | pass | experiment-only | Honest start point | build machine |
| w-h00-default-repeat | same as h00-default, in a parallel wave, other checkout path | 8,205,260 | 2,563,520 | -3 | pass | experiment-only | determinism check: native identical, managed differs by a few bytes (path in PDB data); fixed later with PathMap | build machine |

### Honest: serial cumulative chain (each row adds one lever on top of the row above)

| id | change | raw | brotli | Δ brotli vs base | check | decision | reason | host |
|---|---|---:|---:|---:|---|---|---|---|
| h01-trimfull | TrimMode=full (+TrimmerRootAssembly for the app assembly) (cumulative serial chain; from h11 on the check fails because of h11) | 8,198,591 | 2,561,815 | -1,708 | pass | kept | -1.7k with app root | build machine |
| h02-invglob | InvariantGlobalization=true (cumulative serial chain; from h11 on the check fails because of h11) | 6,051,972 | 1,900,621 | -661,194 | pass | kept | -661k: no ICU data, ICU linked out of native | build machine |
| h03-invtz | InvariantTimezone=true; BlazorEnableTimeZoneSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,682,793 | 1,837,280 | -63,341 | pass | kept | -63k | build machine |
| h04-nodebugger | DebuggerSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,682,793 | 1,837,280 | +0 | pass | reverted | no change (already default in Release) | build machine |
| h05-noeventsource | EventSourceSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,358,446 | 1,740,329 | -96,951 | pass | kept | -97k | build machine |
| h06-sysreskeys | UseSystemResourceKeys=true (cumulative serial chain; from h11 on the check fails because of h11) | 5,358,446 | 1,740,329 | +0 | pass | reverted | no change (already default) | build machine |
| h07-nohttpactivity | HttpActivityPropagationSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,338,479 | 1,732,262 | -8,067 | pass | kept | -8k | build machine |
| h08-nometadataupd | MetadataUpdaterSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,338,479 | 1,732,262 | +0 | pass | reverted | no change | build machine |
| h09-nometrics | MetricsSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,203,826 | 1,680,167 | -52,095 | pass | kept | -52k | build machine |
| h10-nostacktrace | StackTraceSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,203,374 | 1,679,591 | -576 | pass | kept | -0.6k | build machine |
| h11-jsonnoreflect | JsonSerializerIsReflectionEnabledByDefault=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,140,291 | 1,659,023 | -20,568 | fail | reverted | breaks JSInterop: NoMetadataForType in DotNetDispatcher.ParseArguments | build machine |
| h12-nonullability | NullabilityInfoContextSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,140,362 | 1,659,040 | +17 | fail | reverted | +17 bytes (no gain) | build machine |
| h13-aggrattr | _AggressiveAttributeTrimming=true (cumulative serial chain; from h11 on the check fails because of h11) | 5,140,414 | 1,659,056 | +16 | fail | reverted | +16 bytes (no gain) | build machine |
| h14-sizelinq | UseSizeOptimizedLinq=true (cumulative serial chain; from h11 on the check fails because of h11) | 5,140,414 | 1,659,056 | +0 | fail | reverted | no change | build machine |
| h15-nohttp3 | Http3Support=false; UseNativeHttpHandler=true (cumulative serial chain; from h11 on the check fails because of h11) | 5,140,468 | 1,659,089 | +33 | fail | reverted | +33 bytes (no gain) | build machine |
| h16-nobinfmt | EnableUnsafeBinaryFormatterSerialization=false; AutoreleasePoolSupport=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,140,468 | 1,659,089 | +0 | fail | reverted | no change | build machine |
| h17-nosymbols | TrimmerRemoveSymbols=true; DebugType=none; GenerateDocumentationFile=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,139,956 | 1,658,902 | -187 | fail | kept | -187 bytes | build machine |
| h18-noregexroute | BlazorRoutingEnableRegexConstraint=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,139,956 | 1,658,902 | +0 | fail | reverted | no change | build machine |
| h19-satellite | SatelliteResourceLanguages=en (cumulative serial chain; from h11 on the check fails because of h11) | 5,139,956 | 1,658,902 | +0 | fail | reverted | no change (no satellite assemblies) | build machine |
| h20-nosimd | WasmEnableSIMD=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,029,809 | 1,630,804 | -28,098 | fail | kept | -28k, owner accepts slower runtime | build machine |
| h21-noeh | WasmEnableExceptionHandling=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,031,566 | 1,630,914 | +110 | fail | reverted | +110 bytes on top of SIMD off | build machine |
| h22-linkOz | EmccLinkOptimizationFlag=-Oz (link step; compile already -Oz) (cumulative serial chain; from h11 on the check fails because of h11) | 5,010,725 | 1,623,238 | -7,676 | fail | kept | -7.7k | build machine |
| h23-strip | WasmNativeStrip=true; WasmEmitSymbolMap=false; WasmEnableThreads=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,010,725 | 1,623,238 | +0 | fail | reverted | no change (already defaults) | build machine |
| h24-nowebcil | WasmEnableWebcil=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,017,892 | 1,622,960 | -278 | fail | kept | -278 bytes (plain .dll smaller than webcil .wasm wrapper) | build machine |
| h25-nofingerprint | WasmFingerprintDotnetJs=false; BlazorFingerprintBlazorJs=false; WasmFingerprintAssets=false (cumulative serial chain; from h11 on the check fails because of h11) | 5,009,112 | 1,622,880 | -80 | fail | kept | -80 bytes (WasmFingerprintAssets is not read by .NET 11) | build machine |
| h26-bitmin | Bit.Minifier 11.0.0-pre-20 (default level) (cumulative serial chain; from h11 on the check fails because of h11) | 4,712,228 | 1,549,222 | -73,658 | fail | kept | -73.7k | build machine |
| h27-bitmin-aggr | BitMinifyAggressive=true (cumulative serial chain; from h11 on the check fails because of h11) | 4,654,883 | 1,531,981 | -17,241 | fail | kept | -17.2k (check failed in this chain only because h11 is in it; passes in c-honest-bitmin-aggr) | build machine |
| h28-coreclr | UseMonoRuntime=false on top of the chain (incl. WasmEnableExceptionHandling=false) (cumulative serial chain; from h11 on the check fails because of h11) | — | — | — | not-run | reverted | build failed: CoreCLR requires wasm EH | build machine |
| h29-owner-set | owner's suggested set as given (WasmNative*OptimizationFlag names are not read by .NET 11) | 5,157,227 | 1,679,512 | -884,011 | pass | experiment-only | for comparison with final Honest | build machine |
| h01-trimfull-noroot | TrimMode=full without rooting the app assembly | 7,926,111 | 2,462,057 | -101,466 | fail | reverted | app breaks: MainLayout ctor trimmed | build machine |
| h01-trimfull-noroot | TrimMode=full without rooting the app assembly | 7,926,111 | 2,462,057 | -101,466 | fail | reverted | app breaks: MainLayout ctor trimmed | build machine |

### Honest: single levers, each alone vs h00-default (parallel wave w1)

| id | change | raw | brotli | Δ brotli vs base | check | decision | reason | host |
|---|---|---:|---:|---:|---|---|---|---|
| s-trimfull | TrimMode=full (+app root) (single lever vs h00-default) | 8,198,591 | 2,561,824 | -1,699 | pass | kept | -1.7k | build machine |
| s-invglob | InvariantGlobalization=true (single lever vs h00-default) | 6,059,153 | 1,905,700 | -657,823 | pass | kept | -658k | build machine |
| s-invtz | InvariantTimezone=true; BlazorEnableTimeZoneSupport=false (single lever vs h00-default) | 7,837,634 | 2,499,139 | -64,384 | pass | kept | -64k | build machine |
| s-nodebugger | DebuggerSupport=false (single lever vs h00-default) | 8,205,260 | 2,563,540 | +17 | pass | reverted | no change | build machine |
| s-noeventsource | EventSourceSupport=false (single lever vs h00-default) | 7,881,926 | 2,464,674 | -98,849 | pass | kept | -99k | build machine |
| s-sysreskeys | UseSystemResourceKeys=true (single lever vs h00-default) | 8,205,260 | 2,563,575 | +52 | pass | reverted | no change | build machine |
| s-nohttpactivity | HttpActivityPropagationSupport=false (single lever vs h00-default) | 8,187,853 | 2,557,046 | -6,477 | pass | kept | -6.5k | build machine |
| s-nometadataupd | MetadataUpdaterSupport=false (single lever vs h00-default) | 8,205,260 | 2,563,548 | +25 | pass | reverted | no change | build machine |
| s-nometrics | MetricsSupport=false (single lever vs h00-default) | 8,065,981 | 2,513,105 | -50,418 | pass | kept | -50k | build machine |
| s-nostacktrace | StackTraceSupport=false (single lever vs h00-default) | 8,204,808 | 2,563,091 | -432 | pass | kept | -0.4k | build machine |
| s-nonullability | NullabilityInfoContextSupport=false (single lever vs h00-default) | 8,205,331 | 2,563,498 | -25 | pass | reverted | no real change | build machine |
| s-aggrattr | _AggressiveAttributeTrimming=true (single lever vs h00-default) | 8,205,312 | 2,563,527 | +4 | pass | reverted | no change | build machine |
| s-sizelinq | UseSizeOptimizedLinq=true (single lever vs h00-default) | 8,205,260 | 2,563,569 | +46 | pass | reverted | no change | build machine |
| s-nohttp3 | Http3Support=false; UseNativeHttpHandler=true (single lever vs h00-default) | 8,205,314 | 2,563,466 | -57 | pass | reverted | no real change | build machine |
| s-nosymbols | TrimmerRemoveSymbols=true; DebugType=none; GenerateDocumentationFile=false (single lever vs h00-default) | 8,205,260 | 2,563,378 | -145 | pass | kept | -0.1k | build machine |
| s-nosimd | WasmEnableSIMD=false (single lever vs h00-default) | 8,094,089 | 2,536,138 | -27,385 | pass | kept | -27k | build machine |
| s-noeh | WasmEnableExceptionHandling=false (single lever vs h00-default) | 8,096,901 | 2,536,194 | -27,329 | pass | kept | -27k alone; -0.2k on top of SIMD off | build machine |
| s-linkOz | EmccLinkOptimizationFlag=-Oz (single lever vs h00-default) | 8,179,996 | 2,555,925 | -7,598 | pass | kept | -7.6k | build machine |
| s-nowebcil | WasmEnableWebcil=false (single lever vs h00-default) | 8,213,024 | 2,564,021 | +498 | pass | kept | +0.5k alone, -0.3k in combination (kept for combination) | build machine |
| s-nofingerprint | WasmFingerprintDotnetJs=false; BlazorFingerprintBlazorJs=false (single lever vs h00-default) | 8,205,260 | 2,563,556 | +33 | pass | kept | about 0 (noise) | build machine |
| s-bitmin | Bit.Minifier 11.0.0-pre-20 default (single lever vs h00-default) | 7,844,811 | 2,472,154 | -91,369 | pass | kept | -91k | build machine |
| s-norelink | WasmBuildNative=false (single lever vs h00-default) | 8,245,204 | 2,599,448 | +35,925 | pass | experiment-only | native identical to runtime pack: +36k | build machine |
| s-nosimd-norelink | WasmBuildNative=false; WasmEnableSIMD=false (single lever vs h00-default) | — | — | — | not-run | experiment-only | build error: SIMD=false requires native build | build machine |
| s-linkOz-norelink | WasmBuildNative=false; EmccLinkOptimizationFlag=-Oz (single lever vs h00-default) | 8,245,204 | 2,599,448 | +35,925 | pass | experiment-only | native identical to pack: flag silently ignored without relink | build machine |

### Honest: combinations

| id | change | raw | brotli | Δ brotli vs base | check | decision | reason | host |
|---|---|---:|---:|---:|---|---|---|---|
| c-honest-managed | kept switches + native levers, no Bit.Minifier | 5,079,296 | 1,648,048 | -915,475 | pass | experiment-only | combination step | build machine |
| c-honest-bitmin | + Bit.Minifier default | 4,771,072 | 1,569,501 | -78,547 | pass | kept | -78.5k | build machine |
| c-honest-bitmin-aggr | + BitMinifyAggressive=true | 4,713,728 | 1,552,325 | -17,176 | pass | kept | -17.2k, check passes | build machine |
| c-honest-dyncode | + DynamicCodeSupport=false | 4,621,474 | 1,521,823 | -30,502 | pass | kept | -30.5k | build machine |
| c-honest-final | + EmccExtraLDFlags=-sMALLOC=emmalloc; WasmEnableExceptionHandling=false | 4,616,080 | 1,519,331 | -2,492 | pass | kept | -2.5k; final Honest recipe | build machine |
| c-honest-coreclr | UseMonoRuntime=false (CoreCLR on wasm), SIMD on | 6,483,338 | 1,991,848 | +422,347 | pass | reverted | works, but +422k brotli vs Mono | build machine |
| c-honest-managed-norelink | same + WasmBuildNative=false | — | — | — | not-run | experiment-only | build error: InvariantTimezone=true requires native build | build machine |
| c-honest-bitmin-norelink | + WasmBuildNative=false | — | — | — | not-run | experiment-only | build error (needs relink) | build machine |
| f-honest | final Honest: ./build.sh honest (Directory.Build.props SizeProfile=final) | 4,616,080 | 1,519,331 | -1,044,192 | pass | kept | final | build machine |

### Extreme

| id | change | raw | brotli | Δ brotli vs base | check | decision | reason | host |
|---|---|---:|---:|---:|---|---|---|---|
| e00-extreme | Extreme code: own router, JS fetch, no HttpClient/STJ use in app; same switches as c-honest-managed | 4,700,262 | 1,510,220 | -137,828 | pass | kept | -138k vs Honest with same settings | build machine |
| e00-extreme-norelink | WasmBuildNative=false | — | — | — | not-run | experiment-only | build error (needs relink) | build machine |
| e01-bitmin | + Bit.Minifier default | 4,427,878 | 1,442,496 | -67,724 | pass | kept | -67.7k | build machine |
| e02-bitmin-aggr | + BitMinifyAggressive=true | 4,377,702 | 1,427,599 | -14,897 | pass | kept | -14.9k | build machine |
| e03-wasmopt | wasm-opt -Oz (binaryen 125) on dotnet.native.wasm + integrity hash rewrite | 4,308,453 | 1,408,991 | -18,608 | pass | kept | -18.6k | build machine |
| e04-minify | terser on dotnet.native.js, dotnet.runtime.js, blazor.webassembly.js, dotnet.js | 4,177,435 | 1,387,075 | -21,916 | pass | kept | -21.9k | build machine |
| e04-repeat | same as e04-minify, parallel wave, PathMap added | 4,177,435 | 1,387,075 | +0 | pass | experiment-only | determinism check: identical bytes | build machine |
| x-subst | ILLink substitutions: stub AddEnvironmentVariables, culture provider checks (single change vs e04-minify) | 4,168,651 | 1,385,041 | -2,034 | pass | kept | -2.0k | build machine |
| x-dyncode | DynamicCodeSupport=false (single change vs e04-minify) | 4,085,124 | 1,360,210 | -26,865 | pass | kept | -26.9k | build machine |
| x-startuphook | StartupHookSupport=false (single change vs e04-minify) | 4,177,435 | 1,387,075 | +0 | pass | reverted | no change | build machine |
| x-ignoredesc | ILLink --ignore-descriptors true (single change vs e04-minify) | 4,145,722 | 1,378,107 | -8,968 | fail | reverted | app does not start | build machine |
| x-noeh | WasmEnableExceptionHandling=false (single change vs e04-minify) | 4,177,066 | 1,386,876 | -199 | pass | kept | -0.2k | build machine |
| x-emmalloc | EmccExtraLDFlags=-sMALLOC=emmalloc (single change vs e04-minify) | 4,170,233 | 1,384,986 | -2,089 | pass | kept | -2.1k | build machine |
| x-nofs | EmccExtraLDFlags=-sFILESYSTEM=0 (single change vs e04-minify) | — | — | — | not-run | reverted | build error: -sFORCE_FILESYSTEM cannot be used with -sFILESYSTEM=0 | build machine |
| x-closure | EmccExtraLDFlags=--closure=1 (single change vs e04-minify) | — | — | — | not-run | reverted | build error: google-closure-compiler not found | build machine |
| x-wasmopt-converge | wasm-opt -Oz --converge (single change vs e04-minify) | 4,176,258 | 1,386,253 | -822 | pass | kept | -0.8k | build machine |
| x-sysreskeys | UseSystemResourceKeys, NullabilityInfoContextSupport=false, _AggressiveAttributeTrimming, UseSizeOptimizedLinq (single change vs e04-minify) | 4,177,533 | 1,387,103 | +28 | pass | reverted | +28 bytes | build machine |
| x-coreclr | UseMonoRuntime=false (single change vs e04-minify) | — | — | — | not-run | reverted | postprocess failed: wasm-opt needs --enable-simd for CoreCLR native; CoreCLR already +422k in Honest | build machine |
| x-dump | _TrimmerDumpDependencies=true (analysis run, no emmalloc/EH) | 4,075,233 | 1,354,774 | +1,845 | pass | experiment-only | used to find why types are kept | build machine |
| x-subst2 | 4 more substitutions in one file | — | — | — | not-run | reverted | ILLink crash IL1012 (split in w5) | build machine |
| x-closure2 | --closure=1 after npm install of google-closure-compiler in the emscripten pack | — | — | — | not-run | reverted | build error: third_party/closure-compiler/node-externs missing from workload pack | build machine |
| x-noassert | -sASSERTIONS=0 -sSTACK_OVERFLOW_CHECK=0 | 4,067,673 | 1,352,929 | +0 | pass | reverted | no change (already off) | build machine |
| x-heap | WasmInitialHeapSize=16777216 | 4,067,673 | 1,353,224 | +295 | pass | reverted | +295 bytes | build machine |
| x-subst2a | stub Console.get_Error, JsonStreamConfigurationSource.Build | 4,020,327 | 1,336,247 | -16,682 | pass | kept | -16.7k | build machine |
| x-subst2b | stub STJ EnumConverter.TryParseEnumFromString | — | — | — | not-run | reverted | ILLink crash IL1012 | build machine |
| x-subst2c | stub DomainNameHelper.TryGetUnicodeEquivalent (IDN) | 4,061,017 | 1,350,284 | -2,645 | pass | kept | -2.6k | build machine |
| e05-combo-nopost | e05-combo without wasm-opt/terser | 4,270,235 | 1,393,454 | +40,525 | pass | experiment-only | post-process is worth -40.5k | build machine |
| e05-combo | + DynamicCodeSupport=false, emmalloc, EH off, substitutions, wasm-opt --converge | 4,067,673 | 1,352,929 | -34,146 | pass | kept | -34.1k | build machine |
| f-extreme | final Extreme: ./build.sh extreme (+subst 1, 2a, 2c, wasm-opt, terser) | 4,013,671 | 1,333,578 | -185,753 | pass | kept | final | build machine |

### Workload A/B

| id | change | raw | brotli | Δ brotli vs base | check | decision | reason | host |
|---|---|---:|---:|---:|---|---|---|---|
| ab-honest-managed-norelink-try1 | managed-only A/B, WasmBuildNative=false, with BlazorEnableTimeZoneSupport=false / InvariantGlobalization | — | — | — | not-run | experiment-only | build error: InvariantTimezone needs native build (from BlazorEnableTimeZoneSupport=false) | build machine |
| ab-extreme-managed-norelink-try1 | managed-only A/B, WasmBuildNative=false, with BlazorEnableTimeZoneSupport=false / InvariantGlobalization | — | — | — | not-run | experiment-only | build error: InvariantTimezone needs native build | build machine |
| ab-honest-managed-relink | managed levers only (no InvariantGlobalization/Timezone, no SIMD/link flags), default relink | 7,253,633 | 2,274,687 | +755,356 | pass | experiment-only | A/B (d-like): same managed set with relink | build machine |
| ab-honest-managed-norelink | managed levers only (no InvariantGlobalization/Timezone, no SIMD/link flags), WasmBuildNative=false | 7,321,479 | 2,320,504 | — | pass | experiment-only | A/B (c): native = runtime pack | build machine |
| ab-extreme-managed-norelink | Extreme, managed levers only, WasmBuildNative=false, terser only (no wasm-opt) | 6,923,574 | 2,186,970 | — | pass | experiment-only | A/B (e, no-relink side) | build machine |
## .NET 11 property names: which are real

Checked by grep in the .NET 11.0.100 SDK, the `Microsoft.NET.Runtime.WebAssembly.Sdk` 11.0.0 pack, the Mono runtime pack and ILLink tasks
(`tools/grep-props.sh`), and by the effect on the output.

- Real, used: all trimming/feature-switch names in the tables, `WasmEnableSIMD`, `WasmEnableExceptionHandling`, `WasmEnableThreads`,
  `WasmNativeStrip`, `WasmEmitSymbolMap`, `WasmInitialHeapSize`, `EmccCompileOptimizationFlag`, `EmccLinkOptimizationFlag`,
  `EmccExtraLDFlags`, `WasmEnableWebcil`, `WasmFingerprintDotnetJs`, `BlazorFingerprintBlazorJs`, `BlazorCacheBootResources`,
  `UseMonoRuntime`, `BlazorRoutingEnableRegexConstraint`, `DynamicCodeSupport`.
- **Not read by .NET 11** (0 hits): `WasmNativeCompileOptimizationFlag`, `WasmNativeLinkOptimizationFlag` (the owner's set uses them:
  no effect), `BlazorWebAssemblyPreserveCollationData`, `BlazorWebAssemblyJiterpreter`, `BlazorIcuDataFileName`, `WasmFingerprintAssets`,
  `WasmFingerprintBootConfig`.
- Defaults for Mono browser-wasm Release: compile `-Oz`, link `-O2` (`BrowserWasmApp.targets` lines 140–151). `-Oz` reaches the link
  step: build log line `Linking with emcc with -Oz. This may take a while ...` (kept locally in the run's trace files, not published).

## Workload effect (A/B)

Runtime pack file `dotnet.native.wasm`: sha256 `925dca0a2a0879f7…`, 3,150,989 bytes raw, 1,003,700 brotli.

| run | native build | `dotnet.native.wasm` sha256 (16) | native raw | native brotli | cold raw | cold brotli |
|---|---|---|---:|---:|---:|---:|
| a. template, `WasmBuildNative=false` | off | `925dca0a2a0879f7` = **identical to pack** | 3,150,989 | 1,003,700 | 8,487,593 | 2,625,727 |
| b. template, default (relink) | on | `750f393d6c5567f6` | 3,045,027 | 955,119 | 8,447,649 | 2,589,350 |
| c. Honest, managed levers only, `WasmBuildNative=false` | off | `925dca0a2a0879f7` = identical | 3,150,989 | 1,003,700 | 7,321,479 | 2,320,504 |
| c'. same managed levers, relink | on | `20e799c24e6a…` | 3,017,125 | 945,681 | 7,253,633 | 2,274,687 |
| d. Honest final (all levers, relink) | on | `4c1204516d4f…` | 1,194,651 | 402,831 | 4,616,080 | 1,519,331 |
| e. Extreme, managed levers only, no relink (terser only) | off | `925dca0a2a0879f7` = identical | 3,150,989 | 1,003,700 | 6,923,574 | 2,186,970 |
| e'. Extreme final (relink + wasm-opt) | on | `dd5379247683…` | 1,125,784 | 384,310 | 4,013,671 | 1,333,578 |

Relink happens: every relinked run logs `Linking with emcc with -Oz` (or `-O2`) and its native file differs from the pack.

- b vs a: relink alone saves 36k brotli (the relink drops unused native code).
- c vs c': 46k.
- **c → d is −801k**. Most of it is `InvariantGlobalization` + `InvariantTimezone`. In .NET 11 both **need the native build**:
  with `WasmBuildNative=false` the build stops with `WasmBuildNative is required because InvariantGlobalization=true` (same for
  `InvariantTimezone=true`, `WasmEnableSIMD=false`). The relink then leaves ICU out of `dotnet.native.wasm` (3.05 MB → 1.59 MB raw on its own: `s-invglob`).
- e → e': −853k for Extreme.
- So yes: without the workload, this result cannot be reached. Where each native lever stands without relink:
  `WasmEnableSIMD=false`, `InvariantGlobalization`, `InvariantTimezone` → build error;
  `EmccLinkOptimizationFlag=-Oz` → **silently ignored** (native byte-identical to the pack, `s-linkOz-norelink`);
  `EmccExtraLDFlags`, `WasmEnableExceptionHandling`, `WasmNativeStrip` → only used by the relink targets (no relink, no effect).

## SIMD trade

`WasmEnableSIMD=false`: −27.4k alone (`s-nosimd`), −28.1k in the chain (`h20`). No visible cost in the check:
first render of Home 405 ms vs 421 ms with SIMD (parallel wave, noise level). Kept as decided by the owner.

## Bit.Minifier

- Package: [Bit.Minifier on NuGet](https://www.nuget.org/packages/Bit.Minifier), source [bitfoundation/bitplatform](https://github.com/bitfoundation/bitplatform).
  Build-time tool (Mono.Cecil), target `BitMinifyTrimmedAssemblies` runs after `_RunILLink`, only for trimmed browser-wasm publish.
  It renames non-public names and strips compiler/debugger-only attributes in the trimmed framework and library assemblies
  (the app's own assemblies keep their names). `BitMinifyAggressive=true` also renames public names.
- Used version 11.0.0-pre-20 (latest). It works on .NET 11 GA: build log `bit Minifier freed 292 KB of 3.12 MB -> 2.83 MB (9.1% smaller)`,
  no `BITMIN001` warning. `bit-minifier.map` stays in `obj/`, it is not in the publish output.
- Effect: Honest default −91k alone (`s-bitmin`), −78.5k on top of the other levers; aggressive another −17.2k; check passes.
  Extreme: −67.7k / −14.9k.

## CoreCLR on wasm (`UseMonoRuntime=false`)

Stock Microsoft CoreCLR browser-wasm pack (`Microsoft.NETCore.App.Runtime.browser-wasm`). It publishes and the app passes the
check (`c-honest-coreclr`), but it is **+422k brotli** vs Mono (native 2.83 MB raw / 782k brotli). It needs wasm exception
handling (`WasmEnableExceptionHandling cannot be disabled for CoreCLR browser-wasm`) and keeps SIMD on. Reverted.

## Parallel runs and determinism

build machine: 12 cores, 39 GB RAM. I ran 6 publishes at a time (7 in the last wave). Wave w1 (37 runs) took 5 min 16 s; the same
work one after another takes about 1 min per run (~37 min). Each run used its own source copy; emscripten cache is the
prebuilt one in the workload pack (no lock problems seen).
Check: `e04-repeat` (same settings as `e04-minify`, run in another wave) gave identical raw and brotli totals.
Before `PathMap` was added, a repeat of `h00-default` from a different checkout path gave the same raw total and the same
`dotnet.native.wasm` hash, but brotli differed by 3 bytes (checkout path in the app assembly). `PathMap` in `Directory.Build.props` removes that.


## Extreme: what was replaced, what is lost

Still real Blazor: Razor components rendered by the stock `WebAssemblyRenderer`, started by the stock `WebAssemblyHostBuilder`,
stock Mono runtime pack (relinked with the stock emscripten from the workload; binaryen and terser only rewrite the output, they do not change behaviour).

Replaced / hacked:
1. `Router`/`RouteView`/`@page` → hand-written router in `App.razor` (`switch` on `NavigationManager.ToBaseRelativePath`, `LocationChanged`,
   `INavigationInterception.EnableNavigationInterceptionAsync`). Works under any `<base href>`.
2. `NavLink` → plain `<a>`.
3. `HttpClient` / System.Net.Http / STJ in app code → `fetch()` via `IJSRuntime.InvokeAsync<string>` with a one-line JS helper that
   parses JSON in JS and returns plain text lines.
4. ILLink substitutions (method bodies replaced by stubs): `AddEnvironmentVariables`, `WebAssemblyCultureProvider.ThrowIfCultureChangeIsUnsupported`
   / `LoadCurrentCultureResourcesAsync`, `Console.get_Error`, `JsonStreamConfigurationSource.Build`, `DomainNameHelper.TryGetUnicodeEquivalent`.
5. Post-processing: `wasm-opt -Oz --converge` on `dotnet.native.wasm`, terser on the JS files, new sha256 integrity values written into the
   boot config inside `dotnet.js`, `.br`/`.gz`/`.map` removed.

Blazor features lost in Extreme (on top of what Honest loses):
- No `@page` routing: no route templates/parameters/constraints, no `NotFound` page component, no `FocusOnNavigate`, no `NavLink` active class,
  no lazy-loaded assemblies by route.
- No `HttpClient` service (and no `System.Net.Http`); HTTP only through JS interop.
- Environment variables are not in `IConfiguration`; `appsettings.json` / `appsettings.{env}.json` are **ignored**.
- No culture switching / satellite assemblies (already gone with invariant globalization).
- `Console.Error` is null: if a root-component update fails, the error write throws instead of printing.
- Unicode (IDN) host names in `Uri` are not converted.
- Post-processed files must be rebuilt with `build.sh` (integrity values are rewritten); a hand edit breaks loading.

Lost in both variants (settings): culture-specific formatting (invariant culture), time zones (UTC only), EventSource/metrics/diagnostics,
stack traces in exceptions, dynamic code paths (`DynamicCodeSupport=false`: DI and expression trees use slower reflection paths),
SIMD (slower runtime), wasm exception handling (emscripten's JS-based fallback), debugger, readable framework names in logs (Bit.Minifier aggressive).

## What survives in Extreme, and why (from `_TrimmerDumpDependencies` + `tools/why.py`)

- `System.Private.CoreLib` 420k brotli: biggest types are `System.Number` (formatting/parsing of all numeric types), `SpanHelpers`, `Decimal`,
  `Utf8Parser`, `RuntimeType`, `TimeZoneInfo`, `DateTimeParse`, `String`, `Task`, plus the new .NET 11 numeric types (`Decimal128/64/32`, `BFloat16`,
  `Int128`, `Half`). These come in through interfaces: e.g. `StringBuilder.AppendFormat` → `ISpanFormattable.TryFormat` keeps every
  implementation (`BFloat16.TryFormat` chain), and CoreLib's own `ILLink.Descriptors.xml` roots `Environment.StackTrace`, `AppContext.OnProcessExit`
  (which keeps `IDisposable.Dispose` of every disposable type, e.g. `LoggerFactory`, `ImmutableArray.Enumerator`). `--ignore-descriptors` breaks the runtime.
- `System.Text.Json` 122k: needed by Blazor's JS interop (`DotNetDispatcher.ParseArguments`, event args, root component operations via
  `WebAssemblyJsonSerializerContext`). `JsonSerializerIsReflectionEnabledByDefault=false` breaks the app (`NoMetadataForType`), because
  Blazor itself deserializes with the reflection resolver.
- `Microsoft.Extensions.*` (DI 17k + abstractions 8k, Logging 10k+6k, Options 6k, Configuration ~5k, Primitives 3k): the host builds a DI container
  and the renderer requires `ILoggerFactory`; they cannot go without replacing `WebAssemblyHostBuilder`, whose renderer is internal.
- `System.Collections.Immutable` 17k (rooted through `OnProcessExit` → `Dispose`), `System.Private.Uri` 22k (`NavigationManager`),
  `System.Runtime.InteropServices.JavaScript` 14k (all JS interop), `System.Linq` 8.6k (cascading parameters use `OfType`).
- Gone completely in Extreme (present in Honest): `System.Net.Http`, `System.Net.Primitives`, `System.Console` (after the `get_Error` stub), and others listed by diffing the two file tables below.
  Still there but smaller: `Microsoft.Extensions.Configuration.Json` (stubbed `Build`, the type stays), `System.Text.RegularExpressions`
  (kept by STJ's enum-from-string parsing; the stub for it crashed ILLink).

## Floor per group and what blocks going lower

Extreme final, brotli: native 384,310 · JS loader 100,792 · managed 848,252 · other 224.

- **Native (384k)**: after relink with invariant globalization, SIMD off, EH off, `-Oz`, emmalloc and wasm-opt. Going lower needs removing parts
  of the Mono runtime that are compiled into the prebuilt `.a` libraries of the runtime pack (interpreter, jiterpreter support, sgen GC, marshalling,
  component stubs). There is no MSBuild switch for that; it needs a **custom runtime build**, which is out of scope (stock packs only).
  `-sFILESYSTEM=0` is refused by emcc (`-sFORCE_FILESYSTEM cannot be used with -sFILESYSTEM=0`); closure compiler is not usable with the workload pack.
- **JS (101k)**: `dotnet.runtime.js` is already minified by Microsoft (terser saves < 1k); the rest is `blazor.webassembly.js` (23k),
  `dotnet.native.js` (18k), `dotnet.js` with the embedded boot config (13k). Going lower needs editing the runtime/Blazor JS (removing jiterpreter etc.) = patching the runtime.
- **Managed (848k)**: CoreLib 420k + STJ 122k + Blazor 116k + host/DI/logging ~70k. Lower needs replacing the host (internal renderer) or
  making Blazor's interop work without reflection-based JSON (internal types can not be named in a source-generated context).
- Even with every other managed assembly at zero, native + JS + CoreLib + STJ = 1.03 MB with the stock .NET 11 runtime and stock Blazor.
  Extreme round 1 ends at 1,333,578. The issue #86601 recipe itself weighs 1,735,678 on .NET 11 with our metric.

## Errors seen (exact text, short)

- Mac workload: `Inadequate permissions. Run the command with elevated privileges.`
- build machine relink before libatomic: `node: error while loading shared libraries: libatomic.so.1: cannot open shared object file` → `emcc : error : '... compiler.mjs - --symbols-only' failed (returned 127)`.
- `TrimMode=full` without app root: `Unhandled exception rendering component: CtorNotLocated, Honest.Layout.MainLayout`.
- `JsonSerializerIsReflectionEnabledByDefault=false`: `System.Text.Json.ThrowHelper.ThrowNotSupportedException_NoMetadataForType` from `Microsoft.JSInterop.Infrastructure.DotNetDispatcher.ParseArguments`.
- CoreCLR + EH off: `WasmEnableExceptionHandling cannot be disabled for CoreCLR browser-wasm. The CoreCLR runtime requires wasm exception handling.`
- CoreCLR + wasm-opt: `[wasm-validator error] SIMD operations require SIMD [--enable-simd]`.
- No relink with native levers: `error : WasmBuildNative is required because InvariantGlobalization=true` (also `InvariantTimezone=true`, `WasmEnableSIMD=false`).
- `-sFILESYSTEM=0`: `emcc : error : -sFORCE_FILESYSTEM cannot be used with -sFILESYSTEM=0`.
- `--closure=1`: `google-closure-compiler was not found!`, then after `npm install`: `FileNotFoundError: ... third_party/closure-compiler/node-externs`.
- STJ `EnumConverter` substitution: `ILLink : error IL1012: IL Trimmer has encountered an unexpected error`.
- `--ignore-descriptors true`: app does not start (Home never renders).

## GitHub Pages

Files: `.github/workflows/pages.yml`, `build.sh`, `tools/assemble-site.mjs`, `tools/pages-deeplink.mjs`, `tools/serve.mjs` (`startPages`).

- Base path: taken from `actions/configure-pages` output `base_path`; `assemble-site.mjs` rewrites `<base href>` to `<base>honest/` and
  `<base>extreme/`. The router, links and `data.json` fetch are all relative to `<base href>`.
- Deep links: each app gets `counter.html` and `fetch.html` copies of its `index.html` (Pages serves `/x/counter` from `counter.html` with 200;
  checked on a live Pages site: `https://webassembly.github.io/wabt/demo/wat2wasm/index` → 200). Any other path hits the single root `404.html`, which
  finds the app from the path and redirects to `<base><app>/?p=<rest>`; a small script in `index.html` puts the path back with `history.replaceState`
  before Blazor starts. `.nojekyll` is added.
- Gate on the Linux build machine (`tools/final.sh`): site under `/some-repo/`, Pages-like server (no SPA fallback, `404.html` with status 404, dir → 301 + slash):
  functional check PASS for both apps; extra deep-link test (`/some-repo/extreme/no-such-page?q=1`, `/some-repo/honest/no-such-page`,
  `/some-repo/extreme/counter/`) PASS. `actionlint` 1.7.12: no findings.
- Action versions (latest releases, checked with `gh api`): checkout v7, setup-dotnet v6, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5.
- Landing page sizes are generated in CI by `check.mjs` + `measure.mjs` (not hard-coded).
- Pages and compression: Pages compresses with gzip on the fly, also `application/wasm`, and does **not** send brotli even when the browser asks
  for it; precompressed `.br` files are not used. Checked with curl: `https://kripken.github.io/ammo.js/builds/ammo.wasm.wasm` with
  `Accept-Encoding: br, gzip` → `content-type: application/wasm`, `content-encoding: gzip`. No official GitHub doc about this was found.
  Expected transfer on Pages ≈ the gzip column: Honest 1,823,357, Extreme 1,599,659 (gzip -9; Pages' own level may give a bit more).
- Free hosts that serve brotli (not verified here): Cloudflare Pages; Vercel; Netlify.
- Private repos: [GitHub docs](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages): "GitHub Pages is available in public
  repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, GitHub
  Enterprise Cloud, and GitHub Enterprise Server." So a private repo needs a paid plan.

## Commands

```bash
# on the Linux build machine (from the Mac: tools/db.sh <cmd> syncs and runs it there)
./build.sh honest            # -> artifacts/honest/wwwroot
./build.sh extreme           # -> artifacts/extreme/wwwroot
./measure.sh artifacts/honest honest                     # check + sizes
./measure.sh artifacts/extreme extreme
node tools/check.mjs artifacts/extreme/wwwroot           # check only
tools/final.sh               # both builds + measure + Pages gate + actionlint
tools/matrix.sh steps/05-matrix.txt 6                    # re-run an experiment wave
```


---

# Round 2: more savings for Extreme (and Honest)

Limits: no runtime/ASP.NET Core forks, stock `WebAssemblyHostBuilder`, renderer and `blazor.webassembly.js` (minify only).
**Metric from round 2 on: bytes transferred as served from the `.br` files** (`SERVE_ENCODED=br` mode of `tools/serve.mjs`,
`Content-Encoding: br`, exact bytes of the `.br` files made at the end of `build.sh`), read from the network log
(`responseBodySize`). In every run the served total equals the sum of the `.br` files (`SERVED ... equal=true` in the measure output; the per-run trace files are kept locally, not published).

## Result

| | raw | served brotli | served gzip | brotli saved in round 2 | check | stress page |
|---|---:|---:|---:|---:|---|---|
| Extreme round 1 (`r2-base-br`) | 4,013,671 | 1,333,578 | 1,599,659 | — | pass | — |
| **Extreme round 2 final** (`f2-extreme`) | **3,851,361** | **1,211,018** | **1,507,342** | **122,560** | pass | pass 15/15 |
| Honest round 1 | 4,616,080 | 1,519,331 | 1,823,357 | — | pass | — |
| **Honest round 2 final** (`f2-honest`, no code change) | **4,243,612** | **1,424,673** | **1,706,941** | 94,658 | pass | — |
| Honest + bundle (`f2-honest-bundle`, experiment row) | 4,240,357 | 1,344,434 | 1,675,892 | 174,897 | pass | — |

First render of Home in the check: 361 ms (no bundle) → 316 ms (bundle) → 291 ms (final).

Final Extreme files (served brotli): `b.bin` (32 assemblies) 752,074 · `dotnet.native.wasm` 359,489 · `dotnet.runtime.js` 47,048 ·
`blazor.webassembly.js` 22,808 · `dotnet.native.js` 17,573 · `dotnet.js` (boot config inside) 11,300 · `index.html` (incl. loader) 658 · `data.json` 68.
Groups: managed 752,074 · native 359,489 · JS 98,729 · html+data 726.
Inside the bundle, compressed alone: CoreLib 408,929 (was 420,038), System.Text.Json 120,906 (was 122,078), Components 54,513,
Components.WebAssembly 39,438, Private.Uri 21,785, Components.Web 17,554, DI 16,745, Collections.Immutable 16,011, JSInterop 15,186,
InteropServices.JavaScript 13,386; all parts alone sum to 818,901, the bundle is 752,074.

## Mechanisms

| # | mechanism | rows | brotli delta (kept) | result |
|---|---|---|---:|---|
| 1 | joint-compression bundle | r2-b-group/alpha/size/boot/group-wasm | **−75,030** | kept: group order. With the wasm inside: −4k more but no streaming compile (381 ms) → not kept. gzip: bundle −32k too, so Pages uses the bundle layout. |
| 2+4 | dependency dump + ILLink stubs | r2-dump, r2-u-d/s/l/p/j/all | 0 | stubs for OnProcessExit, StackTrace, ALC callbacks, PersistentState SHA-256, JsonNode converter: no size change (the code is reachable from other roots) → reverted |
| 3 | feature switches (complete list) | r2-s-didynamic/com/linqexpr/cultures | 0 | reverted |
| 5 | Cecil metadata pass (`tools/MetaStrip`) after Bit.Minifier | r2-m-attrs/consts/props/all/props-nocorelib/props-notasks | **−20,134** | kept: attributes −7.5k, consts −0.2k, property/event metadata (not for CoreLib `System`, `System.Threading*`, `System.Runtime*` types) |
| 6a | wasm-opt passes | r2-n-tnh/gufa/strip/tnh-gufa, norunopt* | **−1,509** | kept `-tnh --gufa -Oz --converge`; strip flags 0; `WasmRunWasmOpt=false` reverted |
| 6b | native function stubs (`tools/wasmstub.mjs`, by name) | r2-x-names/canary/aot/pdb/simd/misc/jitleft/combo/aot2 | **−23,337** together (f2-extreme vs r2-x-names; alone: pdb −5.8k, simd −3.0k, misc −1.8k, jitleft −4.0k, AOT lookups −9.4k) | kept; full AOT group reverted (trap at startup) |
| 6c | jiterpreter exports removal | r2-n-jiterpoff, r2-n-jiterp-dce | 0 / fail | reverted (runtime JS needs the exports) |
| 7 | JS: aggressive terser, slim boot config | r2-j-aggr, r2-j-slim | **−2,572** | kept |

### 1. Bundle
- `tools/bundle.mjs`: all managed assemblies → `_framework/b.bin`. Order: CoreLib, `System.*`, `Microsoft.Extensions.*`, other `Microsoft.*`, app.
- Loading: `blazor.webassembly.js` gets `autostart="false"`; an inline script in `index.html` does `fetch("_framework/b.bin", {integrity})`
  and `Blazor.start({ loadBootResource })`. For every bundled name it returns a `Response` with that slice. The stock loader
  (`dotnet.js`) uses a returned `Response` as-is and checks integrity only when it does the fetch itself, so the bundle has its own sha256 `integrity`.
- Added JS: the loader + offset table in `index.html`, about 1,040 bytes raw / +500 brotli.
- Boot config (`BOOT_SLIM`): bundled entries lose `hash`/`cache` and get short names (−2.0k).
- Layout chosen: bundle for brotli hosts and for gzip (Pages): the bundle also wins under gzip (r2-b-group 1,567,690 vs r2-base-gz 1,599,659, −32k); final gzip 1,507,342.

### 2. What roots CoreLib and STJ (from `_TrimmerDumpDependencies` + `tools/why.py`)
- STJ: `DotNetDispatcher.ParseArguments` → `JsonSerializer.Deserialize(..., Type, options)` (reflection resolver) for every JS → .NET call,
  and `WebAssemblyJsonSerializerContext` (root component operations). `JsonNode` comes in through the virtual `JsonConverter.CanConvert`.
- CoreLib: the CoreLib `ILLink.Descriptors.xml` roots `AppContext.OnProcessExit` (→ `IDisposable.Dispose` of everything),
  `Environment.StackTrace` (→ `StringBuilder.AppendFormat` → `ISpanFormattable.TryFormat` of all number types, `Uri`, ...), the ALC callbacks
  (→ satellite / fallback loading, `CompareInfo`, `AssemblyBuilder`); `DateTime.ToString` → `TimeZoneInfo`. Stubbing those roots changed nothing,
  because the same code is also reached by normal calls.
- Why the small assemblies survive: `System.Text.RegularExpressions` (STJ enum-from-string parsing; its stub crashes ILLink),
  `System.Security.Cryptography` (persistent component state key hashing, also other roots), `System.Collections.Immutable` (Components + Dispose root),
  `System.IO.Pipelines` (STJ `PooledByteBufferWriter`), `System.Diagnostics.DiagnosticSource` (2k, logging/activity types),
  `System.ComponentModel` (`EditorBrowsable` attribute ctor), `Configuration.Json` / `.EnvironmentVariables` (types still referenced by the host;
  their methods are stubs, 1.5k each), `System.Private.Uri` (`NavigationManager`).

### 6b. Native stubs: how they were checked
- Names: `NativeNames=true` keeps the name section through the link (`--profiling-funcs`, SDK post-link pass off); our wasm-opt strips it.
- A stubbed function body is `unreachable`. The check fails loudly on a trap: canary `r2-x-canary` (stub `mono_wasm_load_runtime`)
  fails with `Failed to start platform`; the full AOT group failed with `RuntimeError: unreachable`.
- Stress page (`tools/stress/Stress.razor`, only in the generated `ExtremeStress` project, never shipped): exception thrown and caught,
  nested try/finally with `int.Parse` failure, GC under allocation load, number/decimal/Half formatting, parsing, `DateTime.Now`,
  `DateTime.Parse`, `Guid`, LINQ, `Dictionary`, string ops, delegates, `Task.Delay`, and a failed HTTP request (404 via `fetch`).
  `tools/stress.mjs` requires 15/15 and no console error except the expected 404. Every kept group passed it, alone and combined.
- Groups and why they are dead for this app:
  - pdb: embedded-PDB reading + zlib (no PDBs are shipped, `DebugType=none`);
  - simd: interpreter SIMD emitters (`WasmEnableSIMD=false`);
  - misc: `mono_wasm_exec_regression`, thread dump (test/debug entry points);
  - jitleft: code manager, llvmonly, unwind encoder (no JIT/AOT code exists);
  - AOT lookups: `mono_aot_find_jit_info`, `decode_method_ref_with_target`, trampolines, offsets, hashes, flags, dedup
    (no AOT images; only the AOT init/load functions run, they stay).

## Features lost in round 2
- Loading an assembly with an embedded or separate PDB, or anything that needs zlib in the runtime, traps.
- AOT-compiled assemblies cannot be used (AOT lookup functions trap).
- Interpreter SIMD intrinsics paths trap if SIMD were ever on again.
- Runtime thread dump and the regression-test entry point trap.
- Reflection over compiler-only attributes (e.g. `[CompilerGenerated]`, `[Nullable]`, `[TypeForwardedFrom]`, `[InternalsVisibleTo]`,
  `[AssemblyMetadata]`) returns nothing; reflection over properties/events of framework types (outside the kept CoreLib namespaces) finds none;
  framework `const` fields are not visible to reflection.
- The bundle fails as a whole if one byte changes (one integrity value); no per-assembly caching; the browser downloads all assemblies before start (as before).

## What is left and what it would need
- Native 359,489: the rest is the Mono interpreter, GC, metadata loader, marshalling, emmalloc, libc. Lower = custom runtime build (rejected: fork).
- JS 98,729: `dotnet.runtime.js` 47k (incl. jiterpreter ~24k), `blazor.webassembly.js` 23k, `dotnet.native.js` 18k, `dotnet.js` 11k.
  Lower = editing runtime/Blazor JS logic (rejected).
- Managed 752,074: CoreLib 409k alone, STJ 121k alone. STJ goes only if JS interop stops using reflection-based JSON (renderer/host internals → custom host, rejected).
  DI + logging + options + configuration ~45k need replacing the host (rejected). Host bypass via `UnsafeAccessorType` was **not measured**.
- Even native + JS + CoreLib + STJ alone (compressed separately) = 988k; these parts get smaller only with one of the ruled-out options above.

## Round 2 files
New: `tools/bundle.mjs`, `tools/compress.mjs`, `tools/wasmstub.mjs`, `tools/native-stub-estimate.sh`, `tools/native-symbols.sh`,
`tools/MetaStrip/`, `tools/stress/Stress.razor`, `tools/make-stress.sh`, `tools/stress.mjs`, `tools/bundle-parts.mjs`,
`Extreme/ILLink.Substitutions3{d,s,l,p,j}.xml` (measured, not used by default), `results/native-symbols/extreme/` (kept locally, not published).
Changed: `build.sh` (recipe with defaults: Cecil, stubs, wasm-opt, terser, bundle for Extreme, `.br`/`.gz` at the end),
`Directory.Build.props` (`NativeNames`, switch item groups), `Extreme/Extreme.csproj`, `tools/serve.mjs` (encoded mode), `tools/check.mjs`
(transfer sizes), `tools/measure.mjs` (served totals), `tools/postprocess.mjs`, `tools/step.sh`, `tools/assemble-site.mjs`, `tools/final.sh`, `tools/AsmSize`.
Pages gate (build machine, `/some-repo/`): both apps PASS, deep links PASS; actionlint OK.

---

# App Service host (brotli on the wire)

`Host/` serves the final `build.sh` output with the build's own `.br`/`.gz` files (details and setup steps:
[`docs/hosting.md`](docs/hosting.md)). Gate on the Linux build machine (`tools/host-gate.sh`), site assembled with base path `/`:

| build | first response | RSS start / after cold load / after 5 min idle | threads idle | CPU 1 idle minute | disk | gate |
|---|---:|---|---:|---:|---:|---|
| framework-dependent `net10.0` | 127 ms | 53.5 / 61.9 / 63.5 MB | 15 | 0.017 % | 0.1 MB + runtime | pass |
| self-contained, trimmed | 295 ms | 31.9 / 37.0 / 38.2 MB | 13 | 0 % | 26.5 MB | pass |
| **Native AOT** (deployed) | **20 ms** | **12.5 / 17.0 / 15.4 MB** | 10 | 0 % | 6.1 MB | pass |

- Both apps through the host: functional check pass, zero console errors (also no CSP violations), every `_framework` response
  `content-encoding: br`, transferred bytes = sum of `.br` files: honest 1,424,683, extreme 1,211,025 (the per-app `<base href>`
  adds a few bytes to `index.html` compared with the measured build: 1,424,673 / 1,211,018).
- curl: `Accept-Encoding: gzip` → gzip bytes (wasm 430,988 = `.gz` file); no `Accept-Encoding` → plain file with its length;
  `/extreme/counter` → 200 with `index.html`; `/nope` → 404; `.wasm` → `application/wasm`; `/robots.txt` → `Disallow: /`;
  `X-Robots-Tag`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, per-page CSP on every response; no `Server` header;
  `/..%2f..%2fetc/passwd`, `/x.js.br`, `/web.config`, `/.gitignore`, `/.csp.json` → 404, `/%00` → 400, POST → 405.
- Native AOT on the build machine needed a user-local clang/lld and sysroot (`tools/aot-toolchain.sh`, no root). Attempt 1 failed with
  `-fuse-ld=bfd` (no GNU ld), attempt 2 with `cannot find /lib/x86_64-linux-gnu/libmvec.so.1 inside ...sysroot`, attempt 3 passed.
  CI builds it on the GitHub runner of the target OS.
- Pages layout: the robots meta tag costs per page (raw / brotli / gzip): apps' `index.html` +48 / +7..+21 / +29..+30, landing +48 / +10 / +21,
  `report.html` +48 / +70 / +20. It is added only when the Pages site is assembled; the measured artifacts do not have it.

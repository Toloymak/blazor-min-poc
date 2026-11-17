**English** | [Русский](README.ru.md) | [Français](README.fr.md)

# Blazor WebAssembly minification on .NET 11

**Live demo** (GitHub Pages, gzip only): [home](https://toloymak.github.io/blazor-min-poc/) ·
[`Honest` app](https://toloymak.github.io/blazor-min-poc/honest/) · [`Extreme` app](https://toloymak.github.io/blazor-min-poc/extreme/) ·
[detailed report](https://toloymak.github.io/blazor-min-poc/report.html). Source: [github.com/Toloymak/blazor-min-poc](https://github.com/Toloymak/blazor-min-poc).

The result of this project is a measured list of ways to reduce the download size of a Blazor WebAssembly (Blazor WASM) app
on .NET 11 with the stock runtime. Each way comes with its saving in bytes.
The list covers IL trimming with ILLink, feature switches such as `InvariantGlobalization`,
the native relink with the `wasm-tools` workload, Bit.Minifier, `wasm-opt`, terser and a single bundle for all assemblies.
Every size is given as raw bytes, brotli and gzip, so you see the real bundle size that a browser downloads.

The same 3-page app (Home, Counter, Fetch) was built and measured in more than 160 configurations (161 logged runs).
Two final variants are kept: `Honest` and `Extreme`.

## How small can a Blazor WebAssembly app get on .NET 11?

The `dotnet new blazorwasm` template downloads **2,589,350** bytes with brotli.
`Honest`, which keeps stock Blazor APIs, downloads **1,424,673** bytes: 1,164,677 fewer, 45.0% smaller.
`Extreme` downloads **1,211,018** bytes: 1,378,332 fewer, 53.2% smaller.

| Build | Raw bytes | Brotli | gzip -9 | Files | vs template (brotli) |
|---|---:|---:|---:|---:|---:|
| Template baseline (`dotnet new blazorwasm`) | 8,447,649 | 2,589,350 | — | 50 | — |
| Issue #86601 recipe on .NET 11 | 5,404,848 | 1,735,678 | 2,091,866 | 43 | −853,672 |
| `Honest`, round 1 | 4,616,080 | 1,519,331 | 1,823,357 | 43 | −1,070,019 |
| `Extreme`, round 1 | 4,013,671 | 1,333,578 | 1,599,659 | 39 | −1,255,772 |
| **`Honest`, final** | **4,243,612** | **1,424,673** | **1,706,941** | 43 | **−1,164,677** |
| `Honest` + bundle (experiment, not the default) | 4,240,357 | 1,344,434 | 1,675,892 | 8 | −1,244,916 |
| **`Extreme`, final** | **3,851,361** | **1,211,018** | **1,507,342** | 8 | **−1,378,332** |

The issue #86601 row is a public recipe from dotnet/runtime, measured here on .NET 11.
"—" means not measured or not needed.

**Contents**

- [How to reduce Blazor WebAssembly download size](#how-to-reduce-blazor-webassembly-download-size)
  - [1. Install the `wasm-tools` workload and use the native relink](#1-install-the-wasm-tools-workload-and-use-the-native-relink)
  - [2. Trimming and feature-switch settings that save the most](#2-trimming-and-feature-switch-settings-that-save-the-most)
  - [3. Post-processing after publish](#3-post-processing-after-publish-bundle-wasm-opt-terser-native-stubs)
  - [4. Code changes that `Extreme` makes](#4-code-changes-that-extreme-makes)
  - [5. Serve brotli files compressed ahead of time](#5-serve-brotli-files-compressed-ahead-of-time-brotli-vs-gzip)
  - [Settings that did nothing](#settings-that-did-nothing)
  - [Settings that broke the app or the build](#settings-that-broke-the-app-or-the-build)
- [Two final variants: Honest and Extreme](#two-final-variants-honest-and-extreme)
- [How the download size was measured](#how-the-download-size-was-measured)
- [How to get these numbers yourself](#how-to-get-these-numbers-yourself)
- [What Extreme gives up](#what-extreme-gives-up)
- [What stops a Blazor WebAssembly app from getting smaller](#what-stops-a-blazor-webassembly-app-from-getting-smaller)
- [FAQ: Blazor WebAssembly size](#faq-blazor-webassembly-size)
- [Repository layout](#repository-layout)
- [Full log and report page](#full-log-and-report-page)

## How to reduce Blazor WebAssembly download size

The biggest measured savings, in brotli bytes. Each saving was measured alone or as one step on top of earlier steps
(the linked section names the base run), so the savings do not add up exactly.

| Way to reduce the download | Brotli saved | Details |
|---|---:|---|
| Native relink with the `wasm-tools` workload, plus the settings that need it | about 800k to 850k | [Step 1](#1-install-the-wasm-tools-workload-and-use-the-native-relink) |
| `InvariantGlobalization=true` | 657,823 | [Step 2](#2-trimming-and-feature-switch-settings-that-save-the-most) |
| `Extreme` code changes: own router, HTTP through JS `fetch` | 137,828 | [Step 4](#4-code-changes-that-extreme-makes) |
| `EventSourceSupport=false` | 98,849 | [Step 2](#2-trimming-and-feature-switch-settings-that-save-the-most) |
| Bit.Minifier | 91,369 | [Step 2](#2-trimming-and-feature-switch-settings-that-save-the-most) |
| One bundle file for all assemblies | 75,030 | [Step 3](#3-post-processing-after-publish-bundle-wasm-opt-terser-native-stubs) |
| `InvariantTimezone=true`, `BlazorEnableTimeZoneSupport=false` | 64,384 | [Step 2](#2-trimming-and-feature-switch-settings-that-save-the-most) |
| `MetricsSupport=false` | 50,418 | [Step 2](#2-trimming-and-feature-switch-settings-that-save-the-most) |
| `DynamicCodeSupport=false` | 30,502 | [Step 2](#2-trimming-and-feature-switch-settings-that-save-the-most) |
| `WasmEnableSIMD=false` | 27,385 | [Step 2](#2-trimming-and-feature-switch-settings-that-save-the-most) |
| Native function stubs | 23,337 | [Step 3](#3-post-processing-after-publish-bundle-wasm-opt-terser-native-stubs) |
| terser on the JS files | 21,916 | [Step 3](#3-post-processing-after-publish-bundle-wasm-opt-terser-native-stubs) |
| Mono.Cecil metadata pass | 20,134 | [Step 3](#3-post-processing-after-publish-bundle-wasm-opt-terser-native-stubs) |
| `wasm-opt -Oz` | 18,608 | [Step 3](#3-post-processing-after-publish-bundle-wasm-opt-terser-native-stubs) |

Each row's cost (what it breaks or makes slower) is in the linked section.

All numbers are measured brotli deltas from [`results/experiments.jsonl`](results/experiments.jsonl).
"Run" is the id of the measurement in that file. Unless a row says otherwise, a delta is one setting alone on the default
`Honest` app (run `h00-default`, 2,563,523 brotli).

### 1. Install the `wasm-tools` workload and use the native relink

With the `wasm-tools` workload, `dotnet publish` relinks `dotnet.native.wasm` for your app.
The relink alone saves 36,377 on the template (`baseline-norelink` vs `baseline`).
More important, several big settings work only with it: without the relink, `InvariantGlobalization`, `InvariantTimezone`
and `WasmEnableSIMD=false` stop the build (`WasmBuildNative is required ...`), and `EmccLinkOptimizationFlag` is silently ignored.
Without the relink the best results were `Honest` 2,320,504 and `Extreme` 2,186,970 brotli.
With it, the round-1 finals were 1,519,331 and 1,333,578: about 800k to 850k smaller.

```bash
DOTNET_ROOT=$HOME/.dotnet-wasm PATH=$HOME/.dotnet-wasm:$PATH dotnet workload install wasm-tools
```

On Linux the relink also needs `libatomic1` (the node inside the workload uses it):

```bash
sudo apt-get update && sudo apt-get install -y libatomic1
```

The full setup (SDK, workload, node tools) is in [How to get these numbers yourself](#how-to-get-these-numbers-yourself).

### 2. Trimming and feature-switch settings that save the most

These are the safe settings that `Honest` uses. The kept MSBuild properties are in [`Directory.Build.props`](Directory.Build.props) (`SizeProfile=final`).

| Setting | Δ brotli | Run | Cost or note |
|---|---:|---|---|
| `InvariantGlobalization=true` | −657,823 | `s-invglob` | Invariant culture only. Needs the relink (ICU leaves the native file). |
| `EventSourceSupport=false` | −98,849 | `s-noeventsource` | No EventSource diagnostics. |
| Bit.Minifier 11.0.0-pre-20 (`UseBitMinifier=true`) | −91,369 | `s-bitmin` | Build-time package; renames non-public framework names. |
| `InvariantTimezone=true`, `BlazorEnableTimeZoneSupport=false` | −64,384 | `s-invtz` | UTC only. Needs the relink. |
| `MetricsSupport=false` | −50,418 | `s-nometrics` | No metrics. |
| `DynamicCodeSupport=false` | −30,502 | `c-honest-dyncode` (on top of the levers above) | DI and expression trees use slower reflection paths. |
| `WasmEnableSIMD=false` | −27,385 | `s-nosimd` | Slower runtime. Needs the relink. |
| `WasmEnableExceptionHandling=false` | −27,329 | `s-noeh` | Emscripten's JS-based fallback. Only −199 on top of SIMD off (`x-noeh`). |
| `BitMinifyAggressive=true` | −17,176 | `c-honest-bitmin-aggr` (on top) | Public framework names are renamed too (harder to read logs). |
| `EmccLinkOptimizationFlag=-Oz` | −7,598 | `s-linkOz` | Ignored without the relink. |
| `HttpActivityPropagationSupport=false` | −6,477 | `s-nohttpactivity` | No HTTP activity propagation. |
| `EmccExtraLDFlags=-sMALLOC=emmalloc` | −2,089 | `x-emmalloc` (on `Extreme`) | Smaller, simpler allocator. |
| `TrimMode=full` + `TrimmerRootAssembly` for the app | −1,699 | `s-trimfull` | Without the root the app breaks (see below). |
| `StackTraceSupport=false` | −432 | `s-nostacktrace` | No stack traces in exceptions. |
| `TrimmerRemoveSymbols=true`, `DebugType=none`, `GenerateDocumentationFile=false` | −145 | `s-nosymbols` | No debug symbols. |
| `WasmEnableWebcil=false` | +498 | `s-nowebcil` | Bigger alone, −278 in the full chain (`h24-nowebcil`), so kept. |
| `WasmFingerprintDotnetJs=false`, `BlazorFingerprintBlazorJs=false` | +33 | `s-nofingerprint` | About zero (noise). |

The native relink itself (the default with the workload) saves 36,377 on the template (`baseline-norelink` vs `baseline`).

The same settings as a project-file block, taken from [`Directory.Build.props`](Directory.Build.props).
In this repository Bit.Minifier is switched on by `UseBitMinifier` and `BitMinifierVersion`, which add the package reference shown at the end.
`TrimMode=full` also needs the app assembly as a root, as in [`Honest/Honest.csproj`](Honest/Honest.csproj).

```xml
<PropertyGroup>
  <!-- trimming -->
  <TrimMode>full</TrimMode>
  <TrimmerRemoveSymbols>true</TrimmerRemoveSymbols>
  <DebugType>none</DebugType>
  <GenerateDocumentationFile>false</GenerateDocumentationFile>
  <!-- feature switches -->
  <InvariantGlobalization>true</InvariantGlobalization>
  <InvariantTimezone>true</InvariantTimezone>
  <BlazorEnableTimeZoneSupport>false</BlazorEnableTimeZoneSupport>
  <EventSourceSupport>false</EventSourceSupport>
  <HttpActivityPropagationSupport>false</HttpActivityPropagationSupport>
  <MetricsSupport>false</MetricsSupport>
  <StackTraceSupport>false</StackTraceSupport>
  <DynamicCodeSupport>false</DynamicCodeSupport>
  <!-- native relink (needs the wasm-tools workload) -->
  <WasmEnableSIMD>false</WasmEnableSIMD>
  <WasmEnableExceptionHandling>false</WasmEnableExceptionHandling>
  <EmccLinkOptimizationFlag>-Oz</EmccLinkOptimizationFlag>
  <EmccExtraLDFlags>-sMALLOC=emmalloc</EmccExtraLDFlags>
  <!-- publish output -->
  <WasmEnableWebcil>false</WasmEnableWebcil>
  <WasmFingerprintDotnetJs>false</WasmFingerprintDotnetJs>
  <BlazorFingerprintBlazorJs>false</BlazorFingerprintBlazorJs>
  <!-- Bit.Minifier -->
  <BitMinifyAggressive>true</BitMinifyAggressive>
</PropertyGroup>
<ItemGroup>
  <TrimmerRootAssembly Include="$(AssemblyName)" />
  <PackageReference Include="Bit.Minifier" Version="11.0.0-pre-20" PrivateAssets="all" />
</ItemGroup>
```

### 3. Post-processing after publish: bundle, wasm-opt, terser, native stubs

These steps run after `dotnet publish`. They are done by `build.sh` with the scripts in [`tools/`](tools). Measured on `Extreme`.

| Step | Δ brotli | Run | Cost or note |
|---|---:|---|---|
| One bundle file for all 32 assemblies (`tools/bundle.mjs`) | −75,030 | `r2-base-br` → `r2-b-group` | One integrity value for all; no per-assembly caching. Also −32k under gzip. |
| Native function stubs by name (`tools/wasmstub.mjs`) | −23,337 | `r2-x-names` → `f2-extreme` | Stubbed code traps if it ever runs (PDB/zlib, AOT lookups, interpreter SIMD, thread dump). |
| terser on the JS files (round 1) | −21,916 | `e04-minify` | Files must be rebuilt with `build.sh` (integrity values are rewritten). |
| Mono.Cecil metadata pass (`tools/MetaStrip`) | −20,134 | `r2-c1-slim-aggr` → `r2-m-props-notasks` | Reflection over compiler-only attributes, framework properties/events and consts finds nothing. |
| `wasm-opt -Oz` on `dotnet.native.wasm` (round 1) | −18,608 | `e03-wasmopt` | |
| Aggressive terser + smaller boot config | −2,572 | `r2-c1-slim-aggr` | |
| `wasm-opt -tnh --gufa` | −1,509 | `r2-b-group` → `r2-n-tnh-gufa` | `-tnh` assumes traps never happen. |
| `wasm-opt --converge` | −822 | `x-wasmopt-converge` | |

`Honest` with the round-2 post-processing (no bundle, no code change) went from 1,519,331 to 1,424,673 (`f2-honest`, −94,658).

There is no project setting for these steps. Run them the way [`build.sh`](build.sh) does: the Cecil pass, the native stubs,
`wasm-opt` and terser are in [`tools/postprocess.mjs`](tools/postprocess.mjs) (it also writes the new integrity values),
the bundle is [`tools/bundle.mjs`](tools/bundle.mjs). The list of stubbed native functions is `STUBS_DEFAULT` in `build.sh`.

```bash
./build.sh extreme
```

### 4. Code changes that `Extreme` makes

| Change | Δ brotli | Run | Cost or note |
|---|---:|---|---|
| Own router + HTTP through JS `fetch` (no `HttpClient` or System.Text.Json in app code) | −137,828 | `e00-extreme` (vs `Honest` with the same settings) | No `@page` routing, no `HttpClient`. |
| ILLink stubs: `Console.get_Error`, `JsonStreamConfigurationSource.Build` | −16,682 | `x-subst2a` | `Console.Error` is null; `appsettings.json` is ignored. |
| ILLink stub: `DomainNameHelper.TryGetUnicodeEquivalent` | −2,645 | `x-subst2c` | Unicode (IDN) host names are not converted. |
| ILLink stubs: `AddEnvironmentVariables`, culture provider checks | −2,034 | `x-subst` | Environment variables are not in `IConfiguration`. |

The code is in [`Extreme/`](Extreme): the router in `App.razor`, the pages in `Pages/`, the ILLink stubs in `ILLink.Substitutions*.xml`,
switched on in [`Extreme/Extreme.csproj`](Extreme/Extreme.csproj).

### 5. Serve brotli files compressed ahead of time (brotli vs gzip)

Brotli is about 20% smaller than gzip here: `Extreme` is 1,211,018 bytes with brotli and 1,507,342 with gzip,
`Honest` is 1,424,673 and 1,706,941.

`build.sh` compresses every file ahead of time with [`tools/compress.mjs`](tools/compress.mjs): a `.br` file
(brotli quality 11, window 24) and a `.gz` file (gzip level 9) next to each file. The server must send the `.br` file
with `Content-Encoding: br` when the browser accepts brotli. A server that compresses with gzip on the fly sends about the
gzip column instead (its own gzip level may give a bit more). The live demo is served with gzip, so it shows the gzip size.

To see it yourself in Chrome or Edge DevTools:

1. Open the demo, press F12 and go to the **Network** tab.
2. Turn on **Disable cache**.
3. Reload the page. Then click Counter and Fetch.
4. Read the status bar at the bottom: "**transferred**" is what went over the network, "**resources**" is the size after decompression.
5. Compare "transferred" with the gzip column (a server that sends gzip) or the brotli column (a server that sends the `.br` files).
   "Resources" should be close to the raw column.

"Transferred" also counts HTTP headers, so it is a little higher than the sum of the files.
On the live demo the site build also changes `index.html` a little (the `<base href>`, a small deep-link script
and a robots meta tag), so expect a small difference there too.

### Settings that did nothing

About zero bytes each, so they were reverted.

| Setting | Δ brotli | Run |
|---|---:|---|
| `DebuggerSupport=false` | +17 | `s-nodebugger` |
| `UseSystemResourceKeys=true` | +52 | `s-sysreskeys` |
| `MetadataUpdaterSupport=false` | +25 | `s-nometadataupd` |
| `NullabilityInfoContextSupport=false` | −25 | `s-nonullability` |
| `_AggressiveAttributeTrimming=true` | +4 | `s-aggrattr` |
| `UseSizeOptimizedLinq=true` | +46 | `s-sizelinq` |
| `Http3Support=false`, `UseNativeHttpHandler=true` | −57 | `s-nohttp3` |
| `StartupHookSupport=false` | 0 | `x-startuphook` |
| `WasmNativeStrip=true`, `WasmEmitSymbolMap=false`, `WasmEnableThreads=false` | 0 | `h23-strip` |
| `SatelliteResourceLanguages=en` | 0 | `h19-satellite` |
| `-sASSERTIONS=0 -sSTACK_OVERFLOW_CHECK=0` | 0 | `x-noassert` |
| `WasmInitialHeapSize=16777216` | +295 | `x-heap` |
| ILLink stubs for `AppContext.OnProcessExit`, `Environment.StackTrace` and three more | +86 | `r2-u-all` |
| `Microsoft.Extensions.DependencyInjection.DisableDynamicEngine=true` | +13 | `r2-s-didynamic` |
| `System.Globalization.PredefinedCulturesOnly=true` | +5 | `r2-s-cultures` |

The stubbed code stays reachable from other roots, so the stubs change nothing.

### Settings that broke the app or the build

All of these were reverted.

| Setting | What happened |
|---|---|
| `JsonSerializerIsReflectionEnabledByDefault=false` | JS interop breaks: `NoMetadataForType` in `DotNetDispatcher.ParseArguments` (`h11-jsonnoreflect`). |
| `TrimMode=full` without rooting the app assembly | `CtorNotLocated, Honest.Layout.MainLayout` (`h01-trimfull-noroot`). |
| ILLink `--ignore-descriptors true` | The app does not start (`x-ignoredesc`). |
| `WasmBuildNative=false` with `InvariantGlobalization`, `InvariantTimezone` or `WasmEnableSIMD=false` | Build error: `WasmBuildNative is required ...`. |
| `EmccExtraLDFlags=-sFILESYSTEM=0` | Build error: `-sFORCE_FILESYSTEM cannot be used with -sFILESYSTEM=0` (`x-nofs`). |
| `EmccExtraLDFlags=--closure=1` | `google-closure-compiler was not found`; after installing it, a file is missing from the workload pack (`x-closure`, `x-closure2`). |
| ILLink stub for the STJ `EnumConverter` | ILLink crash `IL1012` (`x-subst2b`). |
| Cecil: property metadata removed in all of CoreLib | Mono assertion `object.c:146` (`r2-m-props`). |
| All AOT runtime functions stubbed | `RuntimeError: unreachable` at startup (`r2-x-aot`). |
| jiterpreter exports removed (`wasm-metadce`) | Check fails: the runtime JS needs the exports (`r2-n-jiterp-dce`). |
| `UseMonoRuntime=false` with `WasmEnableExceptionHandling=false` | Build error: CoreCLR needs wasm exception handling (`h28-coreclr`). |

Worked, but worse:

| Setting | Δ brotli | Why reverted |
|---|---:|---|
| `UseMonoRuntime=false` (CoreCLR on wasm) | +422,347 | Works, but much bigger than Mono (`c-honest-coreclr`). |
| `WasmRunWasmOpt=false` | +1,395,714 | Without the SDK pass the native file keeps names and debug data (`r2-n-norunopt`). |
| Bundle including `dotnet.native.wasm` | −79,082 | 4k smaller than the kept bundle, but no streaming compile: first render 381 ms (`r2-b-group-wasm`). |

## Two final variants: Honest and Extreme

Both apps have the same three pages: Home, Counter (a button that counts) and Fetch (loads `data.json`).

- **`Honest`** uses only stock Blazor APIs: `WebAssemblyHostBuilder`, `Router`, `NavLink`, `HttpClient` with System.Text.Json.
  All savings come from MSBuild properties, the native relink, Bit.Minifier and post-processing of the output files.
  There is no code change for size.
- **`Extreme`** is still real Blazor: the stock host builder, the stock renderer and the stock Mono runtime pack.
  But it replaces the `Router` with a small hand-written router, does HTTP through JS `fetch`, stubs some framework
  methods with ILLink substitutions, bundles all assemblies into one file and stubs native functions that this app never calls.
  See [What Extreme gives up](#what-extreme-gives-up).

The work had two rounds. Round 1 tried MSBuild properties, the relink and simple post-processing.
Round 2 worked on `Extreme` only (`Honest` got the same post-processing, without the bundle and without code changes).
Limits in round 2: no fork or custom build of the runtime, and the stock Blazor host and renderer stay.

## How the download size was measured

**Metric.** The sum of the bytes of exactly the files a browser downloads on a cold first load of `/`
plus a visit to every page (Counter and Fetch, inside the app). Each file is compressed with brotli quality 11, window 24.
gzip uses level 9. "Raw" is the size without compression.

- **File list.** A headless Chromium (Playwright 1.65.1) loads the app with an empty cache.
  The list of files comes from the browser network log, not from a folder listing.
- **Served bytes (round 2).** The app is served from the final `.br` files with `Content-Encoding: br`
  (`SERVE_ENCODED=br` mode of `tools/serve.mjs`). The bytes transferred, read from the network log, equal the sum of the `.br` files.
  The round-1 `Extreme` final gives 1,333,578 bytes both ways (run `r2-base-br`), so the two rounds can be compared.
- **Compression code.** Node's zlib. It gives the same bytes as `brotli -q 11`.

**Environment.**

- .NET SDK 11.0.100 (`global.json`, roll-forward disabled), `Microsoft.AspNetCore.Components.WebAssembly` 11.0.0.
- `wasm-tools` workload, stock Mono runtime pack, Release publish.
- binaryen 125.0.0 (`wasm-opt`, the npm package pinned in `tools/package-lock.json`), terser 5.51.2, Playwright 1.65.1, Bit.Minifier 11.0.0-pre-20, Node.js v24.21.0.
- Experiments ran on Ubuntu 22.04 on WSL2 (12 cores, 39 GB RAM). The CI build runs on `ubuntu-24.04`.
  Only the no-workload template row was measured on macOS.

**Functional check** (`tools/check.mjs`). A build is kept only if all of this passes:

- Home renders.
- The nav link to Counter works without a full page reload.
- Two clicks show `Current count: 2`.
- Fetch shows the text from `data.json`, and `data.json` is in the network log.
- Back and forward work.
- A direct load of `/counter` in a fresh browser context works and counts (deep link).
- Zero console errors, page errors and failed requests.
- With `SERVE_ENCODED` set: every downloaded file was served from its precompressed file.

**Stress page and canary (native stubs).** A stubbed native function traps when it is called.
To prove that a trap is caught, run `r2-x-canary` stubs `mono_wasm_load_runtime`, a function that does run: the check fails loudly.
Every kept stub group also had to pass a stress page (`tools/stress/Stress.razor`), built only into a test copy of the app
(`ExtremeStress`) and never shipped. It covers exceptions, try/finally, GC under load, number and date formatting and parsing,
`Guid`, LINQ, `Dictionary`, strings, delegates, `Task.Delay` and a failed HTTP request (404). It needs 15 of 15.

## How to get these numbers yourself

These steps are for a clean Linux x64 machine (the experiments used Ubuntu 22.04). They follow
the "Build machine tooling" section of [`RESULTS.md`](RESULTS.md), [`build.sh`](build.sh) and [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

**1. .NET SDK 11.0.100 and the `wasm-tools` workload** (user-local, no sudo):

```bash
curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
bash /tmp/dotnet-install.sh --version 11.0.100 --install-dir "$HOME/.dotnet-wasm" --no-path
DOTNET_ROOT=$HOME/.dotnet-wasm PATH=$HOME/.dotnet-wasm:$PATH dotnet workload install wasm-tools
```

**2. `libatomic1`.** The node that ships with emscripten in the workload needs it. Without it every native relink fails.

```bash
sudo apt-get update && sudo apt-get install -y libatomic1
```

**3. binaryen (`wasm-opt`)** needs no separate install: `build.sh` uses the pinned npm package `binaryen` 125.0.0 from
`tools/` (installed in step 5). It gives the same bytes as the binaryen `version_125` release (same sha256 of the final `dotnet.native.wasm`).

**4. Node.js 24.** The repository does not script this step. The experiments used v24.21.0, which was already installed on the
build machine (no install command was run); CI uses `actions/setup-node` with Node 24.

**5. Clone this repository**, then install the node tools and the headless browser:

```bash
cd tools && npm ci && npx playwright install --with-deps chromium-headless-shell
```

`--with-deps` installs the browser's system libraries with `sudo apt-get`. Without root, use
`npx playwright install chromium-headless-shell` (that is enough if the libraries are already there).

**6. Build both variants**, from the repository root (`cd ..` after step 5). `build.sh` always loads [`scripts/build-env.sh`](scripts/build-env.sh).
It does nothing when `dotnet` and `node` are on `PATH`; it only adds a user-local SDK in `~/.dotnet-wasm` (and similar folders) when they exist.

```bash
./build.sh honest            # -> artifacts/honest/wwwroot
./build.sh extreme           # -> artifacts/extreme/wwwroot
```

**7. Check and measure.** This runs the functional check, then sums the sizes over the files the browser downloaded:

```bash
./measure.sh artifacts/honest honest
./measure.sh artifacts/extreme extreme
```

The `COLD-LOAD` line should show:

| Variant | files | raw | brotli | gzip9 |
|---|---:|---:|---:|---:|
| `honest` | 43 | 4,243,612 | 1,424,673 | 1,706,941 |
| `extreme` | 8 | 3,851,361 | 1,211,018 | 1,507,342 |

**Note: the totals depend a little on where the build runs** (folder path and SDK location).
The SDK puts a fingerprint into some file names (for example `dotnet.native.<fingerprint>.wasm`).
It takes the fingerprint before the function-name section is stripped, and that section depends on the build paths.
The names are written into the boot config inside `dotnet.js`, so the totals move a little.

- A second folder on the same machine: `Honest` 1,424,691 brotli (+18), `Extreme` 1,211,016 (−2).
  Raw totals and the sha256 of the final `dotnet.native.wasm` were the same.
- The first CI build on a GitHub runner: `Honest` raw 4,243,654, brotli 1,425,104, gzip 1,707,048, 43 files (+431 brotli, +42 raw);
  `Extreme` raw 3,851,404, brotli 1,211,189, gzip 1,507,487, 8 files (+171 brotli, +43 raw). That is about 0.03% and 0.01%.

The live demo shows the numbers of its own CI build, so they differ from this README by about that much.
The tables in this README keep the measured local finals.

To serve the `.br` files with `Content-Encoding: br` during the check (the round-2 gate), set `SERVE_ENCODED=br`:

```bash
SERVE_ENCODED=br ./measure.sh artifacts/extreme extreme
```

It then also prints a `SERVED` line. `equal=true` means the transfer equals the sum of the `.br` files.

**8. Optional: the stress page** for the native stubs:

```bash
./build.sh extreme-stress
node tools/stress.mjs artifacts/extreme-stress/wwwroot
```

**Known pitfalls**

- **The `wasm-tools` workload is required.** Without the native relink, `InvariantGlobalization`, `InvariantTimezone`
  and `WasmEnableSIMD=false` stop the build (`WasmBuildNative is required ...`), and `EmccLinkOptimizationFlag` is silently ignored.
  The best results without relink were `Honest` 2,320,504 and `Extreme` 2,186,970 brotli.
- **`libatomic1`.** Without it the relink fails with `libatomic.so.1: cannot open shared object file` and `... failed (returned 127)`.
- **Checkout path.** Before `PathMap` was added, a build from a different folder differed by 3 brotli bytes (the path was in the app assembly).
  `PathMap` in [`Directory.Build.props`](Directory.Build.props) removes that for the app assembly.
  A few bytes can still move through the fingerprints in file names (see the note after the expected numbers).
- **macOS is not tested** for the full build. `dotnet workload install wasm-tools` failed there with "Inadequate permissions".
- **Other SDK install folders.** `build.sh` and `tools/step.sh` both load `scripts/build-env.sh`. It only adds `~/.dotnet-wasm`
  when it exists, so an SDK anywhere else works as long as `dotnet` is on `PATH`.
- **Small differences.** If your numbers differ, check the SDK version (`dotnet --version`), the workload and the tool versions above.
  The bundle has one integrity value, so a changed byte anywhere in it changes the whole file.

## What Extreme gives up

Still real Blazor: Razor components rendered by the stock `WebAssemblyRenderer`, started by the stock `WebAssemblyHostBuilder`,
on the stock Mono runtime pack. binaryen and terser only rewrite the output files.

Lost in `Extreme` on top of `Honest`:

- No `@page` routing: no route templates, parameters or constraints, no `NotFound` page, no `FocusOnNavigate`,
  no `NavLink` active class, no lazy-loaded assemblies by route.
- No `HttpClient` service and no `System.Net.Http`. HTTP only through JS interop.
- Environment variables are not in `IConfiguration`. `appsettings.json` and `appsettings.{env}.json` are ignored.
- `Console.Error` is null: if a root-component update fails, writing the error throws instead of printing.
- Unicode (IDN) host names in `Uri` are not converted.
- Round 2: loading an assembly with a PDB, or anything that needs zlib inside the runtime, traps.
  AOT-compiled assemblies cannot be used. Interpreter SIMD paths and the runtime thread dump trap.
- Round 2: reflection over compiler-only attributes (for example `[CompilerGenerated]`, `[Nullable]`) returns nothing.
  Reflection over properties and events of framework types (outside `System`, `System.Threading*`, `System.Runtime*` in CoreLib)
  finds none. Framework `const` fields are not visible to reflection.
- The bundle fails as a whole if one byte changes. There is no per-assembly caching.
- The post-processed files must be rebuilt with `build.sh`. A hand edit breaks loading.

Lost in both variants (settings): culture-specific formatting, time zones (UTC only), EventSource, metrics and diagnostics,
stack traces in exceptions, dynamic code paths, SIMD (slower runtime), wasm exception handling (JS fallback), the debugger,
and readable framework names in logs.

## What stops a Blazor WebAssembly app from getting smaller

`Extreme` final, brotli: native 359,489 · JS 98,729 · managed 752,074 (the bundle) · HTML and data 726.
Going lower in any of these parts needs changes that this project kept out of scope:
no fork or custom build of the runtime, and the stock Blazor host and renderer stay.

| Part | Brotli | What is left | What going lower needs |
|---|---:|---|---|
| Native (`dotnet.native.wasm`) | 359,489 | Mono interpreter, GC, metadata loader, marshalling, emmalloc, libc | A custom runtime build |
| JS | 98,729 | `dotnet.runtime.js` 47,048 (with the jiterpreter), `blazor.webassembly.js` 22,808, `dotnet.native.js` 17,573, `dotnet.js` 11,300 | Changes to the runtime or Blazor JS logic |
| Managed (`b.bin`) | 752,074 | CoreLib 408,929 and System.Text.Json 120,906 (each compressed alone) | A custom host or renderer, so JS interop stops using reflection-based JSON |

Native + JS + CoreLib + System.Text.Json alone are 988,053 bytes. These parts get smaller only with changes
to the runtime itself, to its JS, or to the Blazor host.

**If a runtime fork were allowed (estimates from research, not measurements).**
Native part: about 22–27K brotli less with different build flags on stock source, about 42–57K with small patches,
about 60–95K with deep changes. With JS and CoreLib included: about 95–160K (small patches) to about 140–250K (deep changes).
The cost: an own runtime pack that must be rebuilt on every monthly servicing release, late security fixes, and no vendor support.

## FAQ: Blazor WebAssembly size

**How small can a Blazor WebAssembly app get on .NET 11?**
In this project, 1,211,018 bytes brotli for `Extreme` (8 files) and 1,424,673 for `Honest` with stock Blazor APIs.
The `dotnet new blazorwasm` template is 2,589,350.

**Does the `wasm-tools` workload matter?**
Yes, a lot. Without the native relink the best results were `Honest` 2,320,504 and `Extreme` 2,186,970 brotli.
With the relink, the round-1 finals (which can also use the settings that need relink) were 1,519,331 and 1,333,578: about 800k to 850k smaller.

**Which single setting saves the most?**
`InvariantGlobalization=true`: −657,823 brotli alone, −661,194 in the serial chain. ICU data leaves the download, and the relink
removes ICU from the native file.

**Is turning SIMD off worth it?**
`WasmEnableSIMD=false` gives −27,385 alone (−28,098 in the chain). The runtime is slower; this demo accepts that.

**How much smaller is brotli than gzip?**
About 20% for `Extreme`: 1,211,018 brotli against 1,507,342 gzip.
The live demo is served with gzip, so it shows the gzip size.

**Can it go lower without a runtime fork?**
No more ways were found with the stock runtime and the stock Blazor host. Native + JS + CoreLib + System.Text.Json alone
are already 988,053 bytes, and these parts need changes to the runtime or the host to get smaller.
See [What stops a Blazor WebAssembly app from getting smaller](#what-stops-a-blazor-webassembly-app-from-getting-smaller).

**Is CoreCLR on wasm smaller than Mono?**
No. `UseMonoRuntime=false` works, but it is +422,347 brotli bigger than Mono.

## Repository layout

| Path | What it is |
|---|---|
| `Baseline/` | The `dotnet new blazorwasm` template, the starting point. |
| `Issue86601/` | The recipe from dotnet/runtime issue #86601 (empty template, invariant globalization). Has its own `Directory.Build.props`. |
| `Honest/` | The `Honest` app (stock `Router`, `NavLink`, `HttpClient`). |
| `Extreme/` | The `Extreme` app and its ILLink substitution files (`ILLink.Substitutions*.xml`). |
| `Directory.Build.props` | Shared settings for `Honest` and `Extreme`: the kept MSBuild levers (`SizeProfile=final`), `PathMap`, `NativeNames`. |
| `global.json` | Pins SDK 11.0.100. |
| `build.sh` | The final recipe: publish, Cecil pass, native stubs, `wasm-opt`, terser, bundle (`Extreme`), `.br`/`.gz` files. |
| `measure.sh` | Functional check, then sizes over the files the browser downloaded. |
| `scripts/build-env.sh` | Optional `PATH` / `DOTNET_ROOT` for a user-local SDK; does nothing when the tools are on `PATH`. |
| `tools/check.mjs` | The functional check (Playwright) and the network log. |
| `tools/measure.mjs` | Raw, brotli and gzip sizes over the downloaded files. |
| `tools/serve.mjs` | Static server for the check (SPA mode, Pages-like mode, `SERVE_ENCODED`). |
| `tools/postprocess.mjs`, `tools/MetaStrip/`, `tools/wasmstub.mjs`, `tools/bundle.mjs`, `tools/compress.mjs` | The post-processing steps used by `build.sh`. |
| `tools/stress/`, `tools/make-stress.sh`, `tools/stress.mjs` | The stress page for the native stubs (test copy only, never shipped). |
| `tools/step.sh`, `tools/matrix.sh`, `tools/run-steps.sh`, `steps/` | One measured experiment, many in parallel, and the experiment lists. |
| `tools/collect.mjs`, `tools/result.mjs` | Write measured runs into `results/experiments.jsonl`. |
| `tools/assemble-site.mjs`, `tools/pages-deeplink.mjs`, `tools/final.sh` | Build the demo site and check it under a sub-path. |
| `tools/build-report.mjs` | The detailed report page, made from the log. |
| `tools/levers.mjs` | The shared list of the 14 ways shown on the landing page and the report page; it reads the numbers from the log. |
| `tools/AsmSize/`, `tools/why.py`, `tools/grep-props.sh`, `tools/native-symbols.sh`, `tools/native-stub-estimate.sh` | Analysis tools (IL size, why ILLink kept a type, which properties the SDK reads, native function sizes). |
| `RESULTS.md` | The full written log of both rounds. |
| `results/` | `experiments.jsonl` (one line per run). The small `meta-*.json` inputs it was made from, the per-run trace folders (`runs/<id>/`) and the named native analysis build (`native-symbols/`) are kept locally, not published. |
| `.github/workflows/pages.yml` | The GitHub Pages build and deploy. |
| `Host/` | The App Service host: a small ASP.NET Core app that serves the `.br`/`.gz` files (`Program.cs`), its `web.config` for Windows, and `iis-static/web.config` (IIS-only option, not tested). |
| `docs/hosting.md`, `docs/hosting.ru.md` | How the demo is hosted: GitHub Pages and Azure App Service. |
| `.github/workflows/azure.yml` | The manual Azure App Service build and deploy (Native AOT host). |
| `tools/host-gate.sh`, `tools/site-check.mjs`, `tools/aot-toolchain.sh` | The host gate (both apps through the host, curl and security checks, idle resources) and a user-local clang for Native AOT on a machine without a C toolchain. |

`artifacts/` and `out/` are build outputs and are not in git. Some scripts in `tools/` (parallel runs, gates) were used for the
experiments on the Linux build machine; they need only the tools listed above.

## Full log and report page

- [`RESULTS.md`](RESULTS.md): the written log of both rounds, with every error text.
- [`results/experiments.jsonl`](results/experiments.jsonl): one JSON line per measured run (more than 160 runs), with settings, sizes,
  per-file sizes, check result, decision and reason. The raw trace files of each run were kept locally and are not published.

The detailed report page (charts, all runs with filters, per-file tables) is made from the log:

```bash
node tools/build-report.mjs report.html
```

The demo site has this page as `report.html` next to the landing page (`tools/assemble-site.mjs` calls the same script).
`--standalone` is still accepted and does nothing.

**English** | [Русский](hosting.ru.md)

# Hosting the demo: GitHub Pages and Azure App Service

This page is part of the [README](../README.md). It describes how the demo site is built and served.

## Hosting on GitHub Pages

The workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) ("Blazor WebAssembly minification demo - GitHub Pages") runs on every push to
`main` and can also be started by hand. It installs the same tools as [How to get these numbers yourself](../README.md#how-to-get-these-numbers-yourself), runs `./build.sh honest` and `./build.sh extreme`,
measures both, builds the site with `tools/assemble-site.mjs` under the Pages base path, checks both apps there with a Pages-like
server, and deploys.

One-time steps:

1. Make the repository public. Free GitHub Pages needs a public repository; a private one needs a paid plan.
2. Push `main`.
3. In **Settings → Pages**, set **Source** to **GitHub Actions**.

The site has a small landing page with the measured sizes, and the two apps under `honest/` and `extreme/`.
Pages has no SPA fallback, so deep links work through route copies (`counter.html`, `fetch.html`) and a root `404.html` that redirects.
The site also has `robots.txt` and a robots meta tag.

GitHub Pages serves gzip only, so the transfer there is close to the gzip column (see [Serve brotli files compressed ahead of time](../README.md#5-serve-brotli-files-compressed-ahead-of-time-brotli-vs-gzip)).

<!-- APP-SERVICE:START -->

## Hosting on Azure App Service (brotli)

GitHub Pages only sends gzip. To serve the build's own brotli files, the repository has a tiny host app, [`Host/`](../Host/),
and a manual workflow, [`.github/workflows/azure.yml`](../.github/workflows/azure.yml), for an existing App Service plan
(tested size: B1). It works on a Windows or a Linux plan.

**What the host does.** For a request to `X` it sends `X.br` with `Content-Encoding: br` when the browser accepts brotli,
else `X.gz` with gzip, else the plain file. It never compresses on the fly. The file table is built once at start-up, so
there is no disk scan per request and no file is held in memory (`SendFileAsync`). Unknown paths under `/honest/` or
`/extreme/` get that app's `index.html` (status 200), anything else is 404. Fingerprinted files are cached for a year;
`index.html`, `dotnet.js`, `blazor.webassembly.js`, `data.json` and the bundle `b.bin` use `no-cache` (the page carries the
bundle's integrity value). Every response has `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a Content-Security-Policy with the hashes of each page's inline
scripts (no `'unsafe-inline'` for scripts). `/robots.txt` disallows everything. Only GET and HEAD.

**Idle resources** (measured on the Linux build machine, linux-x64; Windows was not measured):

| Build | Disk | First response after start | RSS after start | after a cold load of both apps | after 5 min idle | Threads (idle) | CPU over 1 idle minute |
|---|---:|---:|---:|---:|---:|---:|---:|
| Framework-dependent `net10.0` | 0.1 MB (+ runtime) | 127 ms | 53.5 MB | 61.9 MB | 63.5 MB | 15 | 0.017 % |
| Self-contained, trimmed | 26.5 MB | 295 ms | 31.9 MB | 37.0 MB | 38.2 MB | 13 | 0 % |
| **Native AOT (used)** | 6.1 MB | **20 ms** | **12.5 MB** | **17.0 MB** | **15.4 MB** | 10 | 0 % |

The workflow deploys the Native AOT build. All three passed the same gate: both apps through the host, zero console errors,
every `_framework` response brotli-encoded, transferred bytes equal to the sum of the `.br` files
(honest 1,424,683, extreme 1,211,025 — a few bytes more than the measured build because `<base href>` changes per app).

**Tested and not tested.** Tested on Linux only (the host binary, the site and all checks on the build machine).
Not tested: a real deploy to Azure, the Windows plan (ASP.NET Core Module, out-of-process), and the "IIS only" option below.

**One-time setup**

1. Create the web app in your existing plan.
   - Portal: **App Services → Create → Web App**, pick the resource group and **the existing plan** (its OS decides Windows or
     Linux). **Publish: Code**, **Runtime stack: .NET 10 (LTS)**. The host is a self-contained executable, so the stack is only
     needed for the platform image.
   - CLI (Linux plan): `az webapp create -g <resource-group> -p <plan-name> -n <app-name> --runtime "DOTNETCORE:10.0"`
   - CLI (Windows plan): `az webapp create -g <resource-group> -p <plan-name> -n <app-name> --runtime "dotnet:10"`
   - The exact runtime names change over time: `az webapp list-runtimes --os linux` / `--os windows` lists them.
2. Linux only: set the start-up command (**Configuration → General settings → Startup Command**):
   `chmod +x /home/site/wwwroot/Host && /home/site/wwwroot/Host`
   (CLI: `az webapp config set -g <resource-group> -n <app-name> --startup-file "chmod +x /home/site/wwwroot/Host && /home/site/wwwroot/Host"`).
   On Windows nothing is needed: the workflow writes a `web.config` that starts `Host.exe` out-of-process and turns IIS compression off.
3. Get the publish profile: **Overview → Download publish profile** (CLI: `az webapp deployment list-publishing-profiles -g <resource-group> -n <app-name> --xml`).
   If the download is disabled, turn on **Configuration → General settings → SCM Basic Auth Publishing Credentials**.
4. In GitHub: **Settings → Environments → New environment `azure-demo`**, add the deployment branch rule `main`, and add the
   environment secret `AZURE_WEBAPP_PUBLISH_PROFILE` (the whole XML file). Then **Settings → Secrets and variables → Actions → Variables**:
   `AZURE_WEBAPP_NAME` = the app name, `AZURE_WEBAPP_OS` = `linux` or `windows`. Optional `AZURE_WEBAPP_HOST` = `iis` (see below).
5. Run it: **Actions → "Blazor WebAssembly minification demo - Azure App Service" → Run workflow** on `main`.
   The last step checks over HTTPS that the wasm and the bundle arrive with `content-encoding: br` and the exact `.br` length.

**Check brotli yourself.** Open the site, DevTools → **Network**, tick **Disable cache**, reload. Add the column
**Content-Encoding** (right-click the header row): `_framework` files show `br`. The **Transferred** total should be close to the brotli column.

**Settings that lower idle use** (names as in the portal / CLI; set them yourself):
- **Always On** off (`az webapp config set --always-on false`): the app is unloaded after 20 minutes without requests, so idle use is zero.
  The next visitor waits for the platform cold start plus the host's own start (20 ms for the AOT host, measured).
- **Session affinity (ARR affinity)** off (`az webapp update --client-affinity-enabled false`): the app has no sessions.
- **Application Insights**, **App Service logs** and **Health check** off: each adds requests or an agent.
- **Platform: 64 Bit** on Windows (`--use-32bit-worker-process false`): the AOT host is a 64-bit executable.
- **HTTP version 2.0** (`--http20-enabled true`): fewer connections for the many small files.

**Windows without an app process (not tested).** With `AZURE_WEBAPP_HOST=iis` on a Windows plan the workflow deploys only the
files plus [`Host/iis-static/web.config`](../Host/iis-static/web.config): URL Rewrite rules make IIS itself serve `X.br` with
`Content-Encoding: br`. It is based on Microsoft's sample for Blazor WebAssembly on IIS, but it has not been run on IIS.

**Can App Service change our encoded responses?** On Windows, IIS compression is turned off in the generated `web.config`
(`urlCompression`), so IIS has nothing to add. On Linux the platform passes the app's response through. Neither was checked on a real
App Service yet; the workflow's last step is that check.
<!-- APP-SERVICE:END -->

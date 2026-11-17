#!/usr/bin/env bash
# Final gate on the Linux build machine: build both variants with build.sh, check + measure, assemble the Pages site
# under a made-up sub-path and run the functional check there with a Pages-like server; lint the workflow.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; cd "$root"
source scripts/build-env.sh
# experiment rows first (they reuse artifacts/<variant>), the final builds last so artifacts/ holds them
BUILD_SH=honest SERVE_ENCODED=br BUNDLE=1 tools/step.sh Honest f2-honest-bundle
BUILD_SH=honest SERVE_ENCODED=gzip tools/step.sh Honest f2-honest-gz
BUILD_SH=extreme SERVE_ENCODED=gzip tools/step.sh Extreme f2-extreme-gz
BUILD_SH=honest SERVE_ENCODED=br tools/step.sh Honest f2-honest
BUILD_SH=extreme SERVE_ENCODED=br STRESS=1 tools/step.sh Extreme f2-extreme
echo "=== assemble site under /some-repo/ ==="
node tools/assemble-site.mjs /some-repo/ out/_site out/f2-honest.netlog.sizes.json out/f2-extreme.netlog.sizes.json --repo https://github.com/example/blazor-min-poc
for v in honest extreme; do
  echo "=== Pages gate: $v under /some-repo/$v/ ==="
  SITE_DIR=out/_site SITE_PREFIX=/some-repo/ BASE_PATH=/some-repo/$v/ PORT=5090 node tools/check.mjs out/_site/$v out/pages-$v.netlog.json && echo "PAGESGATE $v PASS" || echo "PAGESGATE $v FAIL"
  BASE_PATH=/some-repo/$v/ node tools/measure.mjs out/_site/$v out/pages-$v.netlog.json pages-$v | grep COLD
done
node tools/pages-deeplink.mjs out/_site /some-repo/ && echo "DEEPLINK PASS"
node tools/site-check.mjs pages out/_site /some-repo/
echo "=== actionlint ==="
# actionlint is not downloaded here (no unchecked downloads); use one that is already installed
AL=$(command -v actionlint || echo "$HOME/.local/bin/actionlint")
if [ -x "$AL" ]; then "$AL" -version | head -1; "$AL" .github/workflows/pages.yml .github/workflows/azure.yml && echo "ACTIONLINT OK"; else echo "actionlint not installed: workflows not linted"; fi

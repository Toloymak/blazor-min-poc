#!/usr/bin/env bash
# Usage: ./measure.sh <publish-dir-or-wwwroot> [label] [netlog.json]
# Runs the functional check (cold load + all pages, network log), then sums raw + brotli -q11 bytes
# over exactly the files the browser downloaded. Without a netlog arg the check is run here.
# Env for check: FETCH_PATH, DATA_FILE, DATA_TEXT.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
d="$1"; [ -d "$d/wwwroot" ] && d="$d/wwwroot"
label="${2:-$(basename "$(dirname "$d")")}"
log="${3:-}"
if [ -z "$log" ]; then
  log="$(dirname "$d")/netlog.json"
  node "$here/tools/check.mjs" "$d" "$log"
fi
node "$here/tools/measure.mjs" "$d" "$log" "$label"

#!/usr/bin/env bash
# One measured step: clean, publish, optional post-process, functional check + size measure.
# Usage: tools/step.sh <ProjectDir> <label> [msbuild -p: args...]
# Env: FETCH_PATH / DATA_FILE / DATA_TEXT / LOAD_ONLY for the check; POST=1 (+WASMOPT=1, MINIFY=1) post-process; PORT.
# Writes out/<label>/ (publish), out/<label>.result.json (facts for results/experiments.jsonl) and out/<label>.run/ (trace files).
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/scripts/build-env.sh"
proj="$1"; label="$2"; shift 2
# experiments start from no kept levers unless they say otherwise
[ -z "${BUILD_SH:-}" ] && case " $* " in *SizeProfile=*) ;; *) set -- -p:SizeProfile=none "$@" ;; esac
[ "$root/tools/package-lock.json" -nt "$root/tools/node_modules/.package-lock.json" ] && (cd "$root/tools" && npm ci >/dev/null 2>&1)
out="$root/out/$label"; run="$out.run"
rm -rf "$root/$proj/bin" "$root/$proj/obj" "$out" "$run" "$out".*; mkdir -p "$out" "$run"
echo "=== step $label: $proj $* ==="
start=$(date +%s)
build=ok; build_error=""; chk=not-run; ns=""; relinked=""; nsfinal=""
export STEP_PROJECT="$proj" STEP_LABEL="$label" STEP_PROPS="$*" STEP_POST="${BUILD_SH:+build.sh $BUILD_SH }${POST:+post:${WASMOPT:+wasmopt,}${MINIFY:+minify} }${BUNDLE:+bundle:${BUNDLE_ORDER:-group}${BUNDLE_WASM:++wasm} }${SERVE_ENCODED:+served:$SERVE_ENCODED}"
if [ -n "${BUILD_SH:-}" ]; then pub() { "$root/build.sh" "$BUILD_SH" && rm -rf "$out" && cp -a "$root/artifacts/$BUILD_SH" "$out"; }; else pub() { dotnet publish "$root/$proj" -c Release -o "$out" "$@"; }; fi
if ! pub "$@" > "$out.publish.log" 2>&1; then
  build=failed; build_error="$(grep -E ' error |error :|: error' "$out.publish.log" | sed 's/ \[.*\]$//' | sort -u | head -3 | tr '\n' ' ')"
  echo "$build_error"
else
  grep -E 'warning (IL|BITMIN|WASM|NETSDK)' "$out.publish.log" | sed 's/\[.*\]//' | sort -u | head -10
  grep -h -E "Linking with emcc|Compiling native sources with emcc|Bit.Minifier|BITMIN|minif" "$out.publish.log" | sed 's/^ *//' | sort -u | head -6
  pack="$DOTNET_ROOT/packs/Microsoft.NETCore.App.Runtime.Mono.browser-wasm/11.0.0/runtimes/browser-wasm/native/dotnet.native.wasm"
  nat=$(ls "$out"/wwwroot/_framework/dotnet.native*.wasm 2>/dev/null | head -1)
  if [ -n "$nat" ]; then
    ps=$(sha256sum "$pack" | cut -d' ' -f1); ns=$(sha256sum "$nat" | cut -d' ' -f1)
    [ "$ps" = "$ns" ] && relinked=false || relinked=true
    echo "NATIVE $label published=${ns:0:16}/$(stat -c %s "$nat") pack=${ps:0:16}/$(stat -c %s "$pack") $([ "$relinked" = false ] && echo IDENTICAL-TO-PACK || echo RELINKED)"
  fi
  if [ -n "${POST:-}" ]; then
    node "$root/tools/postprocess.mjs" "$out/wwwroot" > "$run/postprocess.log" 2>&1 || { build=failed; build_error="postprocess: $(tail -2 "$run/postprocess.log" | tr '\n' ' ')"; }
    cat "$run/postprocess.log"
  fi
  if [ -z "${BUILD_SH:-}" ] && [ -n "${BUNDLE:-}" ] && [ "$build" = ok ]; then node "$root/tools/bundle.mjs" "$out/wwwroot" | tee -a "$run/postprocess.log" || { build=failed; build_error="bundle failed"; }; fi
  if [ -z "${BUILD_SH:-}" ] && [ -n "${SERVE_ENCODED:-}" ] && [ "$build" = ok ]; then node "$root/tools/compress.mjs" "$out/wwwroot" >/dev/null; fi
  [ -n "$nat" ] && [ -f "$nat" ] && nsfinal=$(sha256sum "$nat" | cut -d' ' -f1)
fi
if [ "$build" = ok ]; then
  if node "$root/tools/check.mjs" "$out/wwwroot" "$out.netlog.json" > "$run/check.log" 2>&1; then chk=pass; else chk=fail; grep -E "FAIL|ERRORS" "$run/check.log"; fi
  node "$root/tools/measure.mjs" "$out/wwwroot" "$out.netlog.json" "$label" | tee "$run/sizes.txt"
  if [ -n "${STRESS:-}" ]; then
    # same build settings, ExtremeStress project (Extreme + /stress page), same stubs: every stress action must pass
    ( cd "$root" && BUILD_PROPS="${BUILD_PROPS:-}" ./build.sh extreme-stress > "$run/stress-build.log" 2>&1 ) && node "$root/tools/stress.mjs" "$root/artifacts/extreme-stress/wwwroot" | tee "$run/stress.log" || echo "STRESS FAILED (build or run)" | tee -a "$run/stress.log"
    grep -q "STRESS PASSED" "$run/stress.log" || chk=fail
  fi
  cp "$out.netlog.sizes.json" "$run/sizes.json"; cp "$out.netlog.json" "$run/netlog.json"
fi
grep -E 'warning|error|emcc|Bit.Minifier|BITMIN' "$out.publish.log" | sed 's/ \[.*\]$//' | sort -u | head -60 > "$run/build-log-slice.txt"
dur=$(( $(date +%s) - start ))
STEP_BUILD="$build" STEP_BUILD_ERROR="$build_error" STEP_CHECK="$chk" STEP_NATIVE_SHA="$nsfinal" STEP_NATIVE_SHA_PREPOST="$ns" STEP_RELINKED="$relinked" STEP_DURATION="$dur" \
  node "$root/tools/result.mjs" "$run" > "$out.result.json"
cold=$(grep COLD-LOAD "$run/sizes.txt" 2>/dev/null)
echo "STEPRESULT $label build=$build check=$chk $cold (${dur}s)"

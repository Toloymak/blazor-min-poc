#!/usr/bin/env bash
# Full publish of one variant with every kept size lever and post-processing step.
# Used on the Linux build machine and by CI (.github/workflows/pages.yml) - the single copy of the recipe.
# Usage: ./build.sh honest|extreme      -> artifacts/<variant>/wwwroot (+ .br/.gz of every file)
# Needs: .NET SDK 11.0.100 + wasm-tools workload, node (tools/ npm deps), binaryen wasm-opt.
# Every step can be overridden by env for experiments (tools/step.sh); with no env set this is the measured final state.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/scripts/build-env.sh"   # no-op when the tools are already on PATH
v="${1:?usage: build.sh honest|extreme}"
case "$v" in honest) proj=Honest ;; extreme) proj=Extreme ;; extreme-stress) proj=ExtremeStress; "$here/tools/make-stress.sh" ;; *) echo "unknown variant $v" >&2; exit 2 ;; esac
out="$here/artifacts/$v"
rm -rf "$here/$proj/bin" "$here/$proj/obj" "$out"
[ -d "$here/tools/node_modules/terser" ] && [ -d "$here/tools/node_modules/binaryen" ] || (cd "$here/tools" && npm ci)

FEATURES="--enable-bulk-memory@--enable-bulk-memory-opt@--enable-exception-handling@--enable-nontrapping-float-to-int@--enable-sign-ext@--enable-mutable-globals@--enable-reference-types@--enable-multivalue"
# Native functions replaced by `unreachable` (then removed by wasm-opt): code an interpreter-only, invariant-culture
# browser app never runs. Each group was traced with tools/stress.mjs (RESULTS.md, "Round 2").
STUBS_DEFAULT='^(mono_debug_open_image|inflate|inflateInit.*|inflate_fast|inflate_table|inflateStateCheck|inflateReset.*|inflateEnd|zcalloc|zcfree|crc32|crc32_z|adler32.*|mono_ppdb_.*|interp_emit_simd_intrinsics|emit_sri_packedsimd|emit_common_simd_operations|emit_common_simd_epilogue|emit_vector_create|mono_wasm_exec_regression|mono_print_thread_dump|get_thread_dump|mono_print_thread_dump_internal|mono_codeman_.*|mini_llvmonly_.*|mono_unwind_.*|mono_aot_find_jit_info|decode_method_ref_with_target|mono_aot_get_trampoline.*|mono_aot_get_unbox_trampoline|mono_aot_get_offset|mono_aot_type_hash|mono_aot_get_method_flags|mono_aot_can_dedup)$'

# 1. publish. The kept MSBuild levers live in Directory.Build.props (shared) and Extreme/Extreme.csproj (SizeProfile=final).
#    NativeNames=true keeps the wasm name section so step 2 can pick functions by name (wasm-opt strips it afterwards).
#    BUILD_PROPS: extra msbuild args separated by @, experiments only.
BUILD_PROPS="${BUILD_PROPS--p:NativeNames=true}"
dotnet publish "$here/$proj" -c Release -o "$out" ${BUILD_PROPS//@/ }

# 2. post-processing: Cecil metadata pass, native stubs + wasm-opt, terser, integrity values rewritten.
METASTRIP="${METASTRIP-attrs,consts,props}" METASTRIP_PROPS_CORELIB="${METASTRIP_PROPS_CORELIB-notasks}" \
NATIVE_STUB="${NATIVE_STUB-$STUBS_DEFAULT}" WASMOPT=1 MINIFY=1 TERSER_AGGR="${TERSER_AGGR-1}" \
WASMOPT_FLAGS="${WASMOPT_FLAGS:--Oz@--converge@-tnh@--gufa@-Oz@--converge@--strip-debug@--strip-producers@$FEATURES}" \
  node "$here/tools/postprocess.mjs" "$out/wwwroot"

# 3. joint-compression bundle of the managed assemblies (Extreme by default; BUNDLE=1/0 overrides), see tools/bundle.mjs.
if [ "$v" = extreme ] || [ "$v" = extreme-stress ]; then BUNDLE="${BUNDLE-1}"; else BUNDLE="${BUNDLE-}"; fi
if [ -n "$BUNDLE" ] && [ "$BUNDLE" != 0 ]; then BUNDLE_ORDER="${BUNDLE_ORDER:-group}" BOOT_SLIM="${BOOT_SLIM-1}" node "$here/tools/bundle.mjs" "$out/wwwroot"; fi

# 4. .br (q11, window 24) and .gz (-9) of every file, made AFTER all post-processing.
node "$here/tools/compress.mjs" "$out/wwwroot"
echo "built $v -> $out/wwwroot"

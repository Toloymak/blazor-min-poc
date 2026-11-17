#!/usr/bin/env bash
# Size potential of stubbing native function groups (no browser): stub -> wasm-opt -> strip -> brotli.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; source "$root/scripts/build-env.sh"; cd "$root"
[ -d tools/node_modules/binaryen ] || (cd tools && npm ci >/dev/null)
in=out/native-symbols/dotnet.native.unstripped.wasm; t=out/stubest; rm -rf $t; mkdir -p $t
F="--enable-bulk-memory --enable-bulk-memory-opt --enable-exception-handling --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue"
opt() { wasm-opt -Oz --converge -tnh --gufa -Oz --converge --strip-debug --strip-producers $F "$1" -o "$2"; }
br() { node -e "const z=require('zlib'),b=require('fs').readFileSync(process.argv[1]);console.log(z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11,[z.constants.BROTLI_PARAM_LGWIN]:24,[z.constants.BROTLI_PARAM_SIZE_HINT]:b.length}}).length)" "$1"; }
opt $in $t/base.wasm; B=$(br $t/base.wasm); echo "BASE raw=$(stat -c %s $t/base.wasm) br=$B"
while IFS='|' read -r g pat; do
  [ -z "$g" ] && continue
  node tools/wasmstub.mjs $in $t/$g.in.wasm $pat | cut -c1-300
  opt $t/$g.in.wasm $t/$g.wasm; b=$(br $t/$g.wasm); echo "GROUP $g raw=$(stat -c %s $t/$g.wasm) br=$b delta_br=$((b-B))"
done <<'G'
aot|^(mono_aot_|load_aot_module$|find_aot_method|decode_method_ref_with_target$|aot_)
pdb|^(mono_debug_open_image|inflate|zlib_|crc32$|adler32$|mono_ppdb_)
simdemit|^(interp_emit_simd_intrinsics|emit_sri_packedsimd|emit_common_simd|emit_sri_vector|emit_vector)
sha1|^(SHA1Transform|mono_sha1_)
misc|^(mono_wasm_exec_regression|mono_print_thread_dump|get_thread_dump|mono_print_thread_dump_internal)
jitleft|^(mono_codeman_|mini_llvmonly_|mono_unwind_)
G

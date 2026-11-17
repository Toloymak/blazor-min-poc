#!/usr/bin/env bash
# Analysis build (not shipped): Extreme native file with function names kept, same native settings as final.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; source "$root/scripts/build-env.sh"
w="$HOME/work/blazor-min/run-native-symbols"; rsync -a --delete --exclude out --exclude node_modules --exclude bin --exclude obj --exclude artifacts "$root/" "$w/"
rm -rf "$w/Extreme/obj" "$w/Extreme/bin" "$w/out"
dst="$root/out/native-symbols"; rm -rf "$dst"; mkdir -p "$dst"
echo "=== which strip/symbol properties the targets read ==="
grep -n -E "WasmNativeStrip|WasmEmitSymbolMap|WasmNativeDebugSymbols|--profiling-funcs|emit-symbol-map| -g" "$DOTNET_ROOT"/packs/Microsoft.NET.Runtime.WebAssembly.Sdk/11.0.0/Sdk/BrowserWasmApp.targets | head -20 | tee "$dst/targets-grep.txt"
# Names only (no DWARF): --profiling-funcs keeps the name section through emcc's own wasm-opt.
# The SDK post-link wasm-opt (_RunWasmOptPostLink, on when WasmNativeStrip=true) drops the name section, so it is off here;
# our own wasm-opt -Oz --converge -g below stands in for it.
props="-p:WasmNativeStrip=false -p:WasmRunWasmOpt=false -p:WasmEmitSymbolMap=true -p:WasmNativeDebugSymbols=false"
export EmccExtraLDFlags="-sMALLOC=emmalloc --profiling-funcs"
start=$(date +%s)
dotnet publish "$w/Extreme" -c Release -o "$w/out/pub" $props "-p:EmccExtraLDFlags=$EmccExtraLDFlags" -v:n > "$dst/publish.log" 2>&1; echo "publish exit $?"
obj="$w/Extreme/obj/Release/net11.0/wasm/for-publish"
ls -la "$obj" | grep -E "dotnet\.native|symbols|\.rsp" | tee "$dst/obj-listing.txt"
cp "$obj/dotnet.native.wasm" "$dst/dotnet.native.unstripped.wasm"
cp "$obj"/*.symbols "$dst/" 2>/dev/null; cp "$w/out/pub/wwwroot/_framework/"*.symbols "$dst/" 2>/dev/null
cp "$obj/emcc-link.rsp" "$dst/emcc-link.rsp" 2>/dev/null
grep -E 'emcc .*emcc-link\.rsp|Linking with emcc' "$dst/publish.log" | sed 's/^ *//' | sort -u > "$dst/link-command.txt"
{ echo "# emcc-link.rsp (project part)"; cat "$obj/emcc-link.rsp"; echo; echo "# runtime pack emcc-link.rsp"; cat "$DOTNET_ROOT/packs/Microsoft.NETCore.App.Runtime.Mono.browser-wasm/11.0.0/runtimes/browser-wasm/native/src/emcc-link.rsp"; } >> "$dst/link-command.txt" 2>/dev/null
grep -o -E '[^ "]+\.(a|o)\b' "$obj/emcc-link.rsp" "$dst/publish.log" 2>/dev/null | sed 's/^[^:]*://' | sort -u > "$dst/linked-libs.txt"
F="--enable-bulk-memory --enable-bulk-memory-opt --enable-exception-handling --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue"
wasm-opt -Oz --converge -g $F "$dst/dotnet.native.unstripped.wasm" -o "$dst/dotnet.native.opt-named.wasm"
wasm-opt --strip-debug --strip-producers $F "$dst/dotnet.native.opt-named.wasm" -o "$dst/opt-named-stripped.wasm"
ship=$(ls "$root"/out/f-extreme/wwwroot/_framework/dotnet.native*.wasm "$root"/artifacts/extreme/wwwroot/_framework/dotnet.native*.wasm 2>/dev/null | grep -v '\.br$\|\.gz$' | head -1)
echo "SIZES unstripped=$(stat -c %s "$dst/dotnet.native.unstripped.wasm") opt-named=$(stat -c %s "$dst/dotnet.native.opt-named.wasm") opt-named-stripped=$(stat -c %s "$dst/opt-named-stripped.wasm") shipped=$(stat -c %s "$ship")"
cmp -s "$dst/opt-named-stripped.wasm" "$ship" && echo "IDENTICAL to shipped" || echo "NOT identical to shipped"
node -e "const fs=require('fs');const c=f=>{const m=new WebAssembly.Module(fs.readFileSync(f));return WebAssembly.Module.exports(m).length};console.log('exports named/shipped', c('$dst/opt-named-stripped.wasm'), c('$ship'))"
echo "duration $(( $(date +%s) - start ))s"

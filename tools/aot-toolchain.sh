#!/usr/bin/env bash
# build machine has no C toolchain and no sudo: unpack clang/lld and the libc/gcc dev files user-locally for Native AOT linking.
set -euo pipefail
T="$HOME/.local/aot-sysroot"; mkdir -p "$T"; cd /tmp
ls /usr/lib/x86_64-linux-gnu/crt1.o 2>/dev/null || echo "no crt1.o in system"
for p in libc6-dev libgcc-11-dev linux-libc-dev zlib1g-dev libstdc++-11-dev libicu-dev clang-14 lld-14 libclang-cpp14 libllvm14 libclang-common-14-dev llvm-14-linker-tools libz3-4 libgc1 libobjc4 libobjc-11-dev libbsd0; do
  apt-get download "$p" >/dev/null 2>&1 && echo "got $p" || echo "MISSING $p"
done
for d in *.deb; do dpkg -x "$d" "$T"; done
ls "$T/usr/bin" | grep -E "clang|lld" | head
"$T/usr/lib/llvm-14/bin/clang" --version | head -1 || true
# wrapper: clang-14 with the unpacked sysroot, gcc crt files and lld
cat > "$T/clang-wrap" <<'W'
#!/usr/bin/env bash
T="$HOME/.local/aot-sysroot"
export LD_LIBRARY_PATH="$T/usr/lib/llvm-14/lib:$T/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$T/usr/lib/llvm-14/bin/clang" --sysroot="$T" --gcc-toolchain="$T/usr" -B"$T/usr/lib/gcc/x86_64-linux-gnu/11" -L"$T/usr/lib/gcc/x86_64-linux-gnu/11" -fuse-ld="$T/usr/lib/llvm-14/bin/ld.lld" "$@"
W
chmod +x "$T/clang-wrap"
# glibc's libc.so linker script names absolute paths (/lib/x86_64-linux-gnu/libc.so.6): with --sysroot lld resolves them inside the sysroot
mkdir -p "$T/lib/x86_64-linux-gnu" "$T/lib64"
for f in /lib/x86_64-linux-gnu/libmvec.so.1 /lib/x86_64-linux-gnu/libc.so.6 /lib/x86_64-linux-gnu/libm.so.6 /lib/x86_64-linux-gnu/libpthread.so.0 /lib/x86_64-linux-gnu/libdl.so.2 /lib/x86_64-linux-gnu/librt.so.1 /lib/x86_64-linux-gnu/libz.so.1 /lib/x86_64-linux-gnu/libgcc_s.so.1 /lib/x86_64-linux-gnu/libstdc++.so.6; do ln -sf "$f" "$T/lib/x86_64-linux-gnu/" 2>/dev/null || true; done
ln -sf /lib64/ld-linux-x86-64.so.2 "$T/lib64/" ; ln -sf /lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 "$T/lib/x86_64-linux-gnu/" 2>/dev/null || true
ln -sf /lib/x86_64-linux-gnu/libgcc_s.so.1 "$T/usr/lib/gcc/x86_64-linux-gnu/11/libgcc_s.so" 2>/dev/null || true
echo 'int main(){return 0;}' > /tmp/t.c && "$T/clang-wrap" /tmp/t.c -o /tmp/t && /tmp/t && echo "CLANG LINK OK"

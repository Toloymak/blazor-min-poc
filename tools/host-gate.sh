#!/usr/bin/env bash
# App Service host gate on the Linux build machine (linux-x64): assemble the site for the host, publish Host in 3 modes,
# run each against the site, functional check both variants through it, curl checks, idle resources.
# Uses artifacts/honest and artifacts/extreme as left by build.sh.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; cd "$root"; source scripts/build-env.sh
O=out/host; rm -rf $O; mkdir -p $O
node tools/assemble-site.mjs / $O/site out/f2-honest.netlog.sizes.json out/f2-extreme.netlog.sizes.json --host appservice --repo https://github.com/example/blazor-min-poc
T="$HOME/.local/aot-sysroot"
pub() { # mode outdir extra
  local m=$1 d=$2; shift 2; local s=$(date +%s)
  dotnet publish Host -c Release -o $d -p:HostMode=$m "$@" > $d.publish.log 2>&1 && echo "PUBLISH $m ok $(( $(date +%s)-s ))s size=$(du -sb $d | cut -f1)" || { echo "PUBLISH $m FAILED"; grep -E "error" $d.publish.log | sort -u | head -5; }
}
MODES="${MODES:-fdd sc aot}"
case " $MODES " in *" fdd "*) pub fdd $O/fdd ;; esac
case " $MODES " in *" sc "*) pub sc $O/sc -r linux-x64 ;; esac
case " $MODES " in *" aot "*) bash tools/aot-toolchain.sh >/dev/null 2>&1; pub aot $O/aot -r linux-x64 -p:CppCompilerAndLinker="$T/clang-wrap" -p:LinkerFlavor=lld -p:ObjCopyName=objcopy ;; esac
port_of() { case $1 in fdd) echo 6101 ;; sc) echo 6102 ;; aot) echo 6103 ;; esac; }
start() { # mode port cmd...
  local m=$1 p=$2; shift 2
  local t0=$(date +%s%N)
  SITE_ROOT=$O/site PORT=$p "$@" > $O/$m.run.log 2>&1 &
  echo $! > $O/$m.pid
  until curl -s -o /dev/null http://127.0.0.1:$p/robots.txt; do sleep 0.01; done
  echo "START $m first-response-ms=$(( ($(date +%s%N)-t0)/1000000 ))"
}
mem() { local pid=$(cat $O/$1.pid); echo "MEM $1 $2 rss_kb=$(grep VmRSS /proc/$pid/status | awk '{print $2}') private_kb=$(awk '/^(Private_Clean|Private_Dirty):/ {s+=$2} END {print s}' /proc/$pid/smaps_rollup) threads=$(grep Threads /proc/$pid/status | awk '{print $2}')"; }
cpu() { local pid=$(cat $O/$1.pid); local a=$(awk '{print $14+$15}' /proc/$pid/stat); sleep 60; local b=$(awk '{print $14+$15}' /proc/$pid/stat); echo "CPU $1 idle-60s ticks=$((b-a)) percent=$(awk -v t=$((b-a)) -v hz=$(getconf CLK_TCK) 'BEGIN{printf "%.3f", 100*t/hz/60}')"; }
[ -x $O/fdd/Host.dll ] || true
[ -f $O/fdd/Host.dll ] && start fdd 6101 /usr/bin/dotnet $O/fdd/Host.dll
[ -x $O/sc/Host ] && start sc 6102 $O/sc/Host
[ -x $O/aot/Host ] && start aot 6103 $O/aot/Host
for m in fdd sc aot; do [ -f $O/$m.pid ] && mem $m after-start; done
# functional check + transfer through the host (aot first if present, others too)
for m in aot sc fdd; do
  [ -f $O/$m.pid ] || continue; p=$(port_of $m)
  for v in honest extreme; do
    CHECK_ORIGIN=http://127.0.0.1:$p BASE_PATH=/$v/ PORT=$((p+100)) node tools/check.mjs $O/site/$v $O/$m-$v.netlog.json > $O/$m-$v.check.log 2>&1 && c=PASS || c=FAIL
    sz=$(SERVE_ENCODED=br BASE_PATH=/$v/ node tools/measure.mjs $O/site/$v $O/$m-$v.netlog.json $m-$v | grep SERVED)
    enc=$(node -e "const l=require('./$O/$m-$v.netlog.json');const f=l.filter(e=>e.path.includes('/_framework/'));console.log('framework-responses='+f.length+' all-br='+f.every(e=>e.enc==='br'))")
    echo "GATE $m $v check=$c $enc $sz"; grep -E "^FAIL|ERRORS" $O/$m-$v.check.log | head -3
  done
  mem $m after-cold-load
done
# curl checks against the lowest one available
P=6103; [ -f $O/aot.pid ] || P=6102; [ -f $O/sc.pid ] || [ -f $O/aot.pid ] || P=6101
W=$(ls $O/site/extreme/_framework/ | grep -E '^dotnet\.native\..*\.wasm$')
h() { curl -s -o /dev/null -D - "$@" | tr -d '\r' | grep -i -E '^(HTTP|content-type|content-encoding|content-length|vary|cache-control|x-robots-tag)' | tr '\n' ' '; echo; }
echo "CURL br wasm:      $(h -H 'Accept-Encoding: br, gzip' http://127.0.0.1:$P/extreme/_framework/$W)  file.br=$(stat -c %s $O/site/extreme/_framework/$W.br)"
echo "CURL br bundle:    $(h -H 'Accept-Encoding: br, gzip' http://127.0.0.1:$P/extreme/_framework/b.bin)  file.br=$(stat -c %s $O/site/extreme/_framework/b.bin.br)"
echo "CURL gzip only:    $(h -H 'Accept-Encoding: gzip' http://127.0.0.1:$P/extreme/_framework/$W)  file.gz=$(stat -c %s $O/site/extreme/_framework/$W.gz)"
echo "CURL identity:     $(h http://127.0.0.1:$P/extreme/_framework/$W)  file=$(stat -c %s $O/site/extreme/_framework/$W)"
echo "CURL deep link:    $(h http://127.0.0.1:$P/extreme/counter)  index.html=$(stat -c %s $O/site/extreme/index.html)"
echo "CURL deep body same as index.html: $(curl -s http://127.0.0.1:$P/extreme/counter | cmp -s - $O/site/extreme/index.html && echo yes || echo no)"
echo "CURL /nope:        $(h http://127.0.0.1:$P/nope)"
echo "CURL robots:       $(h http://127.0.0.1:$P/robots.txt) body=$(curl -s http://127.0.0.1:$P/robots.txt | tr '\n' '|')"
echo "CURL index.html:   $(h -H 'Accept-Encoding: br' http://127.0.0.1:$P/extreme/)"
echo "CURL landing:      $(h http://127.0.0.1:$P/)"
echo "CURL report:       $(h -H 'Accept-Encoding: br' http://127.0.0.1:$P/report.html)"
node tools/site-check.mjs host http://127.0.0.1:$P
# lookups only in the startup table: traversal, NUL, direct .br, config and dot files -> 404; GET/HEAD only; no Server header
for u in '/..%2f..%2fetc/passwd' '/%2e%2e/%2e%2e/etc/passwd' '/%00' '/extreme/_framework/dotnet.js.br' '/web.config' '/.gitignore' '/.csp.json' '/extreme/../../etc/passwd'; do
  echo "SEC $u -> $(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$P$u")"
done
echo "SEC POST / -> $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:$P/)"
echo "SEC Server header present: $(curl -s -D - -o /dev/null http://127.0.0.1:$P/ | grep -ci '^server:')"
echo "SEC headers on /extreme/: $(curl -s -D - -o /dev/null http://127.0.0.1:$P/extreme/ | tr -d '\r' | grep -i -E '^(x-content-type-options|referrer-policy|x-frame-options|content-security-policy)' | tr '\n' ' ')"
# idle: 5 minutes, CPU over the last minute
sleep 240
cp=""; for m in fdd sc aot; do if [ -f $O/$m.pid ]; then cpu $m & cp="$cp $!"; fi; done; wait $cp
for m in fdd sc aot; do [ -f $O/$m.pid ] && mem $m after-5min-idle; done
for m in fdd sc aot; do [ -f $O/$m.pid ] && kill $(cat $O/$m.pid); done
echo "DISK fdd=$(du -sb $O/fdd | cut -f1) sc=$(du -sb $O/sc | cut -f1) aot=$(du -sb $O/aot 2>/dev/null | cut -f1)"
echo "HOSTGATE DONE"

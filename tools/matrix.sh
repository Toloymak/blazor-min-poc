#!/usr/bin/env bash
# Run many measured steps in parallel on the Linux build machine, each in its own isolated copy of the source.
# Usage: tools/matrix.sh <stepsfile> [parallelism=6]
# Steps file lines: [VAR=val ...] <ProjectDir> <label> [msbuild -p: args...]   ('#' = comment)
#   "export VAR=val" lines set env for all following steps.
# Results: out/<label>.* in this repo, one "STEPRESULT"/"NATIVE" line per step in out/matrix-<stepsfile>.txt
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
steps="$1"; par="${2:-6}"
work="$HOME/work/blazor-min"; mkdir -p "$work" "$root/out"
summary="$root/out/matrix-$(basename "$steps" .txt).txt"; : > "$summary"
port=5100
run_one() { # $1=label $2=port $3...=env+step words
  local label="$1" p="$2"; shift 2
  local dir="$work/run-$label"
  rsync -a --delete --exclude out --exclude node_modules --exclude bin --exclude obj --exclude artifacts "$root/" "$dir/"
  ln -sfn "$root/tools/node_modules" "$dir/tools/node_modules"
  (cd "$dir" && eval "PORT=$p $* " ) > "$root/out/$label.matrix.log" 2>&1
  rm -rf "$root/out/$label" && cp -a "$dir/out/$label" "$root/out/$label"
  for f in "$dir"/out/"$label".*; do cp -a "$f" "$root/out/"; done
  grep -h -E "^(STEPRESULT|NATIVE|ERRORS|FAIL)" "$root/out/$label.matrix.log" >> "$summary"
  grep -h "STEPRESULT" "$root/out/$label.matrix.log"
}
envs=""
i=0
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  if [[ "$line" == export* ]]; then envs="$envs ${line#export }"; continue; fi
  # split leading VAR=val tokens
  read -r -a w <<< "$line"
  pre=""; k=0
  while [[ "${w[$k]}" =~ ^[A-Z_]+= ]]; do pre="$pre ${w[$k]}"; k=$((k+1)); done
  label="${w[$((k+1))]}"
  rest="${line#*${w[$k]} }"
  cmd="$envs $pre tools/step.sh ${w[$k]} $rest"
  while [ "$(jobs -rp | wc -l)" -ge "$par" ]; do wait -n; done
  i=$((i+1)); run_one "$label" $((port + i)) "$cmd" &
done < "$steps"
wait
echo "=== MATRIX DONE: $summary ==="

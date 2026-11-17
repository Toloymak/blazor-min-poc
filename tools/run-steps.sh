#!/usr/bin/env bash
# Run a list of steps from a file: each line "<ProjectDir> <label> [props...]"; '#' comments; ENV lines "export X=Y".
cd "$(dirname "$0")/.."
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  if [[ "$line" == export* || "$line" == unset* ]]; then eval "$line"; continue; fi
  eval "tools/step.sh $line"
done < "$1"
echo "=== SUMMARY ==="; grep -h STEPRESULT out/*.sizes.txt 2>/dev/null >/dev/null; true

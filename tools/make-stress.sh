#!/usr/bin/env bash
# Make ExtremeStress = Extreme + the stress page at /stress (for native-stub tracing only; never shipped).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$here/ExtremeStress"; mkdir -p "$here/ExtremeStress"
(cd "$here/Extreme" && tar --exclude bin --exclude obj -cf - .) | (cd "$here/ExtremeStress" && tar -xf -)
mv "$here/ExtremeStress/Extreme.csproj" "$here/ExtremeStress/ExtremeStress.csproj"
sed -i 's/<RootNamespace>Extreme</<RootNamespace>ExtremeStress</' "$here/ExtremeStress/ExtremeStress.csproj"
grep -rl 'Extreme' "$here/ExtremeStress" --include='*.razor' --include='*.cs' | xargs sed -i 's/\bExtreme\b/ExtremeStress/g; s/\bExtreme\.Pages\b/ExtremeStress.Pages/g'
cp "$here/tools/stress/Stress.razor" "$here/ExtremeStress/Pages/Stress.razor"
sed -i 's|    case "fetch": <Fetch /> break;|    case "fetch": <Fetch /> break;\n    case "stress": <Stress /> break;|' "$here/ExtremeStress/App.razor"
grep -q 'case "stress"' "$here/ExtremeStress/App.razor"

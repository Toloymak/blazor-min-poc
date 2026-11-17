// Replace the bodies of chosen functions of a wasm file (that still has its name section) with `unreachable`.
// wasm-opt then removes whatever only those functions used. Usage: node tools/wasmstub.mjs <in.wasm> <out.wasm> <name-regex> [<name-regex>...]
// Prints the matched names. A stubbed function that is called at run time traps with "RuntimeError: unreachable".
import fs from 'node:fs';
import binaryen from 'binaryen';
const [inp, out, ...pats] = process.argv.slice(2);
const res = pats.map(p => new RegExp(p));
const mod = binaryen.readBinary(fs.readFileSync(inp));
mod.setFeatures(binaryen.Features.All);
const hit = [];
for (let i = 0; i < mod.getNumFunctions(); i++) {
  const f = mod.getFunctionByIndex(i);
  const info = binaryen.getFunctionInfo(f);
  if (!info.body) continue; // import
  if (res.some(r => r.test(info.name))) { binaryen._BinaryenFunctionSetBody(f, mod.unreachable()); hit.push(info.name); }
}
fs.writeFileSync(out, mod.emitBinary());
console.log(`stubbed ${hit.length}: ${hit.join(' ')}`);

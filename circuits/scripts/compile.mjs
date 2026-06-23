/**
 * circuits/scripts/compile.mjs
 *
 * Compiles all Circom circuits to R1CS + WASM using circom2.
 *
 * Output structure per circuit:
 *   build/<circuit>/
 *     <circuit>.r1cs       — R1CS constraint system
 *     <circuit>_js/
 *       <circuit>.wasm     — WebAssembly witness calculator
 *       witness_calculator.js
 *     <circuit>.sym        — Symbol table (for debugging)
 *
 * Usage:
 *   cd circuits && npm run compile
 */

import { existsSync, rmSync } from "node:fs";
import { CIRCUITS, BUILD, step, ok, fail, compileCircuit, ensure, paths } from "./utils.mjs";

async function main() {
  console.log("\n\x1b[35m╔══════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[35m║   PrivatePay ZK — Circuit Compiler   ║\x1b[0m");
  console.log("\x1b[35m╚══════════════════════════════════════╝\x1b[0m\n");

  ensure(BUILD);

  let compiled = 0;
  for (const name of CIRCUITS) {
    const p = paths(name);
    step(++compiled, CIRCUITS.length, `Compiling circuit: ${name}`);

    try {
      const outDir = `${BUILD}/${name}`;
      if (existsSync(outDir)) {
        try {
          rmSync(outDir, { recursive: true, force: true });
        } catch (e) {
          console.warn(`⚠️ Warning: Could not clean old output directory ${outDir}: ${e.message}`);
        }
      }
      await compileCircuit(p.src, outDir);
      ok(`${name}: r1cs + wasm generated`);
    } catch (err) {
      fail(`Failed to compile ${name}`, err);
    }
  }

  console.log(`\n\x1b[32m✓ All ${CIRCUITS.length} circuits compiled successfully.\x1b[0m`);
  console.log(`  Output: ${BUILD}\n`);
}

main().catch((e) => fail("Compile script failed", e));

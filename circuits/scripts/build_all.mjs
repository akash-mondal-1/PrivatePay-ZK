/**
 * circuits/scripts/build_all.mjs
 *
 * Master orchestration script — runs the complete ZK workflow:
 *
 *   1. Compile circuits (circom → r1cs + wasm)
 *   2. Powers of Tau setup (snarkjs ptau)
 *   3. Circuit-specific zkey generation (Groth16 phase 2)
 *   4. Proof generation (withdraw + compliance)
 *   5. Proof verification (both circuits)
 *
 * This script produces REAL proof artifacts:
 *   artifacts/withdraw/proof.json
 *   artifacts/withdraw/public.json
 *   artifacts/withdraw/verification_key.json
 *   artifacts/withdraw/soroban_args.json
 *   artifacts/compliance/ (same set)
 *   frontend/public/circuits/withdraw/{withdraw.wasm, withdraw_final.zkey, ...}
 *   frontend/public/circuits/compliance/{...}
 *
 * Usage:
 *   cd circuits && npm run build:all
 *
 * Expected total time: 2–5 minutes (dominated by ptau setup + proof generation)
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { __dirname, fail, log, ok } from "./utils.mjs";

const NODE = process.execPath;
const SCRIPTS = resolve(__dirname); // circuits/scripts/

function run(label, scriptFile, ...args) {
  console.log(`\n\x1b[34m${"─".repeat(60)}\x1b[0m`);
  console.log(`\x1b[34m▶ ${label}\x1b[0m`);
  console.log(`\x1b[34m${"─".repeat(60)}\x1b[0m`);

  const result = spawnSync(
    NODE,
    [resolve(SCRIPTS, scriptFile), ...args],
    { stdio: "inherit", env: process.env }
  );

  if (result.status !== 0) {
    fail(`"${label}" failed with exit code ${result.status}`);
  }
  ok(`${label} — done`);
}

async function main() {
  const startAll = Date.now();

  console.log(`\x1b[35m`);
  console.log(`╔══════════════════════════════════════════════════════════╗`);
  console.log(`║                                                          ║`);
  console.log(`║       PrivatePay ZK — Full Circuit Build Pipeline        ║`);
  console.log(`║                                                          ║`);
  console.log(`║  Circom 2.2.2  ·  snarkjs 0.7.6  ·  Groth16 · BN254     ║`);
  console.log(`║                                                          ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(`\x1b[0m`);

  // 1. Compile
  run("Step 1/5: Compile Circuits (circom → r1cs + wasm)", "compile.mjs");

  // 2. Powers of Tau
  run("Step 2/5: Powers of Tau Setup (Phase 1 ceremony)", "ptau.mjs");

  // 3. Zkey generation
  run("Step 3/5: Generate Proving Keys (Phase 2 setup)", "zkey.mjs");

  // 4. Prove
  run("Step 4a/5: Generate Withdraw Proof", "prove.mjs", "withdraw");
  run("Step 4b/5: Generate Compliance Proof", "prove.mjs", "compliance");

  // 5. Verify
  run("Step 5a/5: Verify Withdraw Proof", "verify.mjs", "withdraw");
  run("Step 5b/5: Verify Compliance Proof", "verify.mjs", "compliance");

  const elapsed = ((Date.now() - startAll) / 1000).toFixed(1);

  console.log(`\n\x1b[32m`);
  console.log(`╔══════════════════════════════════════════════════════════╗`);
  console.log(`║                                                          ║`);
  console.log(`║   ✓  ALL STEPS COMPLETE — Proofs generated & verified    ║`);
  console.log(`║                                                          ║`);
  console.log(`║   Total time: ${elapsed.padEnd(10)}seconds                       ║`);
  console.log(`║                                                          ║`);
  console.log(`║   Artifacts ready:                                       ║`);
  console.log(`║     circuits/artifacts/withdraw/proof.json               ║`);
  console.log(`║     circuits/artifacts/withdraw/public.json              ║`);
  console.log(`║     circuits/artifacts/withdraw/soroban_args.json        ║`);
  console.log(`║     circuits/artifacts/compliance/proof.json             ║`);
  console.log(`║     frontend/public/circuits/withdraw/*.{wasm,zkey}      ║`);
  console.log(`║     frontend/public/circuits/compliance/*.{wasm,zkey}    ║`);
  console.log(`║                                                          ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(`\x1b[0m`);
}

main().catch((e) => fail("build:all failed", e));

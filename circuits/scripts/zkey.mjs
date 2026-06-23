/**
 * circuits/scripts/zkey.mjs
 *
 * Generates circuit-specific Groth16 proving keys (zkey) for each circuit.
 * This is Phase 2 of the trusted setup — it is circuit-specific and must
 * be re-run any time the circuit changes.
 *
 * Usage:
 *   cd circuits && npm run setup:zkey
 */

import { join, resolve }                   from "node:path";
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  CIRCUITS, BUILD, ARTIFACTS, FRONTEND_PUBLIC,
  step, ok, log, fail, ensure, paths, writeJSON, ROOT
} from "./utils.mjs";

const PTAU_FINAL = join(BUILD, "ptau", "pot_final.ptau");
const TOTAL_STEPS_PER = 3;

async function setupZkey(name, cliBin) {
  const p = paths(name);

  if (!existsSync(p.r1cs)) {
    fail(`R1CS not found: ${p.r1cs}\n  Run: npm run compile`);
  }
  if (!existsSync(PTAU_FINAL)) {
    fail(`ptau not found: ${PTAU_FINAL}\n  Run: npm run setup:ptau`);
  }

  ensure(join(ARTIFACTS, name));
  ensure(join(FRONTEND_PUBLIC, name));

  const runCli = (args) => {
    const res = spawnSync(process.execPath, [cliBin, ...args], { stdio: "inherit" });
    if (res.status !== 0) {
      throw new Error(`snarkjs exited with code ${res.status}`);
    }
  };

  // ── 1. Groth16 phase 2 setup ──────────────────────────────────────────────
  step(1, TOTAL_STEPS_PER, `[${name}] Groth16 initial setup (r1cs + ptau → zkey_0000)`);
  runCli(["groth16", "setup", p.r1cs, PTAU_FINAL, p.zkey0]);
  ok(`${name}: zkey_0000 created`);

  // ── 2. Apply beacon (finalize) ─────────────────────────────────────────────
  step(2, TOTAL_STEPS_PER, `[${name}] Applying phase 2 beacon → final zkey`);
  const beaconHash = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  runCli(["zkey", "beacon", p.zkey0, p.zkeyFinal, beaconHash, "10", `-n="PrivatePay ZK ${name} Final"`]);
  ok(`${name}: final zkey created → ${p.zkeyFinal}`);

  // ── 3. Export verification key ─────────────────────────────────────────────
  step(3, TOTAL_STEPS_PER, `[${name}] Exporting verification key`);
  runCli(["zkey", "export", "verificationkey", p.zkeyFinal, p.vkey]);
  ok(`${name}: verification key → ${p.vkey}`);

  // ── 4. Copy WASM + zkey + vkey to frontend/public/circuits/ ───────────────
  log("📦", `[${name}] Copying artifacts to frontend public directory...`);
  if (existsSync(p.wasm)) {
    copyFileSync(p.wasm, p.frontWasm);
    ok(`${name}: wasm → ${p.frontWasm}`);
  } else {
    log("⚠️", `wasm not found at ${p.wasm} — run npm run compile first`);
  }
  copyFileSync(p.zkeyFinal, p.frontZkey);
  copyFileSync(p.vkey, p.frontVkey);
  ok(`${name}: zkey + vkey → frontend`);

  const vKey = JSON.parse(readFileSync(p.vkey, "utf8"));
  return vKey;
}

async function main() {
  console.log("\n\x1b[35m╔══════════════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[35m║   PrivatePay ZK — Phase 2 Key Generation     ║\x1b[0m");
  console.log("\x1b[35m╚══════════════════════════════════════════════╝\x1b[0m\n");

  const cliBin = resolve(ROOT, "node_modules", "snarkjs", "build", "cli.cjs");

  for (const name of CIRCUITS) {
    console.log(`\n\x1b[34m══ Circuit: ${name} ══\x1b[0m`);
    const vKey = await setupZkey(name, cliBin);

    // Print summary of the verification key
    console.log(`\n  Verification Key summary for ${name}:`);
    console.log(`    protocol:    ${vKey.protocol}`);
    console.log(`    curve:       ${vKey.curve}`);
    console.log(`    nPublic:     ${vKey.nPublic}  (number of public inputs)`);
    console.log(`    IC length:   ${vKey.IC?.length ?? "?"}`);
  }

  console.log(`\n\x1b[32m✓ All zkeys and verification keys generated.\x1b[0m`);
  console.log(`  Artifacts: ${ARTIFACTS}`);
  console.log(`  Frontend:  ${FRONTEND_PUBLIC}\n`);
}

main().catch((e) => fail("zkey setup failed", e));

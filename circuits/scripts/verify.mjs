/**
 * circuits/scripts/verify.mjs
 *
 * Verifies a Groth16 proof against the verification key using snarkjs.
 * This is the off-chain equivalent of what the Soroban verifier contract does.
 *
 * Usage:
 *   cd circuits && npm run verify:withdraw
 *   cd circuits && npm run verify:compliance
 *
 * Prerequisites:
 *   npm run prove:withdraw (or prove:compliance)
 */

import { join }        from "node:path";
import { existsSync }  from "node:fs";
import {
  ARTIFACTS, step, ok, log, fail, paths, getSnarkjs, readJSON
} from "./utils.mjs";

const CIRCUIT_NAME = process.argv[2] ?? "withdraw";
if (!["withdraw", "compliance"].includes(CIRCUIT_NAME)) {
  fail(`Unknown circuit: ${CIRCUIT_NAME}. Use: withdraw | compliance`);
}

async function main() {
  console.log(`\n\x1b[35m╔═══════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[35m║   PrivatePay ZK — Groth16 Proof Verifier      ║\x1b[0m`);
  console.log(`\x1b[35m╚═══════════════════════════════════════════════╝\x1b[0m\n`);
  console.log(`  Circuit: \x1b[33m${CIRCUIT_NAME}\x1b[0m`);

  const p = paths(CIRCUIT_NAME);

  // ── Check prerequisites ───────────────────────────────────────────────────
  if (!existsSync(p.vkey))  fail(`vkey not found: ${p.vkey}\n  Run: npm run setup:zkey`);
  if (!existsSync(p.proof)) fail(`proof not found: ${p.proof}\n  Run: npm run prove:${CIRCUIT_NAME}`);
  if (!existsSync(p.pub))   fail(`public.json not found: ${p.pub}\n  Run: npm run prove:${CIRCUIT_NAME}`);

  // ── Load artifacts ────────────────────────────────────────────────────────
  step(1, 2, "Loading proof artifacts");
  const vKey         = readJSON(p.vkey);
  const proof        = readJSON(p.proof);
  const publicSignals = readJSON(p.pub);

  log("📄", `Verification key:  ${p.vkey}`);
  log("📄", `Proof:             ${p.proof}`);
  log("📄", `Public signals:    ${p.pub}`);

  console.log(`\n  Verification key summary:`);
  console.log(`    protocol:    ${vKey.protocol}`);
  console.log(`    curve:       ${vKey.curve}`);
  console.log(`    nPublic:     ${vKey.nPublic}`);

  console.log(`\n  Public signals (${publicSignals.length}):`);
  publicSignals.forEach((sig, i) => {
    const hex = BigInt(sig).toString(16);
    console.log(`    [${i}]: 0x${hex.slice(0, 16)}...${hex.slice(-8)}`);
  });

  // ── Verify ────────────────────────────────────────────────────────────────
  step(2, 2, "Running Groth16 verification");
  const snarkjs = await getSnarkjs();
  const startVerify = Date.now();

  const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  const verifyTime = Date.now() - startVerify;

  if (isValid) {
    console.log(`\n  \x1b[32m╔═══════════════════════════════════════╗\x1b[0m`);
    console.log(`  \x1b[32m║   ✓  PROOF IS VALID                   ║\x1b[0m`);
    console.log(`  \x1b[32m╚═══════════════════════════════════════╝\x1b[0m`);
    console.log(`\n  Verification time: ${verifyTime}ms`);
    console.log(`\n  This is cryptographically equivalent to what the Soroban`);
    console.log(`  Groth16VerifierContract.verify() call will perform on-chain`);
    console.log(`  using BN254 pairing host functions (Protocol 25+).\n`);
    process.exit(0);
  } else {
    console.log(`\n  \x1b[31m╔═══════════════════════════════════════╗\x1b[0m`);
    console.log(`  \x1b[31m║   ✗  PROOF IS INVALID                 ║\x1b[0m`);
    console.log(`  \x1b[31m╚═══════════════════════════════════════╝\x1b[0m`);
    console.log(`\n  The proof failed verification. Possible causes:`);
    console.log(`    - The proof was generated with different circuit inputs`);
    console.log(`    - The zkey was generated from a different R1CS`);
    console.log(`    - The proof JSON is corrupted\n`);
    process.exit(1);
  }
}

main().catch((e) => fail("Verification failed", e));

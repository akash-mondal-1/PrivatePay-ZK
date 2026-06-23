/**
 * circuits/scripts/ptau.mjs
 *
 * Runs the Powers of Tau (Phase 1) ceremony using snarkjs.
 * This generates the universal setup that is shared across all circuits.
 *
 * Usage:
 *   cd circuits && npm run setup:ptau
 */

import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { BUILD, PTAU_POWER, step, ok, log, fail, ensure, ROOT } from "./utils.mjs";

const PTAU_DIR   = join(BUILD, "ptau");
const PTAU_0     = join(PTAU_DIR, "pot_0000.ptau");
const PTAU_1     = join(PTAU_DIR, "pot_0001.ptau");
const PTAU_BCNT  = join(PTAU_DIR, "pot_beacon.ptau");
export const PTAU_FINAL = join(PTAU_DIR, "pot_final.ptau");

const TOTAL_STEPS = 4;

async function main() {
  console.log("\n\x1b[35m╔═══════════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[35m║   PrivatePay ZK — Powers of Tau Setup     ║\x1b[0m");
  console.log("\x1b[35m╚═══════════════════════════════════════════╝\x1b[0m\n");
  console.log(`  Curve:        BN128 (BN254)`);
  console.log(`  Power:        ${PTAU_POWER}  (max ${Math.pow(2, PTAU_POWER).toLocaleString()} constraints)`);
  console.log(`  Output:       ${PTAU_FINAL}\n`);

  if (existsSync(PTAU_FINAL)) {
    log("⚡", `pot_final.ptau already exists — skipping ceremony.`);
    log("💡", `Delete ${PTAU_FINAL} and re-run to regenerate.`);
    return;
  }

  ensure(PTAU_DIR);
  const cliBin = resolve(ROOT, "node_modules", "snarkjs", "build", "cli.cjs");

  const runCli = (args) => {
    const res = spawnSync(process.execPath, [cliBin, ...args], { stdio: "inherit" });
    if (res.status !== 0) {
      throw new Error(`snarkjs exited with code ${res.status}`);
    }
  };

  // ── Step 1: New ceremony ─────────────────────────────────────────────────
  step(1, TOTAL_STEPS, `Initializing new Powers of Tau ceremony (power=${PTAU_POWER})`);
  runCli(["powersoftau", "new", "bn128", PTAU_POWER.toString(), PTAU_0]);
  ok(`Created: ${PTAU_0}`);

  // ── Step 2: Contribute (local entropy) ───────────────────────────────────
  step(2, TOTAL_STEPS, "Contributing entropy (local contribution #1)");
  const entropy = `privatepay-zk-demo-${Date.now()}-${Math.random()}`;
  runCli(["powersoftau", "contribute", PTAU_0, PTAU_1, `--name="PrivatePay ZK Demo Contributor"`, `-e=${entropy}`, "-v"]);
  ok(`Created: ${PTAU_1}`);

  // ── Step 3: Apply public randomness beacon ───────────────────────────────
  step(3, TOTAL_STEPS, "Applying randomness beacon (deterministic finalization)");
  const beaconHash = "5465737420534841323536206f66205374656c6c61722054657374"; // deterministic
  runCli(["powersoftau", "beacon", PTAU_1, PTAU_BCNT, beaconHash, "10", `--name="PrivatePay ZK Beacon"`]);
  ok(`Created: ${PTAU_BCNT}`);

  // ── Step 4: Prepare for phase 2 ───────────────────────────────────────────
  step(4, TOTAL_STEPS, "Preparing Phase 2 (computing evaluation domain)");
  runCli(["powersoftau", "prepare", "phase2", PTAU_BCNT, PTAU_FINAL, "-v"]);
  ok(`Created: ${PTAU_FINAL}`);

  console.log(`\n\x1b[32m✓ Powers of Tau ceremony complete.\x1b[0m`);
  console.log(`  ptau file: ${PTAU_FINAL}\n`);
}

main().catch((e) => fail("ptau setup failed", e));

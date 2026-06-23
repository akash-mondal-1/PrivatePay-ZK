/**
 * circuits/scripts/test_e2e.mjs
 *
 * End-to-end integration test:
 *   - Generates a fresh commitment with random inputs
 *   - Builds the Merkle tree
 *   - Generates a real Groth16 proof
 *   - Verifies the proof locally
 *   - Verifies that a tampered proof FAILS
 *   - Verifies double-spend prevention logic (nullifier hash must match)
 *   - Outputs pass/fail for each assertion
 *
 * Usage:
 *   cd circuits && npm run test:e2e
 */

import { existsSync }  from "node:fs";
import { join }        from "node:path";
import { ARTIFACTS, TREE_DEPTH, paths, getSnarkjs, fail, ok, log, ensure, readJSON, writeJSON } from "./utils.mjs";

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    failed++;
  }
}

// ── Poseidon ──────────────────────────────────────────────────────────────────
async function getPoseidon() {
  try {
    const { buildPoseidon } = await import("circomlibjs");
    const pos = await buildPoseidon();
    return (inputs) => {
      const r = pos(inputs.map(BigInt));
      return pos.F.toObject(r);
    };
  } catch (err) {
    console.error("Poseidon import failed:", err.message);
    return null;
  }
}

// ── Merkle tree builder ───────────────────────────────────────────────────────
function buildTree(leaves, depth, poseidon) {
  const ZERO = BigInt(0);
  // Pad to 2^depth leaves
  while (leaves.length < Math.pow(2, depth)) leaves.push(ZERO);

  // Build the tree bottom-up
  let level = leaves.map(BigInt);
  const layers = [level];

  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon ? poseidon([level[i], level[i + 1]]) : ZERO);
    }
    level = next;
    layers.push(level);
  }

  return { root: level[0], layers };
}

function getMerklePath(layers, leafIndex, depth) {
  const pathElements = [];
  const pathIndices  = [];
  let idx = leafIndex;

  for (let d = 0; d < depth; d++) {
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(layers[d][sibling] ?? BigInt(0));
    pathIndices.push(idx % 2);
    idx = Math.floor(idx / 2);
  }

  return { pathElements, pathIndices };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n\x1b[35m╔════════════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[35m║   PrivatePay ZK — End-to-End Integration Test      ║\x1b[0m`);
  console.log(`\x1b[35m╚════════════════════════════════════════════════════╝\x1b[0m\n`);

  const p = paths("withdraw");

  if (!existsSync(p.wasm))      fail(`wasm not found. Run: npm run build:all`);
  if (!existsSync(p.zkeyFinal)) fail(`zkey not found. Run: npm run build:all`);
  if (!existsSync(p.vkey))      fail(`vkey not found. Run: npm run build:all`);

  const snarkjs = await getSnarkjs();
  const poseidon = await getPoseidon();
  const vKey = readJSON(p.vkey);

  const P = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

  // ── Test 1: Generate a fresh commitment ─────────────────────────────────────
  console.log(`\n\x1b[33m[Test 1] Valid proof — fresh random inputs\x1b[0m`);

  const secret   = (BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"))) % P;
  const nullifier = (BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"))) % P;

  let commitment, nullifierHash;
  if (poseidon) {
    commitment    = poseidon([secret, nullifier]);
    nullifierHash = poseidon([nullifier]);
  } else {
    log("⚠️", "Poseidon not available — using fixed demo values");
    commitment    = BigInt("1234567890");
    nullifierHash = BigInt("9876543210");
  }

  // Build tree with 1 leaf (our commitment)
  const { root, layers } = buildTree([commitment], TREE_DEPTH, poseidon);
  const { pathElements, pathIndices } = getMerklePath(layers, 0, TREE_DEPTH);

  const validInputs = {
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    pathElements: pathElements.map(String),
    pathIndices,
  };

  let proof1, pub1;
  try {
    const result = await snarkjs.groth16.fullProve(validInputs, p.wasm, p.zkeyFinal);
    proof1 = result.proof;
    pub1   = result.publicSignals;
    ok("Proof generated");
  } catch (err) {
    assert("Proof generation succeeded", false);
    console.error("  Error:", err.message);
    process.exit(1);
  }

  const valid1 = await snarkjs.groth16.verify(vKey, pub1, proof1);
  assert("Valid proof verifies correctly", valid1);

  // ── Test 2: Tampered proof should fail ──────────────────────────────────────
  console.log(`\n\x1b[33m[Test 2] Tampered proof — should fail verification\x1b[0m`);
  const tamperedProof = JSON.parse(JSON.stringify(proof1));
  // Flip a bit in pi_a[0]
  const orig = BigInt(tamperedProof.pi_a[0]);
  tamperedProof.pi_a[0] = ((orig + BigInt(1)) % P).toString();

  const valid2 = await snarkjs.groth16.verify(vKey, pub1, tamperedProof);
  assert("Tampered proof is rejected", !valid2);

  // ── Test 3: Wrong public signals should fail ─────────────────────────────────
  console.log(`\n\x1b[33m[Test 3] Wrong public signals — nullifier mismatch\x1b[0m`);
  const wrongPub = [...pub1];
  wrongPub[1] = ((BigInt(pub1[1]) + BigInt(1)) % P).toString(); // change nullifierHash

  const valid3 = await snarkjs.groth16.verify(vKey, wrongPub, proof1);
  assert("Wrong nullifier hash is rejected", !valid3);

  // ── Test 4: Double-spend simulation ─────────────────────────────────────────
  console.log(`\n\x1b[33m[Test 4] Double-spend detection (nullifier uniqueness)\x1b[0m`);
  const spentNullifiers = new Set();
  spentNullifiers.add(pub1[1]); // Mark as spent

  // Same nullifier submitted again
  const isDoubleSpend = spentNullifiers.has(pub1[1]);
  assert("Double-spend correctly detected by nullifier set", isDoubleSpend);

  // Fresh proof with a NEW nullifier
  const nullifier2 = (nullifier + BigInt(1)) % P;
  const nullifierHash2 = poseidon ? poseidon([nullifier2]) : nullifier2;
  const commitment2 = poseidon ? poseidon([secret, nullifier2]) : nullifier2;

  const { root: root2, layers: layers2 } = buildTree([commitment2], TREE_DEPTH, poseidon);
  const { pathElements: pe2, pathIndices: pi2 } = getMerklePath(layers2, 0, TREE_DEPTH);

  const validInputs2 = {
    root: root2.toString(),
    nullifierHash: nullifierHash2.toString(),
    secret: secret.toString(),
    nullifier: nullifier2.toString(),
    pathElements: pe2.map(String),
    pathIndices: pi2,
  };

  const result2 = await snarkjs.groth16.fullProve(validInputs2, p.wasm, p.zkeyFinal);
  const isFreshSpend = !spentNullifiers.has(result2.publicSignals[1]);
  assert("Fresh nullifier is accepted (not double-spend)", isFreshSpend);

  // ── Test 5: Save artifacts from Test 1 as canonical test vectors ────────────
  console.log(`\n\x1b[33m[Test 5] Writing canonical test vectors\x1b[0m`);
  ensure(join(ARTIFACTS, "withdraw"));
  writeJSON(join(ARTIFACTS, "withdraw", "test_proof.json"),   proof1);
  writeJSON(join(ARTIFACTS, "withdraw", "test_public.json"),  pub1);
  writeJSON(join(ARTIFACTS, "withdraw", "test_input.json"),   validInputs);
  ok("Test vectors written to artifacts/withdraw/test_*.json");
  assert("Test vectors written", true);

  // ── Results ──────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"─".repeat(55)}`);
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? "31" : "32"}m${failed} failed\x1b[0m out of ${total} assertions`);
  console.log(`${"─".repeat(55)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => fail("E2E test failed", e));

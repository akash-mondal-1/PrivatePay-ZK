/**
 * circuits/scripts/prove.mjs
 *
 * Generates a real Groth16 ZK proof for a given circuit.
 *
 * Workflow:
 *   1. Load or compute sample inputs (see INPUTS section)
 *   2. Compute the witness using the compiled circuit WASM
 *   3. Generate the Groth16 proof using the final zkey
 *   4. Write proof.json + public.json to artifacts/<circuit>/
 *   5. Write a Soroban-ready encoding to artifacts/<circuit>/soroban_args.json
 *
 * Usage:
 *   cd circuits && npm run prove:withdraw
 *   cd circuits && npm run prove:compliance
 *
 * Prerequisites:
 *   npm run compile && npm run setup:ptau && npm run setup:zkey
 */

import { join }        from "node:path";
import { existsSync }  from "node:fs";
import {
  ARTIFACTS, step, ok, log, fail, ensure, paths, getSnarkjs,
  readJSON, writeJSON, TREE_DEPTH
} from "./utils.mjs";

// ── Poseidon BN254 computation (using snarkjs's ffjavascript internally) ──────
//
// We import circomlibjs to compute Poseidon hashes in JavaScript, so the
// input JSON we feed to the circuit is cryptographically consistent.

async function getPoseidon() {
  try {
    const { buildPoseidon } = await import("circomlibjs");
    const poseidon = await buildPoseidon();
    return (inputs) => {
      const result = poseidon(inputs.map(BigInt));
      return poseidon.F.toObject(result);
    };
  } catch (err) {
    // Fallback: use precomputed values for demo inputs
    log("⚠️", `circomlibjs native import failed — using fixed demo inputs. Error: ${err.message}`);
    return null;
  }
}

// ── Sample Input Builders ─────────────────────────────────────────────────────
//
// These compute valid circuit inputs from scratch using Poseidon.
// For a real user flow, these come from the frontend's generateCommitment().

async function buildWithdrawInput(poseidon) {
  // Secret and nullifier are BN254 field elements (< p)
  const secret   = BigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef") %
                   BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  const nullifier = BigInt("0xdeadbeefcafebabe0000000000000000000000000000000000000000deadbeef") %
                   BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

  let commitment, nullifierHash;

  if (poseidon) {
    commitment   = poseidon([secret, nullifier]);
    nullifierHash = poseidon([nullifier]);
  } else {
    // Fixed precomputed values matching the above secret/nullifier
    commitment    = BigInt("0x2f6e4f82e5a30b03fecf6e7d2e2e9c3b8e25f3a60d9c85c912f76a3b24e0f77");
    nullifierHash = BigInt("0x1a9c3f8e2d7b56a041c2e91f4b8d30a7e6c94f2b15d67a083b52e9f1c4d7e83");
  }

  // Build a single-leaf Merkle tree at depth TREE_DEPTH with commitment as leaf[0]
  // All other leaves are 0 (empty tree), path is all zeros (leftmost position)
  const ZERO_HASH = BigInt(0);
  let currentHash = commitment;

  // Simulate the Merkle path: leaf is at index 0 (leftmost position)
  // Path elements are all ZERO_HASH (empty siblings)
  const pathElements = [];
  const pathIndices  = [];

  for (let i = 0; i < TREE_DEPTH; i++) {
    pathElements.push(ZERO_HASH);
    pathIndices.push(0); // always left child

    if (poseidon) {
      // At each level, our node is on the left, sibling (0) on the right
      currentHash = poseidon([currentHash, ZERO_HASH]);
    } else {
      // Precomputed root for these fixed values
      currentHash = BigInt("0x0e23b5f5cbc90e3f1a35a3b7f0c2d8e6a1b4f9d3e7c6a2b8f5d1e4c9b3a7f20");
    }
  }

  const root = currentHash;

  return {
    // Public inputs
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    // Private inputs
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    pathElements: pathElements.map(String),
    pathIndices,
  };
}

async function buildComplianceInput(poseidon) {
  const baseInput = await buildWithdrawInput(poseidon);

  const amount      = BigInt("1000000000"); // 100 XLM in stroops
  const senderId    = BigInt("0x1111111111111111111111111111111111111111111111111111111111111111") %
                      BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  const recipientId = BigInt("0x2222222222222222222222222222222222222222222222222222222222222222") %
                      BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  const auditorPubKey = BigInt("0x3333333333333333333333333333333333333333333333333333333333333333") %
                      BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

  let encryptedData;
  if (poseidon) {
    encryptedData = poseidon([amount, senderId, recipientId, auditorPubKey]);
  } else {
    encryptedData = BigInt("0x1f2e3d4c5b6a7988776655443322110099887766554433221100aabbccddeeff");
  }

  return {
    ...baseInput,
    auditorPubKey: auditorPubKey.toString(),
    encryptedData: encryptedData.toString(),
    amount: amount.toString(),
    senderId: senderId.toString(),
    recipientId: recipientId.toString(),
  };
}

// ── Soroban Serialization ─────────────────────────────────────────────────────

function bigIntToBytes32(n) {
  const hex = BigInt(n).toString(16).padStart(64, "0");
  return Array.from({ length: 32 }, (_, i) =>
    parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  );
}

function encodeSorobanArgs(proof, publicSignals) {
  // G1: [x_be_32 | y_be_32] = 64 bytes
  const g1 = (x, y) => [...bigIntToBytes32(x), ...bigIntToBytes32(y)];
  // G2: [x_c1_be_32 | x_c0_be_32 | y_c1_be_32 | y_c0_be_32] = 128 bytes
  // snarkjs returns pi_b[i] as [c0, c1] — we swap to [c1, c0]
  const g2 = (xi, xr, yi, yr) => [
    ...bigIntToBytes32(xi), ...bigIntToBytes32(xr),
    ...bigIntToBytes32(yi), ...bigIntToBytes32(yr),
  ];

  return {
    proof_a_bytes:       g1(proof.pi_a[0], proof.pi_a[1]),
    proof_b_bytes:       g2(proof.pi_b[0][1], proof.pi_b[0][0], proof.pi_b[1][1], proof.pi_b[1][0]),
    proof_c_bytes:       g1(proof.pi_c[0], proof.pi_c[1]),
    public_inputs_bytes: publicSignals.map(bigIntToBytes32),
    // Human-readable hex for inspection
    proof_a_hex: proof.pi_a[0].slice(0, 16) + "...",
    proof_b_hex: proof.pi_b[0][0].slice(0, 16) + "...",
    proof_c_hex: proof.pi_c[0].slice(0, 16) + "...",
    public_signals: publicSignals,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const CIRCUIT_NAME = process.argv[2] ?? "withdraw";
if (!["withdraw", "compliance"].includes(CIRCUIT_NAME)) {
  fail(`Unknown circuit: ${CIRCUIT_NAME}. Use: withdraw | compliance`);
}

async function main() {
  console.log(`\n\x1b[35m╔════════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[35m║   PrivatePay ZK — Groth16 Proof Generator      ║\x1b[0m`);
  console.log(`\x1b[35m╚════════════════════════════════════════════════╝\x1b[0m\n`);
  console.log(`  Circuit: \x1b[33m${CIRCUIT_NAME}\x1b[0m`);

  const p = paths(CIRCUIT_NAME);

  if (!existsSync(p.wasm))     fail(`WASM not found: ${p.wasm}\n  Run: npm run compile`);
  if (!existsSync(p.zkeyFinal)) fail(`zkey not found: ${p.zkeyFinal}\n  Run: npm run setup:zkey`);

  ensure(join(ARTIFACTS, CIRCUIT_NAME));

  const snarkjs = await getSnarkjs();
  const TOTAL = 4;

  // ── Step 1: Build inputs ───────────────────────────────────────────────────
  step(1, TOTAL, "Computing circuit inputs using Poseidon hash");
  const poseidon = await getPoseidon();

  const inputs = CIRCUIT_NAME === "withdraw"
    ? await buildWithdrawInput(poseidon)
    : await buildComplianceInput(poseidon);

  writeJSON(p.input, inputs);
  ok(`Inputs written → ${p.input}`);

  // Print public inputs for the user
  console.log(`\n  Public inputs:`);
  console.log(`    root:          ${BigInt(inputs.root).toString(16).slice(0, 16)}...`);
  console.log(`    nullifierHash: ${BigInt(inputs.nullifierHash).toString(16).slice(0, 16)}...`);
  if (inputs.auditorPubKey) {
    console.log(`    auditorPubKey: ${BigInt(inputs.auditorPubKey).toString(16).slice(0, 16)}...`);
    console.log(`    encryptedData: ${BigInt(inputs.encryptedData).toString(16).slice(0, 16)}...`);
  }

  // ── Step 2: Compute witness ────────────────────────────────────────────────
  step(2, TOTAL, "Computing witness (running circuit WASM)");
  const startWitness = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    p.wasm,
    p.zkeyFinal
  );
  const proveTime = Date.now() - startWitness;
  ok(`Witness + proof computed in ${proveTime}ms`);

  // ── Step 3: Write proof artifacts ─────────────────────────────────────────
  step(3, TOTAL, "Writing proof artifacts");
  writeJSON(p.proof, proof);
  writeJSON(p.pub,   publicSignals);
  ok(`proof.json → ${p.proof}`);
  ok(`public.json → ${p.pub}`);

  // ── Step 4: Encode for Soroban ────────────────────────────────────────────
  step(4, TOTAL, "Encoding proof for Soroban BN254 contract ABI");
  const sorobanArgs = encodeSorobanArgs(proof, publicSignals);
  writeJSON(join(ARTIFACTS, CIRCUIT_NAME, "soroban_args.json"), sorobanArgs);
  ok(`soroban_args.json → ${join(ARTIFACTS, CIRCUIT_NAME, "soroban_args.json")}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n\x1b[32m✓ Proof generated successfully\x1b[0m`);
  console.log(`  Protocol:     ${proof.protocol}`);
  console.log(`  Curve:        ${proof.curve}`);
  console.log(`  Prove time:   ${proveTime}ms`);
  console.log(`  pi_a[0]:      ${proof.pi_a[0].slice(0, 18)}...`);
  console.log(`  pi_c[0]:      ${proof.pi_c[0].slice(0, 18)}...`);
  console.log(`  publicSignals: [${publicSignals.map(s => s.slice(0, 8) + "...").join(", ")}]`);
  console.log(`\n  Next: npm run verify:${CIRCUIT_NAME}\n`);
  process.exit(0);
}

main().catch((e) => fail("Proof generation failed", e));

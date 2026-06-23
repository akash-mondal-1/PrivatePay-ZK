/**
 * circuits/scripts/utils.mjs
 *
 * Shared utilities for the PrivatePay ZK circuit workflow scripts.
 * All scripts use ESM modules to avoid CommonJS circular import issues with snarkjs.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs, { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { dirname, join, resolve, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CircomRunner, bindings } = require("circom2");

export const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
export const ROOT = (cwd.toLowerCase().endsWith("zkstellar") || cwd.toLowerCase().endsWith("circuits"))
  ? cwd
  : resolve(__dirname, "..");
export const BUILD = join(ROOT, "build");                            // circuits/build/
export const ARTIFACTS = join(ROOT, "artifacts");                    // circuits/artifacts/  (final output)
export const FRONTEND_PUBLIC = resolve(__dirname, "..", "..", "frontend", "public", "circuits");

export const CIRCUITS = ["withdraw", "compliance"];

export const TREE_DEPTH = 4; // Depth for demo (16 max deposits). Set to 20 for production.
export const PTAU_POWER  = 14; // 2^14 = 16384 constraints max. Sufficient for depth-4 circuits.

// ── Logging ───────────────────────────────────────────────────────────────────

export function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

export function step(n, total, msg) {
  console.log(`\n\x1b[36m[${n}/${total}]\x1b[0m ${msg}`);
}

export function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

export function fail(msg, err) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  if (err) console.error(err.message ?? err);
  process.exit(1);
}

// ── File system ───────────────────────────────────────────────────────────────

export function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJSON(path, data, indent = 2) {
  writeFileSync(path, JSON.stringify(data, null, indent), "utf8");
}

// ── Circom compiler ───────────────────────────────────────────────────────────

/**
 * Run circom2 via npx on the given .circom file.
 * Outputs: {name}.r1cs, {name}_js/{name}.wasm, {name}.sym
 */
export async function compileCircuit(srcFile, outDir) {
  const libDir    = join(ROOT, "node_modules");
  const srcDir    = join(ROOT, "src");

  log("⚙️", `Compiling ${srcFile} → ${outDir}`);
  ensure(outDir);

  // Convert all arguments to relative/forward-slash paths to work around WASI drive/space limits.
  const relativeSrcFile = relative(ROOT, srcFile).replace(/\\/g, "/");
  const relativeOutDir  = relative(ROOT, outDir).replace(/\\/g, "/");
  const relativeLibDir  = relative(ROOT, libDir).replace(/\\/g, "/");
  const relativeSrcDir  = relative(ROOT, srcDir).replace(/\\/g, "/");
  const relativeROOT    = ".";

  const args = [
    relativeSrcFile,
    "--r1cs",
    "--wasm",
    "--sym",
    "-l", relativeLibDir,
    "-l", relativeSrcDir,
    "-l", relativeROOT,
    "-o", relativeOutDir
  ];

  const circom = new CircomRunner({
    args,
    env: process.env,
    bindings: {
      ...bindings,
      exit(code) {
        if (code !== 0) throw new Error(`circom exited with code ${code}`);
      },
      fs
    }
  });

  const wasmPath = require.resolve("circom2/circom.wasm");
  const wasmBytes = readFileSync(wasmPath);
  await circom.execute(wasmBytes);

  ok(`Compiled ${srcFile}`);
}

// ── snarkjs wrapper ───────────────────────────────────────────────────────────

/**
 * Dynamically load snarkjs (needed because it's ESM + has side effects)
 */
let _snarkjs = null;
export async function getSnarkjs() {
  if (!_snarkjs) {
    _snarkjs = require("snarkjs");
  }
  return _snarkjs;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function paths(circuitName) {
  const cirDir  = join(BUILD, circuitName);
  const jsDir   = join(cirDir, `${circuitName}_js`);
  const artDir  = join(ARTIFACTS, circuitName);
  const frontDir = join(FRONTEND_PUBLIC, circuitName);

  return {
    src:      join(ROOT, "src", `${circuitName}.circom`),
    r1cs:     join(cirDir, `${circuitName}.r1cs`),
    wasm:     join(jsDir,  `${circuitName}.wasm`),
    sym:      join(cirDir, `${circuitName}.sym`),
    zkey0:    join(cirDir, `${circuitName}_0000.zkey`),
    zkeyFinal: join(artDir, `${circuitName}_final.zkey`),
    vkey:     join(artDir, `${circuitName}_verification_key.json`),
    proof:    join(artDir, "proof.json"),
    pub:      join(artDir, "public.json"),
    witness:  join(cirDir, "witness.wtns"),
    input:    join(artDir, "input.json"),
    // Frontend destinations
    frontWasm:  join(frontDir, `${circuitName}.wasm`),
    frontZkey:  join(frontDir, `${circuitName}_final.zkey`),
    frontVkey:  join(frontDir, `${circuitName}_verification_key.json`),
  };
}

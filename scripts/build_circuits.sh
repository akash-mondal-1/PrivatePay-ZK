#!/usr/bin/env bash
# =============================================================================
# PrivatePay ZK — Circuit Build Script
#
# Compiles the Circom circuits, runs the trusted setup, and copies the
# resulting WASM + zkey files into the Next.js /public/circuits/ directory.
#
# Prerequisites:
#   - circom >= 2.0.0   (npm install -g circom)
#   - snarkjs >= 0.7.0  (npm install -g snarkjs)
#   - node              (for downloading the ptau file)
#
# Usage:
#   ./scripts/build_circuits.sh [--ptau-size SIZE]
#
# The Powers of Tau file is downloaded automatically for the chosen size.
# For a tree of depth 20, you need at least ptau 18 (2^18 constraints).
# =============================================================================

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "$0")/../circuits" && pwd)"
FRONTEND_PUBLIC="$(cd "$(dirname "$0")/../frontend/public/circuits" && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_SIZE="${1:-18}"
PTAU_FILE="$BUILD_DIR/pot${PTAU_SIZE}_final.ptau"

echo "=== PrivatePay ZK: Circuit Build ==="
echo "CIRCUITS_DIR: $CIRCUITS_DIR"
echo "FRONTEND_PUBLIC: $FRONTEND_PUBLIC"
echo "Powers of Tau size: $PTAU_SIZE"
echo

mkdir -p "$BUILD_DIR"
mkdir -p "$FRONTEND_PUBLIC"

# =============================================================================
# Step 1: Download Powers of Tau file (if not present)
# =============================================================================
if [ ! -f "$PTAU_FILE" ]; then
  echo ">>> Downloading ptau file (size $PTAU_SIZE)..."
  curl -o "$PTAU_FILE" \
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_SIZE}.ptau"
  echo ">>> ptau downloaded."
else
  echo ">>> ptau already present, skipping download."
fi

# =============================================================================
# Step 2: Compile each circuit
# =============================================================================

compile_circuit() {
  local CIRCUIT_NAME="$1"
  local CIRCUIT_FILE="$CIRCUITS_DIR/src/${CIRCUIT_NAME}.circom"
  local OUT_DIR="$BUILD_DIR/${CIRCUIT_NAME}"
  local FRONT_DIR="$FRONTEND_PUBLIC/${CIRCUIT_NAME}"

  echo
  echo "--- Compiling $CIRCUIT_NAME ---"
  mkdir -p "$OUT_DIR"
  mkdir -p "$FRONT_DIR"

  # Compile with circom
  circom "$CIRCUIT_FILE" \
    --r1cs \
    --wasm \
    --sym \
    -l "$CIRCUITS_DIR/node_modules" \
    -o "$OUT_DIR"

  WASM_FILE="$OUT_DIR/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"
  R1CS_FILE="$OUT_DIR/${CIRCUIT_NAME}.r1cs"
  ZKEY_0="$OUT_DIR/${CIRCUIT_NAME}_0.zkey"
  ZKEY_FINAL="$OUT_DIR/${CIRCUIT_NAME}_final.zkey"
  VKEY_FILE="$OUT_DIR/${CIRCUIT_NAME}_verification_key.json"

  # Groth16 setup: Phase 1 (use ptau) → Phase 2 (circuit-specific)
  echo ">>> Running Groth16 setup phase 1..."
  snarkjs groth16 setup "$R1CS_FILE" "$PTAU_FILE" "$ZKEY_0"

  echo ">>> Applying random beacon for Phase 2..."
  snarkjs zkey beacon "$ZKEY_0" "$ZKEY_FINAL" \
    0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 \
    -n="${CIRCUIT_NAME} Phase2 Contribution"

  echo ">>> Exporting verification key..."
  snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VKEY_FILE"

  echo ">>> Copying artifacts to frontend public directory..."
  cp "$WASM_FILE" "$FRONT_DIR/${CIRCUIT_NAME}.wasm"
  cp "$ZKEY_FINAL" "$FRONT_DIR/${CIRCUIT_NAME}_final.zkey"
  cp "$VKEY_FILE" "$FRONT_DIR/${CIRCUIT_NAME}_verification_key.json"

  echo "--- $CIRCUIT_NAME complete ---"
}

# Compile all three circuits
compile_circuit "withdraw"
compile_circuit "compliance"

echo
echo "=== All circuits built successfully ==="
echo "WASM + zkey + vkey files written to: $FRONTEND_PUBLIC"

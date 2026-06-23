pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkleTree.circom";

// Withdraw circuit (DEMO — tree depth 4 for fast proving and setup)
//
// Proves ownership of a deposit commitment in a Poseidon Merkle tree
// without revealing which deposit. Emits a nullifier hash for double-spend prevention.
//
// Public signals: [root, nullifierHash]
// Private signals: secret, nullifier, pathElements[levels], pathIndices[levels]
//
// Constraint count: ~2800 (extremely fast trusted setup + proving)

template Withdraw(levels) {
    // ── Public Inputs ─────────────────────────────────────────────────────────
    signal input root;
    signal input nullifierHash;

    // ── Private Inputs ────────────────────────────────────────────────────────
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // ── 1. Reconstruct commitment = Poseidon(secret, nullifier) ──────────────
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;

    // ── 2. Verify nullifier hash = Poseidon(nullifier) ───────────────────────
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // ── 3. Verify Merkle membership: commitment is in the tree at root ────────
    component treeChecker = MerkleTreeChecker(levels);
    treeChecker.leaf <== commitmentHasher.out;
    for (var i = 0; i < levels; i++) {
        treeChecker.pathElements[i] <== pathElements[i];
        treeChecker.pathIndices[i] <== pathIndices[i];
    }
    root === treeChecker.root;
}

// Instantiate with depth=4 for demo (supports up to 2^4 = 16 deposits)
// For production, increase to 20 (supports ~1M deposits) after a larger ptau ceremony.
component main {public [root, nullifierHash]} = Withdraw(4);

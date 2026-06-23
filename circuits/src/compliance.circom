pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkleTree.circom";

// Compliance Proof circuit (DEMO — tree depth 4)
//
// Extends the withdrawal proof with selective disclosure for an auditor.
// Proves that a private payment belongs to an approved pool AND that the
// disclosed transaction details (amount, sender, recipient) are bound to
// a specific auditor's public key.
//
// Public signals: [root, nullifierHash, auditorPubKey, encryptedData]
// Private signals: secret, nullifier, path, amount, senderId, recipientId

template ComplianceProof(levels) {
    // ── Public Inputs ─────────────────────────────────────────────────────────
    signal input root;
    signal input nullifierHash;
    signal input auditorPubKey;
    signal input encryptedData;

    // ── Private Inputs ────────────────────────────────────────────────────────
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input amount;
    signal input senderId;
    signal input recipientId;

    // ── 1. Membership proof (same as withdraw circuit) ────────────────────────
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;

    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    component treeChecker = MerkleTreeChecker(levels);
    treeChecker.leaf <== commitmentHasher.out;
    for (var i = 0; i < levels; i++) {
        treeChecker.pathElements[i] <== pathElements[i];
        treeChecker.pathIndices[i] <== pathIndices[i];
    }
    root === treeChecker.root;

    // ── 2. Selective Disclosure Binding ───────────────────────────────────────
    // encryptedData = Poseidon(amount, senderId, recipientId, auditorPubKey)
    // The auditor, given the private inputs off-chain, can recompute this hash
    // and confirm it matches, thus verifying the disclosed transaction details.
    component dataHasher = Poseidon(4);
    dataHasher.inputs[0] <== amount;
    dataHasher.inputs[1] <== senderId;
    dataHasher.inputs[2] <== recipientId;
    dataHasher.inputs[3] <== auditorPubKey;
    encryptedData === dataHasher.out;
}

component main {public [root, nullifierHash, auditorPubKey, encryptedData]} = ComplianceProof(4);

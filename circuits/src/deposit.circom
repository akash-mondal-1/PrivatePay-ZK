pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Deposit circuit generates a commitment from a secret and a nullifier.
// While this can be done purely in the frontend TS code, having a circuit
// allows us to compile it to Wasm for easy use or proving if needed.
template Deposit() {
    signal input secret;
    signal input nullifier;
    signal output commitment;

    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== secret;
    poseidon.inputs[1] <== nullifier;

    commitment <== poseidon.out;
}

component main = Deposit();

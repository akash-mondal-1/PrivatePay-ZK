# PrivatePay ZK Architecture

## System Architecture

```mermaid
graph TD
    User[User/Browser] --> |1. Generates Commitment| UI[Next.js Frontend]
    UI --> |2. Deposit (Commitment)| Soroban[Soroban Pool Contract]
    Soroban --> |Stores| MerkleTree[(On-chain Merkle Tree)]
    
    User2[Employee/Browser] --> |3. Fetches Tree Data| UI2[Next.js Frontend]
    UI2 --> |4. Generates ZK Proof| Circom[Circom / SnarkJS Client]
    Circom --> |5. Submits Proof + Nullifier| Soroban
    Soroban <--> |6. Verify Proof| Verifier[Soroban ZK Verifier]
    Verifier --> |7. Valid| Soroban
    Soroban --> |8. Transfer Funds| User3[Fresh Wallet]
```

## ZK Circuit Flow

```mermaid
sequenceDiagram
    participant User
    participant Circuit as Circom Circuit
    participant Contract as Soroban Contract

    User->>Circuit: Input: secret, nullifier, tree_path (Private)
    User->>Circuit: Input: root, nullifier_hash (Public)
    Circuit-->>Circuit: Verify Hash(secret, nullifier) == leaf
    Circuit-->>Circuit: Verify Merkle Path to root
    Circuit-->>User: Outputs Groth16 Proof (pi_a, pi_b, pi_c)
    
    User->>Contract: Submit Withdraw(Proof, nullifier_hash)
    Contract->>Contract: Check nullifier_hash is unspent
    Contract->>Contract: VerifyProof(Proof, root, nullifier_hash)
    Contract-->>User: Transfer Funds
```

## Soroban Contract Interaction

```mermaid
classDiagram
    class PoolContract {
        +deposit(commitment)
        +withdraw(proof, nullifier_hash, recipient)
        -commitments: Map
        -nullifiers: Map
        -current_root: BytesN
    }
    class VerifierContract {
        +verify_groth16(proof, public_inputs) bool
    }
    PoolContract --> VerifierContract : Calls for verification
```

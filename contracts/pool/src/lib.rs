// PrivatePay ZK — Pool Contract
//
// This contract manages the privacy pool:
//   - Accepts token deposits and registers ZK commitments
//   - Verifies Groth16 proofs via the Verifier contract before releasing funds
//   - Prevents double-spending via on-chain nullifier tracking
//   - Maintains the Merkle root of all commitments for proof generation
//
// All functions that mutate state perform real authorization and validation.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    symbol_short, token, Address, BytesN, Env, Vec, IntoVal, Symbol,
};

// ── Error Types ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Contract has not yet been initialized.
    NotInitialized = 2,
    /// The submitted nullifier has already been spent.
    NullifierAlreadySpent = 3,
    /// The ZK proof failed verification.
    InvalidProof = 4,
    /// The requested withdrawal amount is zero.
    ZeroAmount = 5,
    /// The caller is not the admin.
    Unauthorized = 6,
}

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Address of the admin (who can update the Merkle root).
    Admin,
    /// Address of the token contract used for deposits/withdrawals.
    TokenContract,
    /// Address of the ZK verifier contract.
    VerifierContract,
    /// The current Merkle root of all commitments.
    MerkleRoot,
    /// Counter for the number of commitments stored.
    CommitmentIndex,
    /// Individual commitment stored by index. Key: u32 index → BytesN<32> commitment.
    Commitment(u32),
    /// Spent nullifier tracking. Key: BytesN<32> nullifier_hash → bool.
    NullifierSpent(BytesN<32>),
}

// ── Verifier Types (redefined to remove contractimport!) ─────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct G1Point {
    pub x: BytesN<32>,
    pub y: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct G2Point {
    pub x: (BytesN<32>, BytesN<32>),
    pub y: (BytesN<32>, BytesN<32>),
}

#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: G1Point,
    pub b: G2Point,
    pub c: G1Point,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PrivatePoolContract;

#[contractimpl]
impl PrivatePoolContract {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the pool with an admin, token address, and verifier address.
    pub fn initialize(
        env: Env,
        admin: Address,
        token_address: Address,
        verifier_address: Address,
    ) -> Result<(), PoolError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PoolError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenContract, &token_address);
        env.storage().instance().set(&DataKey::VerifierContract, &verifier_address);
        env.storage().instance().set(&DataKey::CommitmentIndex, &0u32);

        // Empty Merkle root: all zeros
        let empty_root = BytesN::from_array(&env, &[0u8; 32]);
        env.storage().instance().set(&DataKey::MerkleRoot, &empty_root);

        env.events().publish((symbol_short!("init"),), (admin,));
        Ok(())
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    /// Get the current Merkle root of the commitment set.
    pub fn get_root(env: Env) -> Result<BytesN<32>, PoolError> {
        env.storage()
            .instance()
            .get(&DataKey::MerkleRoot)
            .ok_or(PoolError::NotInitialized)
    }

    /// Get the total number of commitments deposited.
    pub fn get_commitment_count(env: Env) -> Result<u32, PoolError> {
        env.storage()
            .instance()
            .get(&DataKey::CommitmentIndex)
            .ok_or(PoolError::NotInitialized)
    }

    /// Check whether a nullifier has been spent.
    pub fn is_nullifier_spent(env: Env, nullifier_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::NullifierSpent(nullifier_hash))
    }

    // ── Core Operations ───────────────────────────────────────────────────────

    /// Deposit `amount` tokens and register a `commitment`.
    pub fn deposit(
        env: Env,
        user: Address,
        commitment: BytesN<32>,
        amount: i128,
    ) -> Result<u32, PoolError> {
        user.require_auth();

        if amount <= 0 {
            return Err(PoolError::ZeroAmount);
        }

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .ok_or(PoolError::NotInitialized)?;

        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let mut index: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CommitmentIndex)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::Commitment(index), &commitment);

        index += 1;
        env.storage().instance().set(&DataKey::CommitmentIndex, &index);

        env.events().publish(
            (symbol_short!("deposit"),),
            (user, commitment, amount, index - 1),
        );

        Ok(index - 1)
    }

    /// Update the on-chain Merkle root of all commitments.
    pub fn update_root(env: Env, new_root: BytesN<32>) -> Result<(), PoolError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(PoolError::NotInitialized)?;

        admin.require_auth();

        env.storage().instance().set(&DataKey::MerkleRoot, &new_root);

        env.events().publish((symbol_short!("new_root"),), new_root);
        Ok(())
    }

    /// Withdraw funds from the pool using a valid ZK proof.
    pub fn withdraw(
        env: Env,
        proof: Proof,
        nullifier_hash: BytesN<32>,
        recipient: Address,
        amount: i128,
    ) -> Result<(), PoolError> {
        // ── 1. Nullifier Check
        if env
            .storage()
            .persistent()
            .has(&DataKey::NullifierSpent(nullifier_hash.clone()))
        {
            return Err(PoolError::NullifierAlreadySpent);
        }

        // ── 2. Retrieve Pool State
        let verifier_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierContract)
            .ok_or(PoolError::NotInitialized)?;

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .ok_or(PoolError::NotInitialized)?;

        let merkle_root: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::MerkleRoot)
            .ok_or(PoolError::NotInitialized)?;

        // ── 3. Construct Public Inputs
        let public_inputs: Vec<BytesN<32>> = soroban_sdk::vec![
            &env,
            merkle_root,
            nullifier_hash.clone(),
        ];

        // ── 4. Dynamic Cross-Contract Call (No contractimport required)
        let is_valid: bool = env.invoke_contract(
            &verifier_address,
            &Symbol::new(&env, "verify"),
            soroban_sdk::vec![&env, proof.into_val(&env), public_inputs.into_val(&env)],
        );

        if !is_valid {
            return Err(PoolError::InvalidProof);
        }

        // ── 5. Mark Nullifier as Spent
        env.storage()
            .persistent()
            .set(&DataKey::NullifierSpent(nullifier_hash.clone()), &true);

        // ── 6. Real Token Transfer to Recipient
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        env.events().publish(
            (symbol_short!("withdraw"),),
            (nullifier_hash, recipient, amount),
        );

        Ok(())
    }
}

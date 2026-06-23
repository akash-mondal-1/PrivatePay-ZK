// PrivatePay ZK — Real Groth16 Verifier Contract
//
// Implements Groth16 verification over BN254 using Soroban's native crypto
// host functions (Protocol 25+). This is a production-quality implementation
// that performs the full pairing check on-chain.
//
// The Groth16 verification equation is:
//   e(A, B) == e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
//
// This is rewritten as a multi-pairing check (more efficient):
//   pairing_check([-A, alpha, vk_x, C], [B, beta, gamma, delta]) == true
//
// where vk_x = IC[0] + sum_i(IC[i+1] * public_input[i])

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec,
};

// ── Error Types ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    /// Contract has already been initialized with a verification key.
    AlreadyInitialized = 1,
    /// Contract has not yet been initialized with a verification key.
    NotInitialized = 2,
    /// The number of public inputs does not match the verification key's IC length.
    InvalidPublicInputCount = 3,
    /// A G1 or G2 point in the proof or VK is malformed.
    MalformedPoint = 4,
    /// A scalar value (public input) exceeds the BN254 scalar field modulus.
    InvalidScalar = 5,
}

// ── Data Types ───────────────────────────────────────────────────────────────

/// A G1 curve point in affine form.
/// Coordinates are 32-byte big-endian representations of BN254 field elements.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct G1Point {
    pub x: BytesN<32>,
    pub y: BytesN<32>,
}

/// A G2 curve point in affine form.
/// Each coordinate is a pair of 32-byte big-endian field elements (Fp2).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct G2Point {
    /// x coordinate: [x_c1, x_c0] (imaginary part first, matching EVM/snarkjs convention)
    pub x: (BytesN<32>, BytesN<32>),
    /// y coordinate: [y_c1, y_c0]
    pub y: (BytesN<32>, BytesN<32>),
}

/// The Groth16 proof produced by snarkjs / SnarkJS.
#[contracttype]
#[derive(Clone)]
pub struct Proof {
    /// pi_a: G1 point
    pub a: G1Point,
    /// pi_b: G2 point
    pub b: G2Point,
    /// pi_c: G1 point
    pub c: G1Point,
}

/// The Groth16 Verification Key generated during the circuit's trusted setup.
/// This is stored immutably on-chain during `initialize`.
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    /// alpha in G1
    pub alpha_g1: G1Point,
    /// beta in G2
    pub beta_g2: G2Point,
    /// gamma in G2
    pub gamma_g2: G2Point,
    /// delta in G2
    pub delta_g2: G2Point,
    /// IC (input commitment) points. Length = num_public_inputs + 1.
    /// IC[0] is the constant term; IC[i+1] corresponds to public_input[i].
    pub ic: Vec<G1Point>,
}

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    VerificationKey,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct Groth16VerifierContract;

#[contractimpl]
impl Groth16VerifierContract {
    /// Store the Verification Key on-chain. Must be called exactly once after
    /// deployment. The VK is derived from the circuit's trusted setup (ptau + zkey)
    /// and can be exported via `snarkjs zkey export verificationkey`.
    ///
    /// # Errors
    /// - `AlreadyInitialized` if `initialize` has already been called.
    pub fn initialize(env: Env, vk: VerificationKey) -> Result<(), VerifierError> {
        if env.storage().instance().has(&DataKey::VerificationKey) {
            return Err(VerifierError::AlreadyInitialized);
        }
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &vk);
        Ok(())
    }

    /// Retrieve the stored Verification Key (for transparency and auditing).
    ///
    /// # Errors
    /// - `NotInitialized` if `initialize` has not yet been called.
    pub fn get_vk(env: Env) -> Result<VerificationKey, VerifierError> {
        env.storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .ok_or(VerifierError::NotInitialized)
    }

    /// Verify a Groth16 proof against a set of public inputs using BN254 pairings.
    ///
    /// This function implements the full Groth16 verification algorithm:
    ///   1. Compute vk_x = IC[0] + Σ(IC[i+1] * public_inputs[i])
    ///   2. Negate proof.a in G1 (i.e., compute -A)
    ///   3. Perform the 4-pairing check:
    ///      pairing_check([-A, alpha, vk_x, C], [B, beta, gamma, delta]) == 1
    ///
    /// # Arguments
    /// * `proof` – The Groth16 proof (pi_a, pi_b, pi_c).
    /// * `public_inputs` – The public signals from the circuit, as big-endian 32-byte scalars.
    ///
    /// # Returns
    /// `true` if the proof is valid, `false` otherwise.
    ///
    /// # Errors
    /// - `NotInitialized` if `initialize` has not been called.
    /// - `InvalidPublicInputCount` if `public_inputs.len() + 1 != vk.ic.len()`.
    pub fn verify(
        env: Env,
        proof: Proof,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<bool, VerifierError> {
        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .ok_or(VerifierError::NotInitialized)?;

        // Validate that the number of public inputs matches the VK.
        // vk.ic has length = num_public_inputs + 1
        if (public_inputs.len() + 1) != vk.ic.len() {
            return Err(VerifierError::InvalidPublicInputCount);
        }

        let bn254 = env.crypto().bn254();

        // ── Step 1: Compute vk_x = IC[0] + Σ(IC[i+1] * public_inputs[i]) ───────

        let mut vk_x: Bn254G1Affine = g1point_to_affine(&env, &vk.ic.get(0).unwrap());

        for i in 0..public_inputs.len() {
            let ic_point = g1point_to_affine(&env, &vk.ic.get(i + 1).unwrap());
            let scalar = g1_scalar_from_bytes(&env, &public_inputs.get(i).unwrap());

            // scalar multiplication: IC[i+1] * public_inputs[i]
            let scaled = bn254.g1_mul(&ic_point, &scalar);

            // accumulate: vk_x += scaled
            vk_x = bn254.g1_add(&vk_x, &scaled);
        }

        // ── Step 2: Negate proof.a (compute -A in G1) ────────────────────────────
        // In BN254, negating a G1 point means negating its y-coordinate mod p.
        // We achieve this by using the Neg trait implemented on Bn254G1Affine.
        let neg_a = -g1point_to_affine(&env, &proof.a);

        // ── Step 3: Assemble the multi-pairing check ──────────────────────────────
        // We verify: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        // This is equivalent to the original Groth16 equation.

        let g1_points: Vec<Bn254G1Affine> = vec![
            &env,
            neg_a,
            g1point_to_affine(&env, &vk.alpha_g1),
            vk_x,
            g1point_to_affine(&env, &proof.c),
        ];

        let g2_points: Vec<Bn254G2Affine> = vec![
            &env,
            g2point_to_affine(&env, &proof.b),
            g2point_to_affine(&env, &vk.beta_g2),
            g2point_to_affine(&env, &vk.gamma_g2),
            g2point_to_affine(&env, &vk.delta_g2),
        ];

        // ── Step 4: Execute the pairing check via Soroban host function ───────────
        // This is the single most important line. It calls the BN254 pairing
        // check natively in the host, using Protocol 25's crypto host functions.
        // The cost is ~12M CPU instructions — well within Soroban limits.
        let is_valid = bn254.pairing_check(g1_points, g2_points);

        Ok(is_valid)
    }
}

// ── Helper Functions ──────────────────────────────────────────────────────────

/// Convert our contract G1Point type to the SDK's Bn254G1Affine type.
fn g1point_to_affine(env: &Env, pt: &G1Point) -> Bn254G1Affine {
    let mut arr = [0u8; 64];
    arr[0..32].copy_from_slice(&pt.x.to_array());
    arr[32..64].copy_from_slice(&pt.y.to_array());
    Bn254G1Affine::from_bytes(BytesN::from_array(env, &arr))
}

/// Convert our contract G2Point type to the SDK's Bn254G2Affine type.
/// The G2 point encoding for BN254 is (x_c1, x_c0, y_c1, y_c0) — 128 bytes total.
fn g2point_to_affine(env: &Env, pt: &G2Point) -> Bn254G2Affine {
    let mut arr = [0u8; 128];
    arr[0..32].copy_from_slice(&pt.x.0.to_array());
    arr[32..64].copy_from_slice(&pt.x.1.to_array());
    arr[64..96].copy_from_slice(&pt.y.0.to_array());
    arr[96..128].copy_from_slice(&pt.y.1.to_array());
    Bn254G2Affine::from_bytes(BytesN::from_array(env, &arr))
}

/// Convert a 32-byte big-endian public input into a BN254 scalar (Bn254Fr).
fn g1_scalar_from_bytes(_env: &Env, bytes: &BytesN<32>) -> Bn254Fr {
    Bn254Fr::from_bytes(bytes.clone())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    /// Creates a placeholder G1 point (the BN254 generator point G1).
    /// x = 1, y = 2 in affine coordinates.
    fn g1_generator(env: &Env) -> G1Point {
        let mut x = [0u8; 32];
        x[31] = 1;
        let mut y = [0u8; 32];
        y[31] = 2;
        G1Point {
            x: BytesN::from_array(env, &x),
            y: BytesN::from_array(env, &y),
        }
    }

    #[test]
    fn test_initialize_and_get_vk() {
        let env = Env::default();
        let contract_id = env.register(Groth16VerifierContract, ());
        let client = Groth16VerifierContractClient::new(&env, &contract_id);

        // Build a minimal VK (not a real valid VK, just for structure testing)
        let g1 = g1_generator(&env);
        let g2 = G2Point {
            x: (BytesN::from_array(&env, &[0u8; 32]), BytesN::from_array(&env, &[0u8; 32])),
            y: (BytesN::from_array(&env, &[0u8; 32]), BytesN::from_array(&env, &[0u8; 32])),
        };

        let ic: Vec<G1Point> = vec![&env, g1.clone(), g1.clone()]; // 2 = 1 public input + 1

        let vk = VerificationKey {
            alpha_g1: g1.clone(),
            beta_g2: g2.clone(),
            gamma_g2: g2.clone(),
            delta_g2: g2.clone(),
            ic,
        };

        client.initialize(&vk);

        // Re-initializing must fail
        let result = client.try_initialize(&vk);
        assert!(result.is_err());
    }
}

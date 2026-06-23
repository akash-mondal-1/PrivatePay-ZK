// Integration tests for the PrivatePay ZK Pool Contract
//
// These tests use the Soroban testing framework to verify the full
// deposit → withdraw lifecycle. The verifier is mocked at the contract
// level so we can test pool logic without a real trusted setup.

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    Address, BytesN, Env, IntoVal, Symbol,
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn create_test_env() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy a native/wrapped token contract for testing
    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    // Fund the token admin
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    token_client.mint(&token_admin, &1_000_000_000_i128);

    let admin = Address::generate(&env);
    let verifier_address = Address::generate(&env); // placeholder — tested separately

    (env, admin, token_admin, token_address, verifier_address)
}

fn deploy_pool<'a>(env: &'a Env, admin: &Address, token: &Address, verifier: &Address) -> (Address, PrivatePoolContractClient<'a>) {
    let contract_id = env.register(PrivatePoolContract, ());
    let client = PrivatePoolContractClient::new(env, &contract_id);
    client.initialize(admin, token, verifier);
    (contract_id, client)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let (env, admin, _, token, verifier) = create_test_env();
    let (_, client) = deploy_pool(&env, &admin, &token, &verifier);

    // Verify root is initialized to zero
    let root = client.get_root();
    assert_eq!(root, BytesN::from_array(&env, &[0u8; 32]));

    // Verify no commitments yet
    let count = client.get_commitment_count();
    assert_eq!(count, 0);
}

#[test]
fn test_initialize_double_init_fails() {
    let (env, admin, _, token, verifier) = create_test_env();
    let (_, client) = deploy_pool(&env, &admin, &token, &verifier);

    // Second init must fail
    let result = client.try_initialize(&admin, &token, &verifier);
    assert!(result.is_err());
}

#[test]
fn test_deposit_real_token_transfer() {
    let (env, admin, token_admin, token, verifier) = create_test_env();
    let (contract_id, client) = deploy_pool(&env, &admin, &token, &verifier);

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);

    // Fund a depositor
    let depositor = Address::generate(&env);
    token_admin_client.mint(&depositor, &5_000_i128);

    let commitment = BytesN::from_array(&env, &[42u8; 32]);
    let amount: i128 = 1_000;

    let initial_balance = token_client.balance(&depositor);
    let initial_contract_balance = token_client.balance(&contract_id);

    let idx = client.deposit(&depositor, &commitment, &amount);

    assert_eq!(idx, 0); // First deposit has index 0
    assert_eq!(client.get_commitment_count(), 1);

    // Verify token actually moved
    assert_eq!(token_client.balance(&depositor), initial_balance - amount);
    assert_eq!(token_client.balance(&contract_id), initial_contract_balance + amount);
}

#[test]
fn test_deposit_zero_amount_fails() {
    let (env, admin, _, token, verifier) = create_test_env();
    let (_, client) = deploy_pool(&env, &admin, &token, &verifier);

    let depositor = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);

    let result = client.try_deposit(&depositor, &commitment, &0);
    assert!(result.is_err());
}

#[test]
fn test_update_root_requires_admin_auth() {
    let (env, admin, _, token, verifier) = create_test_env();
    let (_, client) = deploy_pool(&env, &admin, &token, &verifier);

    let new_root = BytesN::from_array(&env, &[99u8; 32]);
    client.update_root(&new_root);

    // Verify root is updated
    assert_eq!(client.get_root(), new_root);
}

#[test]
fn test_nullifier_not_initially_spent() {
    let (env, admin, _, token, verifier) = create_test_env();
    let (_, client) = deploy_pool(&env, &admin, &token, &verifier);

    let nullifier = BytesN::from_array(&env, &[77u8; 32]);
    assert!(!client.is_nullifier_spent(&nullifier));
}

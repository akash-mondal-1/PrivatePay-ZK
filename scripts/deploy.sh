#!/bin/bash

echo "Starting PrivatePay ZK Deployment..."

echo "1. Building Circom Circuits..."
cd circuits
npm install
npm run build
cd ..

echo "2. Building Soroban Contracts..."
cd contracts
soroban contract build
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/privatepay_pool.wasm --network testnet --source my-account > .pool_address
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/privatepay_verifier.wasm --network testnet --source my-account > .verifier_address

echo "Contracts deployed!"
echo "Pool Address: $(cat .pool_address)"
echo "Verifier Address: $(cat .verifier_address)"

echo "3. Starting Frontend..."
cd frontend
npm install
npm run dev

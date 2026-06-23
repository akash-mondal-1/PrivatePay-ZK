# Devpost Submission: PrivatePay ZK

## Elevator Pitch
Private payroll and business payments on Stellar with selective disclosure and compliance-ready zero-knowledge proofs.

## The Problem
Blockchain transparency is a double-edged sword. While it enables trustless verification, absolute transparency is a non-starter for business operations—specifically payroll. Employees should not see each other's salaries. Companies cannot expose their contractor payouts or operational burn rates to competitors. 

However, we can't simply obscure the data entirely. Auditors, regulators, and compliance teams must still be able to verify the legitimacy of these transactions. We need privacy with accountability.

## The Solution
**PrivatePay ZK** is a privacy pool built on Stellar using Soroban and Zero-Knowledge Proofs (Groth16). It allows users to:
1. Deposit funds privately.
2. Withdraw funds to fresh addresses without linking back to the depositor.
3. Generate "Compliance Proofs" (Selective Disclosure) that prove the legitimacy of a transaction to a specific auditor, while keeping the public in the dark.

## How it Works
1. **Deposit:** The employer generates a random `secret` and `nullifier` locally, hashes them to create a `commitment`, and deposits funds into the Soroban Pool contract alongside this commitment.
2. **ZK Proof Generation:** The employee generates a Groth16 proof locally in their browser using Circom and SnarkJS. This proves they know the preimage of a commitment in the pool's Merkle tree, without revealing *which* commitment it is.
3. **Soroban Verification:** The proof and the nullifier are sent to the Soroban Verifier contract. Soroban uses its native cryptographic host functions (BN254) to verify the proof. If valid, the funds are transferred, and the nullifier is stored to prevent double-spending.
4. **Selective Disclosure:** When audited, the user generates a separate ZK proof that reveals specific transaction details encrypted to the auditor's public key.

## Technologies Used
- **Stellar & Soroban:** For fast, low-cost settlement and on-chain ZK verification.
- **Circom & SnarkJS:** For designing the Groth16 circuits and generating proofs in the browser.
- **Rust:** For writing the Soroban smart contracts.
- **Next.js & Tailwind CSS:** For the professional, dark-themed user interface.

## Challenges we ran into
Integrating ZK proofs on-chain requires precise alignment of cryptographic curves and finite fields. Ensuring that the Circom BN254 outputs matched exactly what the Soroban host functions expected required deep dives into the serialization formats. Additionally, building a seamless UX where users don't have to understand "Merkle Trees" or "Nullifiers" to get paid was a significant design challenge.

## What's next for PrivatePay ZK
- **Multi-Asset Privacy:** Expanding beyond XLM to support USDC and custom Stellar assets.
- **Relayer Integration:** Allowing users to withdraw to wallets that have 0 XLM balance by paying transaction fees via a relayer network.
- **Full DAO Integration:** Plugging PrivatePay ZK directly into Stellar DAOs for automated, private contributor payments.

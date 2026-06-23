# PrivatePay ZK - 2-Minute Demo Script

## [0:00 - 0:20] The Problem
**Visual:** Slide showing public ledger transactions with a giant red "Exposed" stamp over a payroll transfer.
**Speaker:** "Blockchain is great for business, but absolute transparency is a dealbreaker for payroll. Employees shouldn't see each other's salaries, and companies can't expose their contractor payouts to competitors. But if we hide the data, how do auditors and regulators verify compliance? We need privacy with accountability."

## [0:20 - 0:40] The Solution (PrivatePay ZK)
**Visual:** Switch to the PrivatePay ZK Dashboard, dark themed, professional UI.
**Speaker:** "Welcome to PrivatePay ZK. It’s a privacy pool on Stellar built specifically for business payments using Soroban and Zero-Knowledge Proofs. We allow companies to pay employees privately, while generating compliance proofs for auditors—without revealing amounts to the public."

## [0:40 - 1:10] Demo: The Deposit & Transfer
**Visual:** Screen recording or live walkthrough of the 'Deposit' and 'Transfer' flow. User connects Freighter wallet, enters an amount, and clicks "Deposit".
**Speaker:** "First, the business deposits XLM or USDC into the Soroban Pool. Behind the scenes, the browser uses Circom and SnarkJS to generate a cryptographic commitment. No one on the network knows who this commitment belongs to."

## [1:10 - 1:40] Demo: The ZK Withdrawal
**Visual:** Switch to an "Employee" view. The user clicks "Withdraw". A loading spinner says "Generating ZK Proof...". The transaction confirms.
**Speaker:** "Now the employee wants to withdraw. Instead of a direct transfer from the employer, the employee generates a Groth16 Zero-Knowledge Proof locally. This proves they own a deposit in the pool *without revealing which one*. The Soroban smart contract verifies this proof natively using Stellar's host functions. The employee gets their money, completely breaking the public link to the employer."

## [1:40 - 2:00] Demo: Compliance & Conclusion
**Visual:** Show the "Auditor View". A selective disclosure proof is verified instantly.
**Speaker:** "But what about compliance? PrivatePay ZK includes a Selective Disclosure feature. Employees can generate a specific 'Compliance Proof' that reveals the transaction details *only* to a designated auditor's public key. The public sees nothing; the auditor sees everything they need. 
This is PrivatePay ZK: Real-world business privacy on Stellar."

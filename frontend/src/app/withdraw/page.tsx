"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileKey2, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Wallet } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import type { ProofResult } from "@/lib/zk";

type WithdrawStep = "input" | "proving" | "verifying" | "submitting" | "done";

export default function WithdrawPage() {
  const { isConnected, address, withdrawXLM, connect, getMerkleProof } = useWallet();
  const [step, setStep] = useState<WithdrawStep>("input");
  const [secret, setSecret] = useState("");
  const [nullifier, setNullifier] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const [localVerified, setLocalVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofTime, setProofTime] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Auto-fill recipient with connected address
  const handleAutoFill = () => {
    if (address) setRecipient(address);
  };

  const handleGenerateProof = async () => {
    if (!secret || !nullifier || !recipient || !amount) {
      setError("All fields are required.");
      return;
    }
    setError(null);
    setStep("proving");

    try {
      const { proveWithdraw, verifyLocally, computeNoteCommitmentAndNullifier } = await import("@/lib/zk");

      const startTime = performance.now();

      // Compute commitment and nullifier hash locally from secret & nullifier
      const { commitment, nullifierHash } = await computeNoteCommitmentAndNullifier(secret, nullifier);

      // Fetch actual Merkle path elements and indices from events on-chain
      const { pathElements, pathIndices, root } = await getMerkleProof(commitment);

      const proofInputs = {
        secret,
        nullifier,
        pathElements,
        pathIndices,
        root,
        nullifierHash: BigInt(nullifierHash).toString(10),
      };

      const result = await proveWithdraw(proofInputs);
      const elapsed = performance.now() - startTime;
      setProofTime(Math.round(elapsed));
      setProofResult(result);

      // Local pre-verification
      setStep("verifying");
      const isLocallyValid = await verifyLocally(
        "withdraw",
        result.proof,
        result.publicSignals
      );

      if (!isLocallyValid) {
        throw new Error("Local proof verification failed. Proof is invalid — do not submit.");
      }
      setLocalVerified(true);
      setStep("submitting");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("fetch") || msg.includes("wasm") || msg.includes("zkey")) {
        setError(
          "Circuit files not found at /public/circuits/withdraw/. " +
          "Run the circuit build script to compile and copy the WASM + zkey files."
        );
      } else {
        setError(`Proof generation failed: ${msg}`);
      }
      setStep("input");
    }
  };

  const handleSubmitWithdrawal = async () => {
    if (!proofResult || !recipient || !amount) return;
    if (!isConnected) {
      setError("Please connect your wallet first.");
      return;
    }
    setError(null);

    try {
      // Extract nullifier hash from public signals
      const nullifierHashHex = BigInt(proofResult.publicSignals[1]).toString(16).padStart(64, "0");

      const hash = await withdrawXLM(
        proofResult.proof,
        nullifierHashHex,
        recipient,
        amount
      );
      setTxHash(hash);
      setStep("done");
    } catch (err: any) {
      setError(`Submission failed: ${err?.message ?? String(err)}`);
    }
  };

  const isInputValid = secret.length > 0 && nullifier.length > 0 && recipient.length > 0 && amount.length > 0;

  return (
    <div className="container mx-auto px-4 py-20 flex justify-center items-start min-h-[80vh]">
      <Card className="w-full max-w-lg border-primary/20 bg-background/60 backdrop-blur-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/20 rounded-full">
              <FileKey2 className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-center text-2xl">Withdraw Funds</CardTitle>
          <CardDescription className="text-center">
            Generate a Groth16 Zero-Knowledge Proof locally. The proof is
            verified on-chain by the Soroban Groth16 Verifier contract using
            BN254 pairing host functions.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!isConnected && step === "input" && (
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm text-amber-400">
              <Wallet className="h-4 w-4 shrink-0" />
              <span>Connect your Freighter wallet to withdraw.</span>
              <Button size="sm" variant="outline" className="ml-auto border-amber-500/40 text-amber-400" onClick={connect}>
                Connect
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === "input" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="secret">Secret (from deposit note)</Label>
                <Input id="secret" type="password" placeholder="Paste secret value…" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nullifier">Nullifier (from deposit note)</Label>
                <Input id="nullifier" type="password" placeholder="Paste nullifier value…" value={nullifier} onChange={(e) => setNullifier(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (XLM)</Label>
                <Input id="amount" type="number" placeholder="e.g. 100" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipient">Recipient Address</Label>
                <div className="flex gap-2">
                  <Input id="recipient" placeholder="G…" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1" />
                  {isConnected && (
                    <Button size="sm" variant="outline" onClick={handleAutoFill} className="shrink-0">
                      Use Mine
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          {(step === "proving" || step === "verifying") && (
            <div className="flex flex-col items-center py-8 gap-4">
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
              <div className="text-center">
                <p className="font-medium">{step === "proving" ? "Generating Groth16 Proof…" : "Verifying Proof Locally…"}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {step === "proving"
                    ? "Running the witness computation and Groth16 prover in your browser."
                    : "Checking the proof against the verification key before submission."}
                </p>
              </div>
            </div>
          )}

          {(step === "submitting" || step === "done") && proofResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-500 font-semibold">
                <CheckCircle2 className="h-5 w-5" />
                Proof Verified Locally
                {proofTime && <span className="text-xs text-muted-foreground ml-auto font-normal">({proofTime}ms)</span>}
              </div>
              <div className="p-3 bg-white/5 border border-white/10 rounded-md font-mono text-xs break-all text-muted-foreground space-y-1">
                <div><span className="text-primary/70">pi_a[0]:</span> {proofResult.proof.pi_a[0].slice(0, 18)}…</div>
                <div><span className="text-primary/70">pi_b[0][0]:</span> {proofResult.proof.pi_b[0][0].slice(0, 18)}…</div>
                <div><span className="text-primary/70">pi_c[0]:</span> {proofResult.proof.pi_c[0].slice(0, 18)}…</div>
                <div><span className="text-green-500/70">public[0] (root):</span> {proofResult.publicSignals[0]?.slice(0, 18)}…</div>
                <div><span className="text-green-500/70">public[1] (nullifier_hash):</span> {proofResult.publicSignals[1]?.slice(0, 18)}…</div>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="flex items-center gap-2 text-green-500 font-semibold">
                <CheckCircle2 className="h-5 w-5" />
                Withdrawal submitted and verified on-chain!
              </div>
              {txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View on Stellar Expert <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter>
          {step === "input" && (
            <Button className="w-full h-12 text-base" onClick={handleGenerateProof} disabled={!isInputValid || !isConnected}>
              Generate ZK Proof Locally
            </Button>
          )}
          {(step === "proving" || step === "verifying") && (
            <Button className="w-full h-12 text-base" disabled>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {step === "proving" ? "Computing Proof…" : "Verifying…"}
            </Button>
          )}
          {step === "submitting" && (
            <Button className="w-full h-12 text-base bg-green-600 hover:bg-green-700 text-white" onClick={handleSubmitWithdrawal}>
              Submit to Soroban Verifier
            </Button>
          )}
          {step === "done" && (
            <Button className="w-full h-12 text-base" variant="outline" onClick={() => { setStep("input"); setProofResult(null); setTxHash(null); }}>
              Withdraw Again
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

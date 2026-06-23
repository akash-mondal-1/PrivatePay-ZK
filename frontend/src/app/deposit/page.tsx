"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, Copy, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import type { ZKNote } from "@/lib/zk";

type DepositStep = "input" | "generating" | "ready" | "submitting" | "done";

export default function DepositPage() {
  const { isConnected, address, xlmBalance, depositXLM, connect } = useWallet();
  const [step, setStep] = useState<DepositStep>("input");
  const [amount, setAmount] = useState("");
  const [commitment, setCommitment] = useState<ZKNote | null>(null);
  const [secretPhraseCopied, setSecretPhraseCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleGenerateCommitment = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a valid amount greater than 0.");
      return;
    }
    setError(null);
    setStep("generating");

    try {
      const { generateNote } = await import("@/lib/zk");
      const newCommitment = await generateNote();
      setCommitment(newCommitment);
      setStep("ready");
    } catch (err: any) {
      setError(`Failed to generate commitment: ${err?.message ?? String(err)}`);
      setStep("input");
    }
  };

  const handleCopySecret = () => {
    if (!commitment) return;
    const phrase = JSON.stringify({
      secret: commitment.secret,
      nullifier: commitment.nullifier,
      nullifierHash: commitment.nullifierHash,
      note: "KEEP THIS SAFE. Required for withdrawal. Never share.",
    }, null, 2);
    navigator.clipboard.writeText(phrase);
    setSecretPhraseCopied(true);
    setTimeout(() => setSecretPhraseCopied(false), 3000);
  };

  const handleSubmitDeposit = async () => {
    if (!commitment || !amount) return;
    if (!isConnected) {
      setError("Please connect your wallet first.");
      return;
    }
    setStep("submitting");
    setError(null);

    try {
      // Remove 0x prefix from commitment hex for the contract
      const commitmentHex = commitment.commitment.replace(/^0x/, "");
      const hash = await depositXLM(amount, commitmentHex);
      setTxHash(hash);
      setStep("done");
    } catch (err: any) {
      setError(`Transaction failed: ${err?.message ?? String(err)}`);
      setStep("ready");
    }
  };

  const handleReset = () => {
    setStep("input");
    setAmount("");
    setCommitment(null);
    setError(null);
    setTxHash(null);
    setSecretPhraseCopied(false);
  };

  return (
    <div className="container mx-auto px-4 py-20 flex justify-center items-start min-h-[80vh]">
      <Card className="w-full max-w-lg border-primary/20 bg-background/60 backdrop-blur-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/20 rounded-full">
              <Lock className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-center text-2xl">Private Deposit</CardTitle>
          <CardDescription className="text-center">
            Deposit XLM into the privacy pool. A cryptographic commitment is
            generated locally using Poseidon hash — your identity is never
            linked to this deposit.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Wallet status */}
          {!isConnected && step === "input" && (
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Connect your Freighter wallet to deposit.</span>
              <Button size="sm" variant="outline" className="ml-auto border-amber-500/40 text-amber-400" onClick={connect}>
                Connect
              </Button>
            </div>
          )}

          {isConnected && step === "input" && (
            <div className="p-2 bg-green-500/10 border border-green-500/20 rounded-md text-xs text-green-400">
              Connected: {address?.slice(0, 6)}…{address?.slice(-4)} · Balance: {xlmBalance} XLM
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {(step === "input" || step === "generating") && (
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (XLM)</Label>
              <Input
                id="amount"
                placeholder="e.g. 100"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={step === "generating"}
              />
            </div>
          )}

          {(step === "ready" || step === "submitting" || step === "done") && commitment && (
            <div className="space-y-4">
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-md">
                <p className="text-xs text-primary font-semibold mb-1">
                  Commitment (submitted on-chain):
                </p>
                <p className="text-xs font-mono break-all text-muted-foreground">
                  {commitment.commitment}
                </p>
              </div>

              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-md space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  Save Your Secret — Required for Withdrawal
                </div>
                <p className="text-xs text-muted-foreground">
                  This is the <strong>only time</strong> you will see your secret and nullifier.
                  If you lose them, your funds cannot be recovered.
                </p>
                <div className="bg-background/50 rounded p-2 font-mono text-xs break-all text-muted-foreground">
                  <div><span className="text-primary/70">secret:</span> {commitment.secret.slice(0, 20)}…</div>
                  <div><span className="text-primary/70">nullifier:</span> {commitment.nullifier.slice(0, 20)}…</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                  onClick={handleCopySecret}
                >
                  {secretPhraseCopied ? (
                    <><CheckCircle2 className="h-4 w-4 mr-2" /> Copied!</>
                  ) : (
                    <><Copy className="h-4 w-4 mr-2" /> Copy Secret Note</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center py-4 gap-3">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-green-500 font-semibold">Deposit Confirmed!</p>
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
              <p className="text-xs text-center text-muted-foreground">
                Your commitment is now registered on-chain. The privacy pool admin
                will update the Merkle root to include your deposit.
              </p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          {step === "input" && (
            <Button className="w-full h-12 text-base" onClick={handleGenerateCommitment} disabled={!isConnected}>
              Generate Commitment
            </Button>
          )}
          {step === "generating" && (
            <Button className="w-full h-12 text-base" disabled>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Computing Poseidon Hash…
            </Button>
          )}
          {step === "ready" && (
            <Button
              className="w-full h-12 text-base"
              onClick={handleSubmitDeposit}
              disabled={!secretPhraseCopied}
            >
              {secretPhraseCopied
                ? "Submit Deposit to Soroban"
                : "Copy Secret First to Continue"}
            </Button>
          )}
          {step === "submitting" && (
            <Button className="w-full h-12 text-base" disabled>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Submitting Transaction…
            </Button>
          )}
          {step === "done" && (
            <Button className="w-full h-12 text-base" variant="outline" onClick={handleReset}>
              Make Another Deposit
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

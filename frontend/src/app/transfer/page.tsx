"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, Loader2, ArrowRightLeft, AlertTriangle, CheckCircle2, ExternalLink, Wallet, Info } from "lucide-react";
import { useWallet } from "@/context/WalletContext";

export default function TransferPage() {
  const { isConnected, address, connect, depositXLM } = useWallet();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "generating" | "submitting" | "done">("input");
  const [amount, setAmount] = useState("");
  const [recipientNote, setRecipientNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [newCommitment, setNewCommitment] = useState<string | null>(null);

  /**
   * Private Transfer flow:
   * 1. User generates a new commitment for the recipient
   * 2. User deposits into the pool with the recipient's commitment
   * 3. Recipient can withdraw with their secret/nullifier
   * 
   * In a full implementation, the sender would first withdraw their own
   * funds (proving ownership via ZK proof), then deposit with the recipient's
   * commitment. For MVP, this page creates a fresh commitment and deposits.
   */
  const handleTransfer = async () => {
    if (!amount || !isConnected) return;
    setError(null);
    setStep("generating");

    try {
      // Generate a new commitment for the recipient
      const { generateNote } = await import("@/lib/zk");
      const note = await generateNote();
      setNewCommitment(JSON.stringify({
        secret: note.secret,
        nullifier: note.nullifier,
        nullifierHash: note.nullifierHash,
        note: "Transfer commitment. Give this to the recipient to withdraw.",
      }, null, 2));

      setStep("submitting");

      // Deposit the commitment on-chain for the recipient
      const commitmentHex = note.commitment.replace(/^0x/, "");
      const hash = await depositXLM(amount, commitmentHex);
      setTxHash(hash);
      setStep("done");
    } catch (err: any) {
      setError(`Transfer failed: ${err?.message ?? String(err)}`);
      setStep("input");
    }
  };

  const handleCopyNote = () => {
    if (newCommitment) {
      navigator.clipboard.writeText(newCommitment);
    }
  };

  const handleReset = () => {
    setStep("input");
    setAmount("");
    setRecipientNote("");
    setError(null);
    setTxHash(null);
    setNewCommitment(null);
  };

  return (
    <div className="container mx-auto px-4 py-20 flex justify-center items-center min-h-[80vh]">
      <Card className="w-full max-w-md border-primary/20 bg-background/60 backdrop-blur-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/20 rounded-full">
              <ArrowRightLeft className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-center text-2xl">Private Transfer</CardTitle>
          <CardDescription className="text-center">
            Create a shielded commitment for the recipient and deposit it on-chain. 
            Share the secret note with the recipient so they can withdraw privately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isConnected && step === "input" && (
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm text-amber-400">
              <Wallet className="h-4 w-4 shrink-0" />
              <span>Connect your wallet to transfer.</span>
              <Button size="sm" variant="outline" className="ml-auto border-amber-500/40 text-amber-400" onClick={connect}>
                Connect
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {step === "input" && (
            <>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md text-xs text-blue-400 flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  This generates a new Poseidon commitment and deposits it into the pool. 
                  Share the resulting secret note with the recipient — they use it to withdraw anonymously.
                </span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (XLM)</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="e.g. 100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </>
          )}

          {step === "generating" && (
            <div className="flex flex-col items-center py-6 gap-3">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="text-sm font-medium">Generating commitment for recipient…</p>
            </div>
          )}

          {step === "submitting" && (
            <div className="flex flex-col items-center py-6 gap-3">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="text-sm font-medium">Submitting to Soroban…</p>
              <p className="text-xs text-muted-foreground">Sign the transaction in Freighter</p>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-4 space-y-4">
              <div className="h-16 w-16 bg-green-500/20 rounded-full flex items-center justify-center">
                <Send className="h-8 w-8 text-green-500" />
              </div>
              <p className="text-lg font-medium text-center text-green-500">Transfer Committed!</p>
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
              {newCommitment && (
                <div className="w-full space-y-2">
                  <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Share this secret note with the recipient:
                  </p>
                  <textarea
                    className="w-full h-24 bg-white/5 border border-white/10 rounded-md p-2 font-mono text-xs resize-none text-muted-foreground"
                    readOnly
                    value={newCommitment}
                  />
                  <Button size="sm" variant="outline" className="w-full" onClick={handleCopyNote}>
                    Copy Recipient Secret Note
                  </Button>
                </div>
              )}
              <p className="text-sm text-center text-muted-foreground">
                The recipient can use the secret note above to withdraw anonymously from the pool.
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          {step === "input" && (
            <Button
              className="w-full h-12 text-lg"
              onClick={handleTransfer}
              disabled={!isConnected || !amount}
            >
              Send Privately
            </Button>
          )}
          {step === "done" && (
            <Button className="w-full h-12 text-lg" onClick={handleReset}>
              Make Another Transfer
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

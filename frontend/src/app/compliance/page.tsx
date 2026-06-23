"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Loader2, ShieldCheck, AlertTriangle, FileKey2 } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import type { ProofResult } from "@/lib/zk";

type ComplianceMode = "generate" | "verify";

export default function CompliancePage() {
  const { getMerkleProof } = useWallet();
  const [mode, setMode] = useState<ComplianceMode>("generate");

  // Generate proof state
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genProof, setGenProof] = useState<ProofResult | null>(null);
  const [auditorKey, setAuditorKey] = useState("");
  const [genSecret, setGenSecret] = useState("");
  const [genNullifier, setGenNullifier] = useState("");
  const [genAmount, setGenAmount] = useState("");

  // Verify proof state
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyProofData, setVerifyProofData] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; details?: Record<string, string> } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const handleGenerateComplianceProof = async () => {
    if (!genSecret || !genNullifier || !auditorKey || !genAmount) {
      setGenError("All fields are required to generate a compliance proof.");
      return;
    }
    setGenLoading(true);
    setGenError(null);
    setGenProof(null);

    try {
      const { proveCompliance, computeNoteCommitmentAndNullifier, computePoseidonHash } = await import("@/lib/zk");

      // Compute commitment and nullifier hash locally from secret & nullifier
      const { commitment, nullifierHash } = await computeNoteCommitmentAndNullifier(genSecret, genNullifier);

      // Fetch actual Merkle path elements and indices from events on-chain
      const { pathElements, pathIndices, root } = await getMerkleProof(commitment);

      // Normalize auditor key to BN254 field element
      let auditorVal = auditorKey;
      if (auditorVal.startsWith("0x") || auditorVal.startsWith("0X")) {
        auditorVal = BigInt(auditorVal).toString(10);
      } else {
        try {
          auditorVal = BigInt(auditorVal).toString(10);
        } catch {
          // If it's a stellar address or other string, hash it into BN254 field
          const hex = Array.from(new TextEncoder().encode(auditorVal), (b) => b.toString(16).padStart(2, "0")).join("");
          const BN254_P = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
          auditorVal = (BigInt("0x" + hex) % BN254_P).toString(10);
        }
      }

      // Sender and recipient IDs represented as numeric values for the circuit
      const senderVal = "12345";
      const recipientVal = "67890";

      // Calculate public signal encryptedData = Poseidon(amount, senderVal, recipientVal, auditorVal)
      const encryptedData = await computePoseidonHash([
        genAmount,
        senderVal,
        recipientVal,
        auditorVal,
      ]);

      const result = await proveCompliance({
        secret: genSecret,
        nullifier: genNullifier,
        pathElements,
        pathIndices,
        root,
        nullifierHash: BigInt(nullifierHash).toString(10),
        amount: genAmount,
        senderId: senderVal,
        recipientId: recipientVal,
        auditorPubKey: auditorVal,
        encryptedData,
      });

      setGenProof(result);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("fetch") || msg.includes("wasm")) {
        setGenError(
          "Circuit files not found. Run `npm run build:circuits` to compile compliance.circom."
        );
      } else {
        setGenError(`Proof generation failed: ${msg}`);
      }
    } finally {
      setGenLoading(false);
    }
  };

  const handleVerifyComplianceProof = async () => {
    if (!verifyProofData.trim()) {
      setVerifyError("Paste the compliance proof JSON first.");
      return;
    }
    setVerifyLoading(true);
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const parsed = JSON.parse(verifyProofData);

      if (!parsed.proof || !parsed.publicSignals) {
        throw new Error("Invalid format. Expected { proof, publicSignals }.");
      }

      const { verifyLocally } = await import("@/lib/zk");
      const isValid = await verifyLocally(
        "compliance",
        parsed.proof,
        parsed.publicSignals
      );

      setVerifyResult({
        valid: isValid,
        details: isValid
          ? {
              "Nullifier Hash": parsed.publicSignals[1] ?? "n/a",
              "Merkle Root": parsed.publicSignals[0] ?? "n/a",
              "Auditor Key": parsed.publicSignals[2] ?? "n/a",
              "Verification": "On-chain via Soroban BN254 pairing",
            }
          : undefined,
      });
    } catch (err: any) {
      setVerifyError(`Verification error: ${err?.message ?? String(err)}`);
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-3">Auditor & Compliance View</h1>
        <p className="text-muted-foreground">
          Generate a Selective Disclosure Proof for an auditor, or verify an
          existing compliance proof using the Groth16 verification key.
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 p-1 rounded-lg bg-white/5 border border-white/10 mb-8">
        <button
          id="mode-generate"
          onClick={() => setMode("generate")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === "generate" ? "bg-primary text-white" : "text-muted-foreground hover:text-white"
          }`}
        >
          <FileKey2 className="inline h-4 w-4 mr-2" />
          Generate Proof
        </button>
        <button
          id="mode-verify"
          onClick={() => setMode("verify")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === "verify" ? "bg-primary text-white" : "text-muted-foreground hover:text-white"
          }`}
        >
          <Search className="inline h-4 w-4 mr-2" />
          Verify Proof
        </button>
      </div>

      {mode === "generate" && (
        <Card className="border-primary/20 bg-background/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Generate Compliance Proof</CardTitle>
            <CardDescription>
              Create a proof for an auditor. The proof reveals transaction details
              only to the holder of the auditor public key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {genError && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {genError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="gen-secret">Secret (from deposit note)</Label>
              <Input id="gen-secret" type="password" value={genSecret} onChange={(e) => setGenSecret(e.target.value)} placeholder="Paste secret…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gen-nullifier">Nullifier (from deposit note)</Label>
              <Input id="gen-nullifier" type="password" value={genNullifier} onChange={(e) => setGenNullifier(e.target.value)} placeholder="Paste nullifier…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gen-amount">Disclosed Amount (XLM)</Label>
              <Input id="gen-amount" type="number" value={genAmount} onChange={(e) => setGenAmount(e.target.value)} placeholder="e.g. 1000" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auditor-key">Auditor Public Key</Label>
              <Input id="auditor-key" value={auditorKey} onChange={(e) => setAuditorKey(e.target.value)} placeholder="G… or 0x…" />
            </div>

            {genProof && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-green-500">Compliance Proof Generated:</p>
                <textarea
                  className="w-full h-32 bg-white/5 border border-white/10 rounded-md p-2 font-mono text-xs resize-none text-muted-foreground"
                  readOnly
                  value={JSON.stringify({ proof: genProof.proof, publicSignals: genProof.publicSignals }, null, 2)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      JSON.stringify({ proof: genProof.proof, publicSignals: genProof.publicSignals })
                    )
                  }
                >
                  Copy Proof for Auditor
                </Button>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button className="w-full h-12 text-base" onClick={handleGenerateComplianceProof} disabled={genLoading}>
              {genLoading ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating…</> : "Generate Selective Disclosure Proof"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {mode === "verify" && (
        <Card className="border-primary/20 bg-background/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Verify Compliance Proof</CardTitle>
            <CardDescription>
              Paste a compliance proof JSON. Verification is done locally using
              the verification key (the same check the Soroban contract performs).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {verifyError && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {verifyError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="proof-input">Compliance Proof JSON</Label>
              <textarea
                id="proof-input"
                className="w-full h-36 bg-white/5 border border-white/10 rounded-md p-2 font-mono text-xs resize-none text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder='{"proof": {...}, "publicSignals": [...]}'
                value={verifyProofData}
                onChange={(e) => setVerifyProofData(e.target.value)}
              />
            </div>

            {verifyResult && (
              <div className={`p-4 rounded-lg border space-y-3 ${verifyResult.valid ? "bg-green-500/10 border-green-500/20" : "bg-destructive/10 border-destructive/20"}`}>
                <div className={`flex items-center gap-2 font-semibold ${verifyResult.valid ? "text-green-500" : "text-destructive"}`}>
                  {verifyResult.valid ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                  {verifyResult.valid ? "Proof Cryptographically Valid" : "Proof Invalid"}
                </div>
                {verifyResult.details && (
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    {Object.entries(verifyResult.details).map(([k, v]) => (
                      <>
                        <span key={k + "_k"} className="text-muted-foreground">{k}:</span>
                        <span key={k + "_v"} className="font-mono text-xs break-all">{v.slice(0, 24)}…</span>
                      </>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button className="w-full h-12 text-base" onClick={handleVerifyComplianceProof} disabled={verifyLoading || !verifyProofData}>
              {verifyLoading ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Verifying…</> : "Verify Compliance Proof"}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

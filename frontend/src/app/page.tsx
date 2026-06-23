import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Shield, EyeOff, FileCheck2, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full relative overflow-hidden">
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[40rem] w-[40rem] bg-primary/20 blur-[100px] rounded-full" />
      </div>

      <div className="container px-4 md:px-6 relative z-10 flex flex-col items-center text-center pt-20 pb-32">
        <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-8">
          Stellar Hacks: Real-World ZK Submission
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl mb-6">
          Payroll privacy for the <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">
            transparent ledger.
          </span>
        </h1>
        <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8 mb-10">
          Private payroll and business payments on Stellar. Use Zero-Knowledge proofs to pay employees confidentially while retaining the ability to generate compliance reports for auditors.
        </p>
        <div className="flex gap-4 flex-col sm:flex-row">
          <Link href="/deposit">
            <Button size="lg" className="h-12 px-8 font-semibold text-base w-full sm:w-auto">
              Open App <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          <Link href="/compliance">
            <Button size="lg" variant="outline" className="h-12 px-8 font-semibold text-base w-full sm:w-auto border-white/20">
              Auditor View
            </Button>
          </Link>
        </div>
      </div>

      {/* Feature Section */}
      <div className="container px-4 md:px-6 py-20 relative z-10 bg-background/50 border-t border-white/5 w-full max-w-none">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
          <div className="flex flex-col items-center space-y-4 text-center p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
            <div className="p-3 bg-primary/20 rounded-full">
              <EyeOff className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-bold">Absolute Privacy</h3>
            <p className="text-muted-foreground">
              Employees withdraw funds using Groth16 proofs. No public link exists between the employer's deposit and the employee's withdrawal.
            </p>
          </div>
          <div className="flex flex-col items-center space-y-4 text-center p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
            <div className="p-3 bg-primary/20 rounded-full">
              <FileCheck2 className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-bold">Selective Disclosure</h3>
            <p className="text-muted-foreground">
              Generate off-chain compliance proofs that allow auditors to cryptographically verify the legitimacy of any transaction.
            </p>
          </div>
          <div className="flex flex-col items-center space-y-4 text-center p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors sm:col-span-2 lg:col-span-1">
            <div className="p-3 bg-primary/20 rounded-full">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-bold">Soroban Native</h3>
            <p className="text-muted-foreground">
              Built on Stellar's new smart contract platform, leveraging advanced cryptographic host functions for cheap, fast ZK verification.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

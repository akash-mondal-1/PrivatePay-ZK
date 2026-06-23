"use client";

import Link from "next/link";
import { ShieldAlert, Wallet, LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { useWallet } from "@/context/WalletContext";

export function Navbar() {
  const { address, isConnected, isConnecting, xlmBalance, connect, disconnect } = useWallet();

  const shortAddr = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/80 backdrop-blur">
      <div className="container flex h-16 items-center mx-auto px-4 justify-between">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center space-x-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            <span className="font-bold sm:inline-block">PrivatePay ZK</span>
          </Link>
          <nav className="hidden md:flex gap-6 ml-6">
            <Link href="/dashboard" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Dashboard
            </Link>
            <Link href="/deposit" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Deposit
            </Link>
            <Link href="/transfer" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Transfer
            </Link>
            <Link href="/withdraw" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Withdraw
            </Link>
            <Link href="/compliance" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Auditor View
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {isConnected && address ? (
            <>
              <div className="hidden sm:flex flex-col items-end text-xs">
                <span className="text-muted-foreground font-mono">{shortAddr}</span>
                <span className="text-primary font-semibold">{xlmBalance} XLM</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-white/20 text-white hover:bg-white/10 gap-2"
                onClick={disconnect}
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Disconnect</span>
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 gap-2"
              onClick={connect}
              disabled={isConnecting}
            >
              <Wallet className="h-4 w-4" />
              {isConnecting ? "Connecting…" : "Connect Wallet"}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

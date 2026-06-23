"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, Wallet, ArrowUpRight, ArrowDownLeft, Hash, RefreshCw, Loader2 } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const { isConnected, address, tvl, totalCommitments, merkleRoot, recentEvents, fetchPoolStats, fetchLiveEvents } = useWallet();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPoolStats();
    await fetchLiveEvents();
    setRefreshing(false);
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Pool Dashboard</h1>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-2">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* Connection status */}
      {isConnected && address && (
        <div className="mb-6 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400">
          Connected: <span className="font-mono">{address.slice(0, 8)}…{address.slice(-6)}</span>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value Locked</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tvl} XLM</div>
            <p className="text-xs text-muted-foreground">Live from Soroban RPC</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Commitments</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCommitments}</div>
            <p className="text-xs text-muted-foreground">On-chain deposits</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Merkle Root</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-mono break-all">{merkleRoot}</div>
            <p className="text-xs text-muted-foreground">Current root hash</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Network</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">Testnet</div>
            <p className="text-xs text-muted-foreground">Stellar Soroban</p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-2xl font-semibold mb-6 mt-12">Recent On-Chain Activity</h2>
      <Card>
        <CardContent className="p-0">
          {recentEvents.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No on-chain events found yet.</p>
              <p className="text-xs mt-1">Events will appear here as deposits and withdrawals happen on Testnet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentEvents.slice(0, 10).map((evt) => (
                <div key={evt.id} className="flex items-center justify-between p-5 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      evt.type === "deposit" ? "bg-primary/20" : evt.type === "withdraw" ? "bg-green-500/20" : "bg-amber-500/20"
                    }`}>
                      {evt.type === "deposit" && <ArrowUpRight className="h-5 w-5 text-primary" />}
                      {evt.type === "withdraw" && <ArrowDownLeft className="h-5 w-5 text-green-500" />}
                      {evt.type === "new_root" && <Hash className="h-5 w-5 text-amber-500" />}
                    </div>
                    <div>
                      <p className="font-medium capitalize">{evt.type.replace("_", " ")}</p>
                      <p className="text-sm text-muted-foreground font-mono">
                        {evt.type === "deposit" && evt.commitment && `Commitment: ${evt.commitment.slice(0, 12)}…`}
                        {evt.type === "withdraw" && evt.nullifierHash && `Nullifier: ${evt.nullifierHash.slice(0, 12)}…`}
                        {evt.type === "new_root" && evt.root && `Root: ${evt.root.slice(0, 12)}…`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {evt.amount && (
                      <p className="font-medium">
                        {evt.type === "deposit" ? "+" : "-"}{evt.amount} XLM
                      </p>
                    )}
                    {evt.type === "new_root" && (
                      <p className="text-xs text-amber-400">Merkle Updated</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

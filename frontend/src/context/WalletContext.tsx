"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { Buffer } from "buffer";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import {
  rpc,
  Contract,
  xdr,
  TransactionBuilder,
  Networks,
  Address,
  nativeToScVal,
  scValToNative,
  Account,
  Keypair,
} from "@stellar/stellar-sdk";

// Helper for hex conversion (avoids Node.js Buffer in browser)
function hexToUint8Array(hexStr: string): Uint8Array {
  const cleanHex = hexStr.replace(/^0x/, "");
  const len = cleanHex.length;
  const arr = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    arr[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return arr;
}

// Convert snarkjs Groth16 proof into ScVal Map for Soroban Proof struct
function encodeProofToScVal(proof: any): xdr.ScVal {
  const g1ToScVal = (pt: any) => {
    const xArr = hexToUint8Array(BigInt(pt[0]).toString(16).padStart(64, "0"));
    const yArr = hexToUint8Array(BigInt(pt[1]).toString(16).padStart(64, "0"));
    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("x"),
        val: xdr.ScVal.scvBytes(Buffer.from(xArr)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("y"),
        val: xdr.ScVal.scvBytes(Buffer.from(yArr)),
      }),
    ]);
  };

  const g2ToScVal = (pt: any) => {
    // snarkjs coordinate is [c0, c1]; Soroban expects [c1, c0]
    const xc1 = hexToUint8Array(BigInt(pt[0][1]).toString(16).padStart(64, "0"));
    const xc0 = hexToUint8Array(BigInt(pt[0][0]).toString(16).padStart(64, "0"));
    const yc1 = hexToUint8Array(BigInt(pt[1][1]).toString(16).padStart(64, "0"));
    const yc0 = hexToUint8Array(BigInt(pt[1][0]).toString(16).padStart(64, "0"));

    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("x"),
        val: xdr.ScVal.scvVec([
          xdr.ScVal.scvBytes(Buffer.from(xc1)),
          xdr.ScVal.scvBytes(Buffer.from(xc0)),
        ]),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("y"),
        val: xdr.ScVal.scvVec([
          xdr.ScVal.scvBytes(Buffer.from(yc1)),
          xdr.ScVal.scvBytes(Buffer.from(yc0)),
        ]),
      }),
    ]);
  };

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("a"),
      val: g1ToScVal(proof.pi_a),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("b"),
      val: g2ToScVal(proof.pi_b),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("c"),
      val: g1ToScVal(proof.pi_c),
    }),
  ]);
}

export interface LiveEvent {
  id: string;
  type: "deposit" | "withdraw" | "new_root";
  user?: string;
  commitment?: string;
  amount?: string;
  nullifierHash?: string;
  recipient?: string;
  root?: string;
  timestamp: number;
}

export interface WalletContextProps {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  xlmBalance: string;
  tvl: string;
  totalCommitments: number;
  merkleRoot: string;
  recentEvents: LiveEvent[];
  connect: () => Promise<void>;
  disconnect: () => void;
  fetchBalance: (addr?: string) => Promise<void>;
  fetchPoolStats: () => Promise<void>;
  depositXLM: (amount: string, commitmentHex: string) => Promise<string>;
  withdrawXLM: (proof: any, nullifierHashHex: string, recipient: string, amount: string) => Promise<string>;
  fetchLiveEvents: () => Promise<LiveEvent[]>;
  getMerkleProof: (commitmentHex: string) => Promise<{
    pathElements: string[];
    pathIndices: number[];
    root: string;
  }>;
}

const WalletContext = createContext<WalletContextProps | undefined>(undefined);

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const rpcServer = new rpc.Server(RPC_URL);

const POOL_CONTRACT_ID = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID || "";

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [xlmBalance, setXlmBalance] = useState<string>("0");
  const [tvl, setTvl] = useState<string>("0");
  const [totalCommitments, setTotalCommitments] = useState<number>(0);
  const [merkleRoot, setMerkleRoot] = useState<string>("N/A");
  const [recentEvents, setRecentEvents] = useState<LiveEvent[]>([]);
  // Initialize wallet kit on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      StellarWalletsKit.init({
        modules: [new FreighterModule()],
        network: Networks.TESTNET as any,
      });
    }
  }, []);

  // Fetch XLM balance from Horizon (native balance)
  const fetchBalance = useCallback(async (addr?: string) => {
    const targetAddr = addr || address;
    if (!targetAddr) return;

    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${targetAddr}`);
      if (!res.ok) {
        setXlmBalance("0");
        return;
      }
      const data = await res.json();
      const nativeBalance = data.balances?.find((b: any) => b.asset_type === "native");
      setXlmBalance(nativeBalance ? parseFloat(nativeBalance.balance).toFixed(2) : "0");
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    }
  }, [address]);

  // Create a simulation-only Account for building read-only transactions
  const getSimulationAccount = async (addr?: string): Promise<Account> => {
    const pubKey = addr || address;
    if (pubKey) {
      try {
        const res = await fetch(`${HORIZON_URL}/accounts/${pubKey}`);
        if (res.ok) {
          const data = await res.json();
          return new Account(pubKey, data.sequence);
        }
      } catch {}
    }
    // Fallback: use a random keypair for simulation-only calls
    const randomKey = Keypair.random().publicKey();
    return new Account(randomKey, "0");
  };

  // Fetch pool stats (TVL, count, root) via simulation
  const fetchPoolStats = useCallback(async () => {
    if (!POOL_CONTRACT_ID) return;

    try {
      const simulationAccount = await getSimulationAccount();
      const poolContract = new Contract(POOL_CONTRACT_ID);

      // Fetch commitment count
      try {
        const txCount = new TransactionBuilder(simulationAccount, {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(poolContract.call("get_commitment_count"))
          .setTimeout(30)
          .build();

        const simResCount = await rpcServer.simulateTransaction(txCount);
        if (
          rpc.Api.isSimulationSuccess(simResCount) &&
          simResCount.result?.retval
        ) {
          const count = scValToNative(simResCount.result.retval);
          setTotalCommitments(Number(count));
        }
      } catch (e) {
        console.warn("Failed to fetch commitment count:", e);
      }

      // Fetch root
      try {
        const txRoot = new TransactionBuilder(await getSimulationAccount(), {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(poolContract.call("get_root"))
          .setTimeout(30)
          .build();

        const simResRoot = await rpcServer.simulateTransaction(txRoot);
        if (
          rpc.Api.isSimulationSuccess(simResRoot) &&
          simResRoot.result?.retval
        ) {
          const rootBytes = scValToNative(simResRoot.result.retval);
          if (rootBytes instanceof Uint8Array) {
            const rootHex = Array.from(rootBytes, (b) =>
              b.toString(16).padStart(2, "0")
            ).join("");
            setMerkleRoot("0x" + rootHex.slice(0, 8) + "…" + rootHex.slice(-8));
          }
        }
      } catch (e) {
        console.warn("Failed to fetch root:", e);
      }

      // Fetch TVL (pool's XLM balance from Horizon)
      try {
        const res = await fetch(`${HORIZON_URL}/accounts/${POOL_CONTRACT_ID}`);
        if (res.ok) {
          const data = await res.json();
          const nativeBalance = data.balances?.find((b: any) => b.asset_type === "native");
          setTvl(nativeBalance ? parseFloat(nativeBalance.balance).toFixed(2) : "0");
        }
      } catch (e) {
        console.warn("Failed to fetch TVL:", e);
      }
    } catch (err) {
      console.error("Failed to fetch pool stats:", err);
    }
  }, [address]);

  // Poll pool stats periodically
  useEffect(() => {
    fetchPoolStats();
    fetchLiveEvents().then(setRecentEvents).catch(console.error);

    const interval = setInterval(() => {
      fetchPoolStats();
      fetchLiveEvents().then(setRecentEvents).catch(console.error);
    }, 20000);

    return () => clearInterval(interval);
  }, []);

  const connect = async () => {
    setIsConnecting(true);
    try {
      const { address: userAddr } = await StellarWalletsKit.authModal();
      setAddress(userAddr);
      setIsConnected(true);
      fetchBalance(userAddr);
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    StellarWalletsKit.disconnect().catch(console.error);
    setAddress(null);
    setIsConnected(false);
    setXlmBalance("0");
  };

  // Helper to wait/poll for transaction status
  const pollTransaction = async (hash: string): Promise<string> => {
    let attempts = 0;
    const maxAttempts = 60; // 120 seconds maximum polling time
    console.log(`Starting to poll for transaction: ${hash}`);
    while (attempts < maxAttempts) {
      try {
        const res = await rpcServer.getTransaction(hash);
        console.log(`Transaction polling attempt ${attempts + 1}: status = ${res.status}`);
        if (res.status === "SUCCESS") {
          return hash;
        } else if (res.status === "FAILED") {
          throw new Error("Transaction execution failed on-chain.");
        }
      } catch (e: any) {
        // Axios/HTTP request errors may contain 'failed' or '404' when transaction is not indexed yet.
        // We log and ignore these to prevent premature aborts.
        console.warn(`Transaction polling attempt ${attempts + 1} failed to query RPC:`, e.message || e);
      }
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
    }
    throw new Error("Transaction polling timed out. Please check your wallet or stellar.expert for final status.");
  };

  // Build an Account from Horizon for the connected user
  const getUserAccount = async (): Promise<Account> => {
    if (!address) throw new Error("Wallet not connected");
    const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
    if (!res.ok) throw new Error("Failed to fetch account. Fund it on friendbot first.");
    const data = await res.json();
    return new Account(address, data.sequence);
  };

  // Deposit XLM into Pool
  const depositXLM = async (amount: string, commitmentHex: string): Promise<string> => {
    if (!address || !POOL_CONTRACT_ID) throw new Error("Wallet not connected or contract not configured");

    const amountStroops = BigInt(Math.floor(parseFloat(amount) * 10000000));
    const commitmentBytes = hexToUint8Array(commitmentHex);

    const poolContract = new Contract(POOL_CONTRACT_ID);
    const op = poolContract.call(
      "deposit",
      xdr.ScVal.scvAddress(Address.fromString(address).toScAddress()),
      xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
      nativeToScVal(amountStroops, { type: "i128" })
    );

    const userAccount = await getUserAccount();
    let tx = new TransactionBuilder(userAccount, {
      fee: "10000000", // 1 XLM fee cap for safety
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(120)
      .build();

    // 1. Simulate
    const simRes = await rpcServer.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      const errMsg = (simRes as any).error || "Unknown simulation error";
      throw new Error(`Simulation failed: ${errMsg}`);
    }

    // 2. Assemble (adds footprint, auth, etc.)
    tx = rpc.assembleTransaction(tx, simRes).build();

    // 3. Sign via Freighter
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(tx.toXDR(), {
      networkPassphrase: Networks.TESTNET,
      address,
    });

    const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);

    // 4. Submit
    const submitRes = await rpcServer.sendTransaction(signedTx);
    if (submitRes.status === "ERROR") {
      throw new Error(`Submission failed: ${JSON.stringify(submitRes.errorResult)}`);
    }

    // 5. Poll for completion
    const txHash = await pollTransaction(submitRes.hash);
    fetchBalance();
    fetchPoolStats();
    return txHash;
  };

  // Withdraw XLM from Pool
  const withdrawXLM = async (
    proof: any,
    nullifierHashHex: string,
    recipient: string,
    amount: string
  ): Promise<string> => {
    if (!address || !POOL_CONTRACT_ID) throw new Error("Wallet not connected or contract not configured");

    const amountStroops = BigInt(Math.floor(parseFloat(amount) * 10000000));
    const nullifierHashBytes = hexToUint8Array(nullifierHashHex);
    const proofScVal = encodeProofToScVal(proof);

    const poolContract = new Contract(POOL_CONTRACT_ID);
    const op = poolContract.call(
      "withdraw",
      proofScVal,
      xdr.ScVal.scvBytes(Buffer.from(nullifierHashBytes)),
      xdr.ScVal.scvAddress(Address.fromString(recipient).toScAddress()),
      nativeToScVal(amountStroops, { type: "i128" })
    );

    const userAccount = await getUserAccount();
    let tx = new TransactionBuilder(userAccount, {
      fee: "10000000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(120)
      .build();

    const simRes = await rpcServer.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      const errMsg = (simRes as any).error || "Unknown simulation error";
      throw new Error(`Simulation failed: ${errMsg}`);
    }

    tx = rpc.assembleTransaction(tx, simRes).build();

    const { signedTxXdr } = await StellarWalletsKit.signTransaction(tx.toXDR(), {
      networkPassphrase: Networks.TESTNET,
      address,
    });

    const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);

    const submitRes = await rpcServer.sendTransaction(signedTx);
    if (submitRes.status === "ERROR") {
      throw new Error(`Submission failed: ${JSON.stringify(submitRes.errorResult)}`);
    }

    const txHash = await pollTransaction(submitRes.hash);
    fetchBalance();
    fetchPoolStats();
    return txHash;
  };

  // Query events from Soroban RPC
  const fetchLiveEvents = async (): Promise<LiveEvent[]> => {
    if (!POOL_CONTRACT_ID) return [];

    try {
      // Get latest ledger for event query range
      const latestLedger = await rpcServer.getLatestLedger();
      // Query events from 10000 ledgers ago (roughly last few hours)
      const startLedger = Math.max(1, latestLedger.sequence - 10000);

      const res = await rpcServer.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [POOL_CONTRACT_ID],
          },
        ],
        limit: 50,
      });

      if (!res.events || res.events.length === 0) return [];

      const events: LiveEvent[] = [];
      for (const evt of res.events) {
        try {
          const topicStr = scValToNative(evt.topic[0]) as string;
          const value = evt.value ? scValToNative(evt.value) : null;

          if (topicStr === "deposit" && value) {
            events.push({
              id: evt.id,
              type: "deposit",
              user: String(value[0] ?? ""),
              commitment: value[1] instanceof Uint8Array
                ? "0x" + Array.from(value[1], (b) => b.toString(16).padStart(2, "0")).join("")
                : String(value[1] ?? ""),
              amount: value[2] ? (Number(value[2]) / 10000000).toFixed(2) : undefined,
              timestamp: Date.now(),
            });
          } else if (topicStr === "withdraw" && value) {
            events.push({
              id: evt.id,
              type: "withdraw",
              nullifierHash: value[0] instanceof Uint8Array
                ? "0x" + Array.from(value[0], (b) => b.toString(16).padStart(2, "0")).join("")
                : String(value[0] ?? ""),
              recipient: String(value[1] ?? ""),
              amount: value[2] ? (Number(value[2]) / 10000000).toFixed(2) : undefined,
              timestamp: Date.now(),
            });
          } else if (topicStr === "new_root" && value) {
            const rootBytes = value instanceof Uint8Array ? value : null;
            events.push({
              id: evt.id,
              type: "new_root",
              root: rootBytes
                ? "0x" + Array.from(rootBytes, (b) => b.toString(16).padStart(2, "0")).join("")
                : String(value),
              timestamp: Date.now(),
            });
          }
        } catch (e) {
          console.warn("Failed to parse event:", e);
        }
      }

      return events.reverse();
    } catch (err) {
      console.error("Failed to fetch live events:", err);
      return [];
    }
  };

  const getMerkleProof = async (commitmentHex: string) => {
    if (!POOL_CONTRACT_ID) throw new Error("Pool contract not configured");

    // 1. Fetch all deposit events from startLedger = 1
    const res = await rpcServer.getEvents({
      startLedger: 1,
      filters: [
        {
          type: "contract",
          contractIds: [POOL_CONTRACT_ID],
        },
      ],
      limit: 1000,
    });

    const leavesMap = new Map<number, bigint>();
    let maxIndex = -1;

    for (const evt of res.events) {
      try {
        const topicStr = scValToNative(evt.topic[0]) as string;
        const value = evt.value ? scValToNative(evt.value) : null;
        if (topicStr === "deposit" && value && Array.isArray(value)) {
          // value = [user, commitment, amount, index]
          const commitmentVal = value[1];
          const index = Number(value[3]);
          if (commitmentVal instanceof Uint8Array) {
            const commitmentBigInt = BigInt(
              "0x" + Array.from(commitmentVal, (b) => b.toString(16).padStart(2, "0")).join("")
            );
            leavesMap.set(index, commitmentBigInt);
            if (index > maxIndex) {
              maxIndex = index;
            }
          }
        }
      } catch (e) {
        console.warn("Failed to parse event in getMerkleProof:", e);
      }
    }

    // 2. Build the leaves list
    const leaves: bigint[] = [];
    const totalLeaves = maxIndex + 1;
    for (let i = 0; i < totalLeaves; i++) {
      leaves.push(leavesMap.get(i) || BigInt(0));
    }

    // 3. Find the leaf index of the target commitment
    const targetHexClean = commitmentHex.replace(/^0x/, "").toLowerCase();
    const targetBigInt = BigInt("0x" + targetHexClean);
    const leafIndex = leaves.findIndex((l) => l === targetBigInt);

    if (leafIndex === -1) {
      throw new Error("Commitment not found in pool. Make sure it has been deposited and the transaction has succeeded.");
    }

    // 4. Compute Merkle path
    const { getMerklePath: calculatePath } = await import("@/lib/zk");
    // Merkle tree depth in our circuit is 4
    return await calculatePath(leaves, leafIndex, 4);
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected,
        isConnecting,
        xlmBalance,
        tvl,
        totalCommitments,
        merkleRoot,
        recentEvents,
        connect,
        disconnect,
        fetchBalance,
        fetchPoolStats,
        depositXLM,
        withdrawXLM,
        fetchLiveEvents,
        getMerkleProof,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};

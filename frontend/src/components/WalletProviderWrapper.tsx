"use client";

import { WalletProvider } from "@/context/WalletContext";
import { ReactNode } from "react";

export function WalletProviderWrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

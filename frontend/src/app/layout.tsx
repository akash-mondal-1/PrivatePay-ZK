import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { WalletProviderWrapper } from "@/components/WalletProviderWrapper";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PrivatePay ZK | Stellar Hacks",
  description: "Private payroll and business payments on Stellar with selective disclosure and compliance-ready zero-knowledge proofs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <WalletProviderWrapper>
          <div className="relative flex min-h-screen flex-col">
            <Navbar />
            <main className="flex-1 flex flex-col">{children}</main>
          </div>
        </WalletProviderWrapper>
      </body>
    </html>
  );
}

"use client";

import dynamic from "next/dynamic";

const WalletProviders = dynamic(
  () => import("./walletProviders").then((mod) => mod.WalletProviders),
  { ssr: false },
);

export function Providers({ children }: { children: React.ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}

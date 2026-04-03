import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "OhMySwarm — DeFi Agent Swarm",
  description: "AI agent swarm for DeFi portfolio optimization",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden bg-bg font-mono">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getWallet, fundWallet } from "../../lib/api";
import { getTxExplorerUrl } from "../../lib/explorer";

interface TreasuryInfo {
  name: string;
  address: string;
  balance: number;
  network: string;
  token: string;
  billingMode: "paid" | "free";
}

const QUICK_AMOUNTS = [5, 10, 20, 50];

export default function FundPage() {
  const router = useRouter();
  const [treasury, setTreasury] = useState<TreasuryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastConfirmedTxHash, setLastConfirmedTxHash] = useState("");
  const [copied, setCopied] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [txHash, setTxHash] = useState("");

  const loadTreasury = useCallback(async () => {
    try {
      const data = await getWallet();
      setTreasury(data as TreasuryInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTreasury();
  }, [loadTreasury]);

  async function handleFund(amount: number) {
    if (!amount || amount <= 0) return;
    setFunding(true);
    setError("");
    setSuccess("");
    try {
      const result = await fundWallet(amount, undefined, txHash || undefined);
      setSuccess(
        `Funded $${result.amountUsdc} USDC — new balance: $${result.newBalance.toFixed(2)} USDC`,
      );
      setLastConfirmedTxHash(result.txHash);
      setTxHash("");
      setCustomAmount("");
      // Refresh balance
      const updated = await getWallet();
      setTreasury(updated as TreasuryInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding failed");
    } finally {
      setFunding(false);
    }
  }

  async function copyAddress() {
    if (!treasury?.address) return;
    await navigator.clipboard.writeText(treasury.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const customAmountNum = parseFloat(customAmount);

  if (loading) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-cyan text-sm animate-pulse">Loading wallet...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <button
            onClick={() => router.push("/")}
            className="text-xs text-muted hover:text-cyan transition-colors mb-6 block mx-auto"
          >
            ← Back
          </button>
          <div className="text-xs text-muted tracking-[0.4em] uppercase mb-2">
            Master Wallet
          </div>
          <h1 className="text-3xl font-bold text-cyan glow-text-cyan">
            Fund Treasury
          </h1>
          <p className="text-muted text-xs mt-2">
            The master wallet funds all agent sessions. Keep it topped up.
          </p>
        </div>

        {/* Wallet card */}
        {treasury && (
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            {/* Balance row */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted text-[10px] uppercase tracking-widest mb-1">
                  Current Balance
                </p>
                <p className="text-3xl font-bold text-primary">
                  ${treasury.balance.toFixed(2)}
                  <span className="text-muted text-sm font-normal ml-2">
                    USDC
                  </span>
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded border ${
                    treasury.billingMode === "paid"
                      ? "border-yellow/40 text-yellow bg-yellow/10"
                      : "border-cyan/40 text-cyan bg-cyan/10"
                  }`}
                >
                  {treasury.billingMode === "paid" ? "Paid Mode" : "Free Mode"}
                </span>
                <p className="text-muted text-[10px] mt-1">
                  {treasury.network}
                </p>
              </div>
            </div>

            {/* Balance bar */}
            <div className="h-1.5 rounded-full bg-surface2 overflow-hidden">
              <div
                className="h-full bg-cyan rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, (treasury.balance / 50) * 100)}%`,
                  boxShadow: "0 0 8px rgba(0,255,255,0.5)",
                }}
              />
            </div>

            {/* Address */}
            <div className="bg-surface2 rounded-lg p-3">
              <p className="text-muted text-[10px] uppercase tracking-widest mb-1">
                Wallet Address
              </p>
              <div className="flex items-center gap-2">
                <code className="text-primary text-xs font-mono flex-1 break-all leading-relaxed">
                  {treasury.address}
                </code>
                <button
                  onClick={copyAddress}
                  className="shrink-0 text-[10px] border border-border rounded px-2 py-1 text-muted hover:text-cyan hover:border-cyan transition-all"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Funding panel */}
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          {treasury?.billingMode === "free" ? (
            <>
              <p className="text-muted text-xs">
                Running in <span className="text-cyan">free / demo mode</span> —
                funds are virtual and don&apos;t require real USDC.
              </p>

              {/* Quick amounts */}
              <div>
                <p className="text-muted text-[10px] uppercase tracking-widest mb-2">
                  Quick Add
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => handleFund(amt)}
                      disabled={funding}
                      className="py-2 text-xs rounded border border-border text-muted
                                 hover:border-cyan hover:text-cyan hover:bg-cyan/5
                                 disabled:opacity-40 transition-all"
                    >
                      +${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom amount */}
              <div>
                <p className="text-muted text-[10px] uppercase tracking-widest mb-2">
                  Custom Amount
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-surface2 border border-border rounded-lg pl-7 pr-3 py-2
                                 text-primary text-xs font-mono focus:outline-none focus:border-cyan transition-all"
                    />
                  </div>
                  <button
                    onClick={() => handleFund(customAmountNum)}
                    disabled={
                      funding || !customAmountNum || customAmountNum <= 0
                    }
                    className="px-4 py-2 text-xs rounded border border-cyan text-cyan
                               hover:bg-cyan/10 disabled:opacity-40 transition-all"
                  >
                    {funding ? "Adding..." : "Add"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Paid mode — real USDC instructions */}
              <p className="text-muted text-xs">
                Send <span className="text-primary font-semibold">USDC</span> to
                the treasury address on{" "}
                <span className="text-cyan">{treasury?.network}</span>, then
                enter the transaction hash below to confirm.
              </p>

              <div>
                <p className="text-muted text-[10px] uppercase tracking-widest mb-2">
                  Amount (USDC)
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder="10.00"
                      className="w-full bg-surface2 border border-border rounded-lg pl-7 pr-3 py-2
                                 text-primary text-xs font-mono focus:outline-none focus:border-cyan transition-all"
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-muted text-[10px] uppercase tracking-widest mb-2">
                  Transaction Hash
                </p>
                <input
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value.trim())}
                  placeholder="0x..."
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2
                             text-primary text-xs font-mono focus:outline-none focus:border-cyan transition-all"
                />
              </div>

              <button
                onClick={() => handleFund(customAmountNum)}
                disabled={
                  funding || !customAmountNum || customAmountNum <= 0 || !txHash
                }
                className="w-full py-2.5 text-xs rounded border border-cyan text-cyan
                           hover:bg-cyan/10 disabled:opacity-40 transition-all font-semibold"
              >
                {funding ? "Verifying..." : "Confirm Funding"}
              </button>

              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-muted text-[10px] uppercase tracking-widest">
                  Quick Fund
                </p>
                <a
                  href={`https://global.transak.com/?network=ethereum&cryptoCurrencyCode=USDC&walletAddress=${treasury?.address}&environment=STAGING`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 text-xs rounded border border-cyan/50 text-cyan hover:bg-cyan/10 transition-all"
                >
                  Buy USDC via Transak →
                </a>

                {treasury?.network === "sepolia" && (
                  <div className="flex gap-2 text-[10px]">
                    <a
                      href="https://faucet.circle.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center py-2 rounded border border-border text-muted hover:text-cyan hover:border-cyan transition-all"
                    >
                      USDC Faucet
                    </a>
                    <a
                      href="https://sepoliafaucet.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center py-2 rounded border border-border text-muted hover:text-cyan hover:border-cyan transition-all"
                    >
                      ETH Faucet (Gas)
                    </a>
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="text-red text-xs bg-red/10 border border-red/30 rounded px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <div className="text-green text-xs bg-green/10 border border-green/30 rounded px-3 py-2 space-y-1">
              <p>{success}</p>
              {lastConfirmedTxHash && (
                <a
                  href={getTxExplorerUrl(lastConfirmedTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan hover:text-primary font-mono underline-offset-2 hover:underline inline-block"
                >
                  View tx: {lastConfirmedTxHash.slice(0, 18)}...
                </a>
              )}
            </div>
          )}
        </div>

        {/* Back to launch */}
        <div className="text-center">
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2.5 text-xs rounded border border-cyan text-cyan
                       hover:bg-cyan/10 transition-all font-semibold"
          >
            Launch a Session →
          </button>
        </div>
      </div>
    </main>
  );
}

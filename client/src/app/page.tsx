"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import {
  createSession,
  fundWallet,
  startPendingSession,
  type CreateSessionResponse,
} from "../lib/api";

export default function HomePage() {
  const router = useRouter();
  const { address: walletAddress } = useAccount();

  const [task, setTask] = useState("");
  const [budget, setBudget] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fundingStatus, setFundingStatus] =
    useState<CreateSessionResponse | null>(null);
  const [fundingTxHash, setFundingTxHash] = useState("");
  const [hoverActive, setHoverActive] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);
  const pendingCursorRef = useRef({ x: 0, y: 0 });

  const EXAMPLE_TASKS = [
    "I have $5k USDC idle on Base. Medium risk. Find the best yield right now.",
    "Optimize my ETH allocation for max yield. Conservative risk only.",
    "Move 50% of my portfolio to stablecoin yield strategies. Low risk.",
  ];

  const BG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>[]{}/*+=-_";
  const staticGlyphs = useMemo(
    () =>
      Array.from({ length: 860 }, (_, i) => {
        const x = Math.random() * 100;
        const y = Math.random() * 100;

        return {
          id: i,
          char: BG_CHARS[Math.floor(Math.random() * BG_CHARS.length)],
          x,
          y,
          opacity: 0.22 + Math.random() * 0.72,
          size: 8 + Math.random() * 6,
          duration: 0.35 + Math.random() * 1.25,
          delay: Math.random() * 2.4,
        };
      }),
    [],
  );

  const hoverRevealMask = hoverActive
    ? `radial-gradient(circle 250px at ${cursor.x}px ${cursor.y}px, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 30%, rgba(0,0,0,0.56) 58%, rgba(0,0,0,0.24) 78%, rgba(0,0,0,0.08) 92%, rgba(0,0,0,0.05) 100%)`
    : "radial-gradient(circle 250px at -999px -999px, rgba(0,0,0,1) 0%, rgba(0,0,0,0.05) 100%)";

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  function handleMouseMove(e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    pendingCursorRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    if (!hoverActive) setHoverActive(true);

    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        setCursor(pendingCursorRef.current);
        frameRef.current = null;
      });
    }
  }

  function handleMouseLeave() {
    setHoverActive(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    setLoading(true);
    setError("");
    setFundingStatus(null);
    setFundingTxHash("");
    try {
      const result = await createSession(task, budget, {
        userWalletAddress: walletAddress ?? undefined,
        fundingMode: "pay_per_session",
      });

      if (result.fundingRequired) {
        setFundingStatus(result);
        setError(
          result.message ??
            "Master wallet needs more USDC before session can start.",
        );
        setLoading(false);
        return;
      }

      // Redirect to launch page to show initialization logs
      router.push(`/launch?sessionId=${result.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
      setLoading(false);
    }
  }

  async function fundAndRetryStart() {
    if (!fundingStatus) return;
    const shortfall = Number(fundingStatus.shortfallUsdc ?? 0);
    if (shortfall <= 0) {
      await retryStartPendingSession();
      return;
    }
    setLoading(true);
    setError("");
    try {
      await fundWallet(
        shortfall,
        walletAddress ?? undefined,
        fundingTxHash || undefined,
      );
      await retryStartPendingSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding failed");
      setLoading(false);
    }
  }

  async function retryStartPendingSession() {
    if (!fundingStatus) return;
    setLoading(true);
    setError("");
    try {
      const result = await startPendingSession(fundingStatus.sessionId);
      if (result.fundingRequired) {
        setFundingStatus(result);
        setError(
          result.message ??
            "Still underfunded. Please fund master wallet and retry.",
        );
        setLoading(false);
        return;
      }
      router.push(`/launch?sessionId=${result.sessionId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start pending session",
      );
      setLoading(false);
    }
  }

  return (
    <main
      className="relative min-h-screen bg-bg overflow-hidden px-4 py-8 flex items-center justify-center"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="landing-atmos absolute inset-0 pointer-events-none" />

      <div
        className={`landing-glyph-layer ${hoverActive ? "is-active" : ""}`}
        style={{
          WebkitMaskImage: hoverRevealMask,
          maskImage: hoverRevealMask,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }}
        aria-hidden
      >
        {staticGlyphs.map((glyph) => (
          <span
            key={glyph.id}
            className="landing-glyph"
            style={{
              left: `${glyph.x}%`,
              top: `${glyph.y}%`,
              opacity: glyph.opacity,
              fontSize: `${glyph.size}px`,
              animationDuration: `${glyph.duration}s`,
              animationDelay: `${glyph.delay}s`,
            }}
          >
            {glyph.char}
          </span>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-6xl">
        <header className="text-center mb-8 md:mb-10">
          <p className="text-[10px] text-muted tracking-[0.45em] uppercase mb-4 landing-fade-in">
            OWS · x402 · LangGraph · DeFi
          </p>
          <h1 className="landing-title text-5xl md:text-6xl font-bold mb-3 tracking-tight">
            OhMySwarm
          </h1>
          <p className="text-muted text-sm max-w-2xl mx-auto leading-relaxed landing-fade-in-delay">
            Deploy a coordinated autonomous DeFi swarm. Specialists research,
            evaluate risk, and execute strategy with wallet-native x402
            micropayment flows.
          </p>
        </header>

        <section className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.8fr] gap-5">
          <form
            onSubmit={handleSubmit}
            className="landing-panel p-5 md:p-6 space-y-4"
          >
            <div className="flex items-center justify-between rounded-xl border border-border/80 bg-surface/75 px-4 py-2.5 landing-interactive">
              <p className="text-muted text-[10px] uppercase tracking-widest">
                Wallet Link
              </p>
              <ConnectButton
                showBalance={false}
                chainStatus="none"
                accountStatus="address"
              />
            </div>

            <div className="relative landing-interactive">
              <div className="absolute left-4 top-4 text-cyan/60 text-xs select-none">
                &gt;_
              </div>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe your DeFi objective, constraints, and risk profile..."
                rows={4}
                className="w-full bg-surface/80 border border-border rounded-xl pl-10 pr-4 py-4 text-primary text-sm
                           placeholder-muted focus:outline-none focus:border-cyan focus:shadow-[0_0_24px_rgba(0,245,255,0.18)]
                           resize-none transition-all duration-300"
                disabled={loading}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-muted text-xs whitespace-nowrap">
                Session Budget
              </label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 5, 10].map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBudget(b)}
                    className={`px-3 py-1.5 text-xs rounded-full border transition-all duration-200 hover:-translate-y-0.5 ${
                      budget === b
                        ? "border-cyan text-cyan bg-surface2 shadow-[0_0_14px_rgba(0,245,255,0.2)]"
                        : "border-border text-muted hover:border-cyan/60 hover:text-cyan"
                    }`}
                  >
                    ${b}
                  </button>
                ))}
              </div>
              <span className="text-muted/85 text-xs">USDC swarm budget</span>
            </div>

            {error && (
              <p className="text-red text-xs rounded-lg border border-red/40 bg-red/10 px-3 py-2 animate-pulse">
                {error}
              </p>
            )}

            {fundingStatus?.fundingRequired && (
              <div className="w-full rounded-xl border border-yellow/40 bg-yellow/10 p-4 space-y-2 landing-interactive">
                <p className="text-yellow text-xs uppercase tracking-widest">
                  Funding Required Before Session Start
                </p>
                <p className="text-primary text-xs">
                  Master wallet balance is below safety threshold (
                  {fundingStatus.multiplier}x budget).
                </p>
                <p className="text-muted text-xs font-mono break-all">
                  Treasury: {fundingStatus.treasuryAddress}
                </p>
                <p className="text-muted text-xs">
                  Current: $
                  {Number(fundingStatus.treasuryBalanceUsdc ?? 0).toFixed(4)}{" "}
                  USDC · Required: $
                  {Number(fundingStatus.requiredMasterBalanceUsdc ?? 0).toFixed(
                    4,
                  )}{" "}
                  USDC · Shortfall: $
                  {Number(fundingStatus.shortfallUsdc ?? 0).toFixed(4)} USDC
                </p>
                <input
                  value={fundingTxHash}
                  onChange={(e) => setFundingTxHash(e.target.value.trim())}
                  placeholder="Optional tx hash (required in paid mode)"
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-primary text-xs font-mono
                             placeholder-muted focus:outline-none focus:border-cyan transition-all"
                />
                <button
                  type="button"
                  onClick={fundAndRetryStart}
                  disabled={loading}
                  className="px-3 py-2 text-xs rounded-full border border-cyan text-cyan hover:bg-cyan/10 disabled:opacity-40 transition-all"
                >
                  Fund Treasury + Retry Start
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !task.trim()}
              className="landing-cta w-full py-3.5 rounded-xl text-bg font-bold text-sm
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? "LAUNCHING SWARM..." : "LAUNCH SWARM →"}
            </button>
          </form>

          <aside className="space-y-4">
            <div className="landing-panel p-4 md:p-5 landing-interactive">
              <p className="text-[10px] text-muted uppercase tracking-[0.28em] mb-3">
                Mission Presets
              </p>
              <div className="space-y-2.5">
                {EXAMPLE_TASKS.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setTask(t)}
                    className="w-full text-left text-xs text-muted px-3 py-2.5 rounded-lg border border-border/80
                               hover:border-cyan/60 hover:text-primary hover:bg-surface2/70 transition-all duration-200"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="landing-panel p-4 md:p-5 landing-interactive">
              <p className="text-[10px] text-muted uppercase tracking-[0.28em] mb-3">
                Quick Access
              </p>
              <div className="grid grid-cols-1 gap-2.5">
                <button
                  onClick={() => router.push("/fund")}
                  className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted hover:text-cyan hover:border-cyan/60 transition-all duration-200"
                >
                  Fund Master Wallet
                </button>
              </div>
            </div>

            <div className="landing-panel p-4 md:p-5 landing-interactive">
              <p className="text-[10px] text-muted uppercase tracking-[0.28em] mb-3">
                Telemetry
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-border/70 bg-surface/60 py-2">
                  <p className="text-cyan text-sm font-bold">5</p>
                  <p className="text-[9px] text-muted uppercase">Agents</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-surface/60 py-2">
                  <p className="text-green text-sm font-bold">x402</p>
                  <p className="text-[9px] text-muted uppercase">Payments</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-surface/60 py-2">
                  <p className="text-yellow text-sm font-bold">Live</p>
                  <p className="text-[9px] text-muted uppercase">Graph</p>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

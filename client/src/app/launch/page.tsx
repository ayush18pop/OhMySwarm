"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { getSocketServerUrl } from "../../lib/socket";

interface LogEntry {
  id: string;
  timestamp: number;
  type:
    | "info"
    | "success"
    | "warning"
    | "payment"
    | "agent"
    | "humor"
    | "error";
  message: string;
  details?: string;
  emoji?: string;
}

const HUMOR = [
  "Waking up the swarm from its espresso break... ☕",
  "Charging the bees with optimism... 🐝",
  "Convincing market gods this is a good idea... 🙏",
  "Calibrating agent enthusiasm levels... 🎯",
  "Reminding agents that money = data = power... 💰",
  "Sprinkling pixie dust on gas prices... ✨",
  "Teaching swarm members to count to 2.0... 🧮",
  "Lubricating blockchain gears... 🔧",
  "Inflating agent confidence balloons... 🎈",
  "Whispering sweet APY numbers... 📈",
  "Preparing agents for harsh market realities... 📺",
  "Staging final pep talk before execution... 🎬",
];

const WS_URL = getSocketServerUrl();

export default function LaunchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "running" | "complete" | "error"
  >("connecting");
  const [agentCount, setAgentCount] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRedirectScheduledRef = useRef(false);

  function scheduleRedirect(delayMs = 1200) {
    if (!sessionId || hasRedirectScheduledRef.current) return;
    hasRedirectScheduledRef.current = true;
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    redirectTimeoutRef.current = setTimeout(() => {
      router.push(`/session/${sessionId}`);
    }, delayMs);
  }

  // Auto-scroll to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      addLog({
        type: "error",
        message: "❌ No session ID provided",
      });
      return;
    }

    // Connect to Socket.io
    const socket = io(WS_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ["websocket"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      addLog({
        type: "success",
        message: "✓ Connected to swarm network",
        emoji: "🌐",
      });
      socket.emit("join_session", sessionId);

      // Launch screen is only a brief handoff: never keep users here too long.
      fallbackTimeoutRef.current = setTimeout(() => {
        scheduleRedirect(0);
      }, 6000);
    });

    socket.on("disconnect", () => {
      addLog({
        type: "warning",
        message: "⚠ Disconnected from network",
      });
    });

    // Session events
    socket.on("SESSION_FUNDED", (payload: unknown) => {
      setStatus("running");
      addLog({
        type: "success",
        message: "Session wallet funded and ready",
        emoji: "💵",
      });
      addHumorLog("Agents are now fully caffeinated.");
    });

    socket.on("SESSION_FUNDING_REQUIRED", () => {
      addLog({
        type: "warning",
        message: "Awaiting treasury funding...",
        emoji: "⏳",
      });
    });

    socket.on(
      "AGENT_SPAWNED",
      (payload: { agentId: string; role: string; budgetUsdc: number }) => {
        setStatus("running");
        setAgentCount((c) => c + 1);
        const roleEmoji: Record<string, string> = {
          "portfolio-scout": "🔍",
          "yield-scanner": "📊",
          "risk-analyst": "⚠️",
          "route-planner": "🗺️",
          executor: "⚡",
          "chain-analyst": "⛓️",
          "token-analyst": "💎",
          "protocol-researcher": "🔬",
          "liquidity-scout": "💧",
        };
        addLog({
          type: "agent",
          message: `Spawning ${payload.role}`,
          details: `Budget: $${payload.budgetUsdc.toFixed(2)} USDC`,
          emoji: roleEmoji[payload.role] || "🤖",
        });
        scheduleRedirect();
      },
    );

    socket.on(
      "PAYMENT_CONFIRMED",
      (payload: { amountUsdc: number; description: string }) => {
        setTotalSpent((s) => s + payload.amountUsdc);
        addLog({
          type: "payment",
          message: `Payment confirmed: $${payload.amountUsdc.toFixed(2)} USDC`,
          details: payload.description,
          emoji: "💸",
        });
      },
    );

    socket.on("TOOL_CALLED", (payload: { toolName: string }) => {
      setStatus("running");
      addLog({
        type: "info",
        message: `Tool invoked: ${payload.toolName}`,
        emoji: "🔧",
      });
      scheduleRedirect();
    });

    socket.on(
      "AGENT_COMPLETE",
      (payload: { spentUsdc: number; durationMs: number; output?: string }) => {
        const duration = (payload.durationMs / 1000).toFixed(1);
        addLog({
          type: "success",
          message: `Agent completed in ${duration}s`,
          details: `Spent: $${payload.spentUsdc.toFixed(2)} USDC`,
          emoji: "✓",
        });
        addHumorLog(HUMOR[Math.floor(Math.random() * HUMOR.length)]);
      },
    );

    socket.on("SESSION_COMPLETE", () => {
      setStatus("complete");
      addLog({
        type: "success",
        message: "🎉 Swarm execution complete!",
      });
      addHumorLog("Swarm is now taking a victory lap.");
      scheduleRedirect(300);
    });

    socket.on("SESSION_FAILED", (payload: { error: string }) => {
      setStatus("error");
      addLog({
        type: "error",
        message: `Session failed: ${payload.error}`,
      });
    });

    socket.on("AGENT_FAILED", (payload: { error: string }) => {
      addLog({
        type: "error",
        message: `Agent error: ${payload.error}`,
        emoji: "❌",
      });
    });

    socket.on(
      "AWAITING_APPROVAL",
      (payload: { phase: string; summary: string }) => {
        addLog({
          type: "warning",
          message: `Awaiting user approval for ${payload.phase} phase`,
          details: payload.summary?.slice(0, 100),
          emoji: "⏸️",
        });
      },
    );

    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
      }
      socket.disconnect();
    };
  }, [sessionId, router]);

  function addLog(entry: Omit<LogEntry, "id" | "timestamp">) {
    const id = `${Date.now()}-${Math.random()}`;
    setLogs((prev) => [
      ...prev,
      {
        id,
        timestamp: Date.now(),
        ...entry,
      },
    ]);
  }

  function addHumorLog(message: string) {
    addLog({
      type: "humor",
      message,
      emoji: "😄",
    });
  }

  const logColors: Record<LogEntry["type"], string> = {
    info: "text-cyan",
    success: "text-green",
    warning: "text-yellow",
    payment: "text-yellow",
    agent: "text-cyan",
    humor: "text-pink",
    error: "text-red",
  };

  const logBorders: Record<LogEntry["type"], string> = {
    info: "border-l-cyan/40",
    success: "border-l-green/40",
    warning: "border-l-yellow/40",
    payment: "border-l-yellow/40",
    agent: "border-l-cyan/40",
    humor: "border-l-pink/40",
    error: "border-l-red/40",
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-surface/80 backdrop-blur-sm px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
              <span className="text-xs text-muted uppercase tracking-widest">
                SWARM LAUNCHING
              </span>
            </div>
            <span className="text-xs text-muted">{agentCount} agents</span>
            <span className="text-xs text-muted">
              ${totalSpent.toFixed(4)} spent
            </span>
          </div>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-primary">
              🐝 OhMySwarm Initialization
            </h1>
            <div className="text-xs font-mono text-muted break-all max-w-sm text-right">
              {sessionId}
            </div>
          </div>
        </div>
      </header>

      {/* Logs container */}
      <div className="flex-1 overflow-auto bg-bg px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-2">
          {logs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-muted text-xs">
              <div className="w-8 h-8 rounded-full border-2 border-cyan border-t-transparent animate-spin mb-3" />
              Initializing swarm...
            </div>
          )}

          {logs.map((log) => (
            <div
              key={log.id}
              className={`border-l-2 pl-3 py-2 text-xs font-mono ${logBorders[log.type]} transition-all`}
            >
              <div className={`flex items-start gap-2 ${logColors[log.type]}`}>
                <span className="shrink-0 text-sm">{log.emoji || "→"}</span>
                <div className="min-w-0">
                  <div className="break-words">{log.message}</div>
                  {log.details && (
                    <div className="text-muted text-[10px] mt-0.5 break-words opacity-75">
                      {log.details}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {status === "complete" && (
            <div className="mt-6 p-4 rounded-lg border border-green/30 bg-green/5">
              <div className="flex items-center gap-2 text-green text-xs mb-2">
                <span className="text-lg">✓</span>
                <span className="font-bold">READY FOR REVIEW</span>
              </div>
              <p className="text-muted text-xs">
                Redirecting to session in 2 seconds...
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="mt-6 p-4 rounded-lg border border-red/30 bg-red/5">
              <div className="flex items-center gap-2 text-red text-xs mb-2">
                <span className="text-lg">✕</span>
                <span className="font-bold">ERROR</span>
              </div>
              <p className="text-muted text-xs">
                Check the logs above for details.
              </p>
            </div>
          )}

          <div ref={logsEndRef} className="h-px" />
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-border bg-surface/50 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-[10px] text-muted">
          <div className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full ${
                status === "connecting"
                  ? "animate-pulse bg-yellow"
                  : status === "running"
                    ? "animate-pulse bg-cyan"
                    : status === "complete"
                      ? "bg-green"
                      : "bg-red"
              }`}
            />
            <span>
              {status === "connecting"
                ? "Connecting..."
                : status === "running"
                  ? "Running..."
                  : status === "complete"
                    ? "Complete"
                    : "Error"}
            </span>
          </div>
          {logs.length > 0 && (
            <span className="text-muted">
              {logs.length} event{logs.length !== 1 ? "s" : ""} logged
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { Agent, Payment } from "../../types";
import { getTxExplorerUrl } from "../../lib/explorer";

interface ActivityEvent {
  id: string;
  ts: number;
  type:
    | "spawn"
    | "complete"
    | "failed"
    | "payment"
    | "tool"
    | "approval"
    | "session";
  agentId?: string;
  label: string;
  detail?: string;
  amount?: number;
  txHash?: string;
}

interface ActivityFeedProps {
  agents: Record<string, Agent>;
  payments: Payment[];
  status: string;
}

const ROLE_COLORS: Record<string, string> = {
  master: "#00f5ff",
  "portfolio-scout": "#00ff88",
  "yield-scanner": "#ffe600",
  "risk-analyst": "#ff6b6b",
  "route-planner": "#c084fc",
  executor: "#fb923c",
};

const TYPE_STYLE: Record<
  ActivityEvent["type"],
  { color: string; icon: string }
> = {
  spawn: { color: "#00f5ff", icon: "⊕" },
  complete: { color: "#00ff88", icon: "✓" },
  failed: { color: "#ff2d55", icon: "✗" },
  payment: { color: "#ffe600", icon: "⬡" },
  tool: { color: "#4a8fa8", icon: "◎" },
  approval: { color: "#ffe600", icon: "⚑" },
  session: { color: "#00f5ff", icon: "◈" },
};

export function ActivityFeed({ agents, payments, status }: ActivityFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build event list from current state
  const events: ActivityEvent[] = [];

  Object.values(agents).forEach((a) => {
    events.push({
      id: `spawn-${a.id}`,
      ts: new Date(a.createdAt).getTime(),
      type: "spawn",
      agentId: a.id,
      label: `${a.role.toUpperCase()} spawned`,
      detail: a.task.slice(0, 48) + (a.task.length > 48 ? "…" : ""),
    });
    if (a.status === "complete" && a.completedAt) {
      const dur = a.completedAt
        ? Math.round(
            (new Date(a.completedAt).getTime() -
              new Date(a.createdAt).getTime()) /
              1000,
          )
        : null;
      events.push({
        id: `done-${a.id}`,
        ts: new Date(a.completedAt).getTime(),
        type: "complete",
        agentId: a.id,
        label: `${a.role.toUpperCase()} complete`,
        detail: dur ? `${dur}s · ${a.toolCallCount} tool calls` : undefined,
      });
    }
    if (a.status === "failed") {
      events.push({
        id: `fail-${a.id}`,
        ts: new Date(a.createdAt).getTime() + 100,
        type: "failed",
        agentId: a.id,
        label: `${a.role.toUpperCase()} failed`,
      });
    }
  });

  payments.forEach((p) => {
    events.push({
      id: `pay-${p.id}`,
      ts: new Date(p.createdAt).getTime(),
      type: "payment",
      agentId: p.agentId,
      label: "x402 payment",
      detail: p.description ?? undefined,
      amount: p.amountUsdc,
      txHash: p.txHash,
    });
  });

  events.sort((a, b) => a.ts - b.ts);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <div className="w-1 h-1 rounded-full bg-muted animate-pulse" />
        <p className="text-muted text-[10px] uppercase tracking-widest">
          No events yet
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-3 py-2">
      <div className="space-y-1">
        {events.map((ev) => {
          const style = TYPE_STYLE[ev.type];
          const agent = ev.agentId ? agents[ev.agentId] : null;
          const roleColor = agent
            ? (ROLE_COLORS[agent.role] ?? style.color)
            : style.color;
          const ts = new Date(ev.ts);
          const timeStr = isNaN(ts.getTime())
            ? ""
            : ts.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });

          return (
            <div
              key={ev.id}
              className="flex items-start gap-2 py-1.5 border-b group"
              style={{ borderColor: "#0e3d5230" }}
            >
              {/* Icon */}
              <span
                className="text-[11px] shrink-0 mt-0.5"
                style={{
                  color: ev.type === "payment" ? "#ffe600" : roleColor,
                  filter:
                    ev.type === "spawn"
                      ? `drop-shadow(0 0 3px ${roleColor})`
                      : "none",
                }}
              >
                {style.icon}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[9px] font-bold tracking-widest"
                    style={{
                      color: ev.type === "payment" ? "#ffe600" : roleColor,
                    }}
                  >
                    {ev.label}
                  </span>
                  {ev.amount != null && (
                    <span className="text-[9px] text-green font-mono">
                      +${ev.amount.toFixed(3)}
                    </span>
                  )}
                  <span className="text-[8px] text-border ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {timeStr}
                  </span>
                </div>
                {ev.detail && (
                  <p className="text-[9px] text-muted leading-tight truncate mt-0.5">
                    {ev.detail}
                  </p>
                )}
                {ev.txHash && (
                  <a
                    href={getTxExplorerUrl(ev.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-cyan hover:text-primary font-mono mt-0.5 inline-block underline-offset-2 hover:underline"
                  >
                    {ev.txHash.slice(0, 18)}...
                  </a>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

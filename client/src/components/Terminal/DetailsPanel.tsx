"use client";

import type { Agent, Payment } from "../../types";
import { MarkdownBlock } from "./MarkdownBlock";
import { getTxExplorerUrl } from "../../lib/explorer";

interface DetailsPanelProps {
  agent?: Agent | null;
  payments: Payment[];
  totalSpent: number;
  budgetUsdc: number;
}

const ROLE_COLORS: Record<string, string> = {
  master: "#00f5ff",
  "portfolio-scout": "#00ff88",
  "yield-scanner": "#ffe600",
  "risk-analyst": "#ff6b6b",
  "route-planner": "#c084fc",
  executor: "#fb923c",
};

export function DetailsPanel({
  agent,
  payments,
  totalSpent,
  budgetUsdc,
}: DetailsPanelProps) {
  if (!agent) {
    return (
      <div className="p-4 space-y-4">
        {/* Payment feed */}
        <div>
          <h3 className="text-muted text-[10px] uppercase tracking-widest mb-3">
            x402 Payment Ledger
          </h3>
          {payments.length === 0 ? (
            <p className="text-muted text-xs">No payments yet</p>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 border-b border-border"
                >
                  <div>
                    <p className="text-primary text-xs">{p.description}</p>
                    {p.txHash ? (
                      <a
                        href={getTxExplorerUrl(p.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan hover:text-primary text-[10px] font-mono underline-offset-2 hover:underline"
                      >
                        {p.txHash.slice(0, 18)}...
                      </a>
                    ) : (
                      <p className="text-muted text-[10px] font-mono">
                        No tx hash
                      </p>
                    )}
                  </div>
                  <span className="text-green text-xs font-bold">
                    ${p.amountUsdc.toFixed(3)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between pt-2">
                <span className="text-muted text-xs">Total spent</span>
                <span className="text-cyan text-xs font-bold">
                  ${totalSpent.toFixed(4)} / ${budgetUsdc.toFixed(2)} USDC
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const color = ROLE_COLORS[agent.role] ?? "#4a8fa8";
  const duration = agent.completedAt
    ? Math.round(
        (new Date(agent.completedAt).getTime() -
          new Date(agent.createdAt).getTime()) /
          1000,
      )
    : null;

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Agent header */}
      <div
        className="border border-b-0 rounded-t-lg p-3"
        style={{ borderColor: color }}
      >
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span
            className="font-bold text-xs tracking-widest uppercase"
            style={{ color }}
          >
            {agent.role}
          </span>
          <span
            className={`text-[10px] ml-auto px-2 py-0.5 rounded ${
              agent.status === "complete"
                ? "bg-green/10 text-green"
                : agent.status === "failed"
                  ? "bg-red/10 text-red"
                  : "bg-cyan/10 text-cyan animate-pulse"
            }`}
          >
            {agent.status.toUpperCase()}
          </span>
        </div>
        <p className="text-muted text-xs">{agent.task}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Tool Calls", value: agent.toolCallCount },
          { label: "Spent", value: `$${agent.spentUsdc.toFixed(3)}` },
          { label: "Duration", value: duration ? `${duration}s` : "…" },
        ].map((s) => (
          <div key={s.label} className="bg-surface2 rounded p-2 text-center">
            <div className="text-primary text-sm font-bold">{s.value}</div>
            <div className="text-muted text-[9px] uppercase tracking-wider">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Wallet */}
      <div>
        <h3 className="text-muted text-[10px] uppercase tracking-widest mb-2">
          Virtual Wallet
        </h3>
        <div className="bg-surface2 rounded p-3">
          <p className="text-[10px] font-mono text-muted break-all">
            {agent.walletAddress}
          </p>
          <div className="mt-2 h-1 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min((agent.spentUsdc / agent.budgetUsdc) * 100, 100)}%`,
                background: color,
              }}
            />
          </div>
          <p className="text-[10px] text-muted mt-1">
            ${agent.spentUsdc.toFixed(3)} / ${agent.budgetUsdc.toFixed(2)} USDC
          </p>
        </div>
      </div>

      {/* Output */}
      {agent.output && (
        <div>
          <h3 className="text-muted text-[10px] uppercase tracking-widest mb-2">
            Output
          </h3>
          <div className="bg-surface2 rounded p-3 max-h-64 overflow-y-auto">
            <MarkdownBlock content={agent.output} color={color} />
          </div>
        </div>
      )}
    </div>
  );
}

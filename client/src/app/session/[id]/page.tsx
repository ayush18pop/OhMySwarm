"use client";

import { use, useState } from "react";
import { useSession } from "../../../hooks/useSession";
import { useResizable } from "../../../hooks/useResizable";
import { SwarmCanvas } from "../../../components/Canvas/SwarmCanvas";
import { ChatPanel } from "../../../components/Terminal/ChatPanel";
import { DetailsPanel } from "../../../components/Terminal/DetailsPanel";
import { ActivityFeed } from "../../../components/Terminal/ActivityFeed";
import { FloatingChatDock } from "../../../components/Terminal/FloatingChatDock";
import { ApprovalModal } from "../../../components/Approval/ApprovalModal";
import { MarkdownBlock } from "../../../components/Terminal/MarkdownBlock";

type RightTab = "activity" | "chat" | "details";

interface Props {
  params: Promise<{ id: string }>;
}

export default function SessionPage({ params }: Props) {
  const { id: sessionId } = use(params);
  const { state, selectAgent, sendChatMessage, sendingChat } =
    useSession(sessionId);
  const { pct, containerRef, onMouseDown } = useResizable(70, 30, 85);
  const [tab, setTab] = useState<RightTab>("activity");

  const handleFloatingSend = async (message: string) => {
    await sendChatMessage(message);
    setTab("chat");
  };

  const selectedAgent = state.selectedAgentId
    ? state.agents[state.selectedAgentId]
    : null;

  const STATUS_COLOR: Record<string, string> = {
    idle: "#4a8fa8",
    pending_funding: "#ff9f1a",
    running: "#00f5ff",
    awaiting_approval: "#ffe600",
    complete: "#00ff88",
    failed: "#ff2d55",
    cancelled: "#9ca3af",
  };
  const statusColor = STATUS_COLOR[state.sessionStatus] ?? "#4a8fa8";

  const agentCount = Object.keys(state.agents).length;
  const runningCount = Object.values(state.agents).filter(
    (a) => a.status === "running",
  ).length;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden relative z-10">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/"
            className="text-muted hover:text-cyan text-[10px] transition-colors shrink-0"
          >
            ← HOME
          </a>
          <span className="text-border">│</span>
          <span className="text-primary text-[10px] truncate max-w-[360px]">
            {(state.session as { task?: string } | null)?.task ?? "Loading…"}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Parallel agents indicator */}
          {runningCount > 1 && (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded"
              style={{ background: "#00f5ff10", border: "1px solid #00f5ff30" }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse" />
              <span className="text-[9px] text-cyan font-bold">
                {runningCount} PARALLEL
              </span>
            </div>
          )}

          {/* Live dot */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${state.connected ? "animate-pulse" : ""}`}
              style={{
                background: state.connected ? "#00ff88" : "#ff2d55",
                boxShadow: state.connected ? "0 0 6px #00ff88" : "none",
              }}
            />
            <span className="text-[9px] text-muted">
              {state.connected ? "LIVE" : "OFFLINE"}
            </span>
          </div>

          {/* Status badge */}
          <div
            className="px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest"
            style={{
              color: statusColor,
              border: `1px solid ${statusColor}40`,
              background: `${statusColor}10`,
            }}
          >
            {state.sessionStatus}
          </div>
        </div>
      </header>

      {/* ── Main resizable split ─────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex flex-1 overflow-hidden select-none"
      >
        {/* LEFT — Canvas */}
        <div
          className="relative overflow-hidden border-r border-border"
          style={{ width: `${pct}%` }}
        >
          <SwarmCanvas
            agents={state.agents}
            selectedAgentId={state.selectedAgentId}
            onSelectAgent={selectAgent}
            totalSpent={state.totalSpent}
            budgetUsdc={state.budgetUsdc}
            payments={state.payments}
          />

          {/* Floating follow-up chat dock */}
          <div className="absolute bottom-4 left-4 right-4 z-20 pointer-events-none">
            <FloatingChatDock
              onSendMessage={handleFloatingSend}
              sending={sendingChat}
              disabled={
                state.sessionStatus === "pending_funding" ||
                state.sessionStatus === "failed" ||
                state.sessionStatus === "cancelled"
              }
            />
          </div>
        </div>

        {/* DRAG HANDLE */}
        <div
          className="relative w-1 shrink-0 cursor-col-resize flex items-center justify-center group z-20"
          style={{ background: "transparent" }}
          onMouseDown={onMouseDown}
        >
          {/* Thin visible bar */}
          <div
            className="w-px h-full transition-all duration-150 group-hover:w-0.5"
            style={{ background: "#0e3d52", boxShadow: "none" }}
          />
          {/* Grab dots */}
          <div className="absolute flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-muted" />
            ))}
          </div>
        </div>

        {/* RIGHT — Terminal */}
        <div
          className="flex flex-col bg-bg overflow-hidden"
          style={{ width: `${100 - pct}%` }}
        >
          {/* Tabs */}
          <div className="flex shrink-0 border-b border-border">
            {(["activity", "chat", "details"] as RightTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-[9px] font-bold uppercase tracking-[0.2em] transition-all relative ${
                  tab === t
                    ? "text-cyan bg-surface2"
                    : "text-muted hover:text-primary"
                }`}
              >
                {t === "activity" && agentCount > 0 && tab !== "activity" && (
                  <span
                    className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full"
                    style={{
                      background: "#00ff88",
                      boxShadow: "0 0 4px #00ff88",
                    }}
                  />
                )}
                {t}
                {tab === t && (
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-cyan" />
                )}
              </button>
            ))}
          </div>

          {/* Tab body */}
          <div className="flex-1 overflow-hidden">
            {tab === "activity" && (
              <ActivityFeed
                agents={state.agents}
                payments={state.payments}
                status={state.sessionStatus}
              />
            )}
            {tab === "chat" && (
              <ChatPanel
                messages={state.chatMessages}
                streamingTokens={state.streamingTokens}
                agents={state.agents}
                selectedAgentId={state.selectedAgentId}
              />
            )}
            {tab === "details" && (
              <DetailsPanel
                agent={selectedAgent}
                payments={state.payments}
                totalSpent={state.totalSpent}
                budgetUsdc={state.budgetUsdc}
              />
            )}
          </div>

          {/* Final output bar */}
          {state.finalOutput && state.sessionStatus === "complete" && (
            <div className="shrink-0 border-t border-green/20 px-3 py-3 bg-green/5 max-h-48 overflow-y-auto">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-green text-[10px] font-bold tracking-widest">
                  ✓ COMPLETE
                </span>
                <span className="text-muted text-[9px]">
                  ${state.totalSpent.toFixed(4)} USDC ·{" "}
                  {Object.keys(state.agents).length} agents
                </span>
              </div>
              <MarkdownBlock content={state.finalOutput} color="#00ff88" />
            </div>
          )}
        </div>
      </div>

      {/* Approval modal */}
      {state.pendingApproval && (
        <ApprovalModal
          sessionId={sessionId}
          approval={state.pendingApproval}
          onDone={() => {}}
        />
      )}
    </div>
  );
}

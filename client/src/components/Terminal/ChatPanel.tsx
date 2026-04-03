"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage, Agent } from "../../types";
import { MarkdownBlock } from "./MarkdownBlock";

interface ChatPanelProps {
  messages: ChatMessage[];
  streamingTokens: Record<string, string>;
  agents: Record<string, Agent>;
  selectedAgentId: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  master: "#00f5ff",
  "portfolio-scout": "#00ff88",
  "yield-scanner": "#ffe600",
  "risk-analyst": "#ff6b6b",
  "route-planner": "#c084fc",
  executor: "#fb923c",
};

const ROLE_ICONS: Record<string, string> = {
  master: "◈",
  "portfolio-scout": "◎",
  "yield-scanner": "◉",
  "risk-analyst": "◐",
  "route-planner": "⊕",
  executor: "▶",
  user: "◌",
};

export function ChatPanel({
  messages,
  streamingTokens,
  agents,
  selectedAgentId,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingTokens]);

  const filteredMessages = selectedAgentId
    ? messages.filter((m) => m.agentId === selectedAgentId || m.role === "user")
    : messages;

  // All actively streaming agents
  const streamingEntries = Object.entries(streamingTokens).filter(
    ([, v]) => v && v.length > 0,
  );
  const relevantStreaming = selectedAgentId
    ? streamingEntries.filter(([id]) => id === selectedAgentId)
    : streamingEntries;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {filteredMessages.length === 0 && relevantStreaming.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="w-1 h-1 rounded-full bg-muted animate-pulse" />
            <p className="text-muted text-[10px] uppercase tracking-widest">
              {selectedAgentId ? "No output yet" : "Awaiting agents..."}
            </p>
          </div>
        )}

        {filteredMessages.map((msg) => {
          if (msg.role === "user") {
            const ts = new Date(msg.timestamp);
            const timeStr = isNaN(ts.getTime())
              ? ""
              : ts.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
            return (
              <div key={msg.id} className="group">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm leading-none text-cyan">◌</span>
                  <span className="text-[9px] font-bold tracking-[0.2em] text-cyan">
                    YOU
                  </span>
                  {timeStr && (
                    <span className="text-[8px] text-border ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                      {timeStr}
                    </span>
                  )}
                </div>
                <div
                  className="pl-5 rounded-r-lg border-l py-0.5"
                  style={{ borderColor: "#00f5ff40" }}
                >
                  <div className="text-[10px] leading-relaxed text-primary">
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          }

          const agent = agents[msg.agentId];
          const color = ROLE_COLORS[agent?.role ?? "master"] ?? "#4a8fa8";
          const icon = ROLE_ICONS[agent?.role ?? "master"] ?? "●";
          const label = (agent?.role ?? "agent")
            .toUpperCase()
            .replace("-", " ");
          const ts = new Date(msg.timestamp);
          const timeStr = isNaN(ts.getTime())
            ? ""
            : ts.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });

          return (
            <div key={msg.id} className="group">
              {/* Agent header row */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm leading-none" style={{ color }}>
                  {icon}
                </span>
                <span
                  className="text-[9px] font-bold tracking-[0.2em]"
                  style={{ color }}
                >
                  {label}
                </span>
                {timeStr && (
                  <span className="text-[8px] text-border ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    {timeStr}
                  </span>
                )}
              </div>

              {/* Message body — markdown rendered */}
              <div
                className="pl-5 rounded-r-lg border-l py-0.5"
                style={{ borderColor: `${color}30` }}
              >
                <MarkdownBlock content={msg.content} color={color} />
              </div>
            </div>
          );
        })}

        {/* Live streaming agents — show all in parallel */}
        {relevantStreaming.map(([agentId, tokens]) => {
          const agent = agents[agentId];
          const color = ROLE_COLORS[agent?.role ?? "master"] ?? "#4a8fa8";
          const icon = ROLE_ICONS[agent?.role ?? "master"] ?? "●";
          const label = (agent?.role ?? "agent")
            .toUpperCase()
            .replace("-", " ");

          return (
            <div key={`stream-${agentId}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-sm leading-none animate-pulse"
                  style={{ color, filter: `drop-shadow(0 0 4px ${color})` }}
                >
                  {icon}
                </span>
                <span
                  className="text-[9px] font-bold tracking-[0.2em]"
                  style={{ color }}
                >
                  {label}
                </span>
                <span className="text-[8px] text-muted ml-1 animate-pulse">
                  thinking...
                </span>
              </div>
              <div
                className="pl-5 rounded-r-lg border-l py-0.5"
                style={{ borderColor: `${color}30` }}
              >
                <div
                  className="text-[10px] leading-relaxed"
                  style={{ color: `${color}cc` }}
                >
                  {tokens}
                  <span className="animate-blink ml-0.5">▊</span>
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

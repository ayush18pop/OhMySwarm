"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { AgentNode } from "./AgentNode";
import { DataFlowEdge } from "./DataFlowEdge";
import type { Agent } from "../../types";

// ── Constants ────────────────────────────────────────────────────────────────

const NODE_TYPES = { agentNode: AgentNode };
const EDGE_TYPES = { dataFlow: DataFlowEdge };

const ROLE_COLORS: Record<string, string> = {
  master: "#00f5ff",
  "portfolio-scout": "#00ff88",
  "yield-scanner": "#ffe600",
  "risk-analyst": "#ff6b6b",
  "route-planner": "#c084fc",
  executor: "#fb923c",
};

const NODE_W = 192;
const NODE_H = 140;
const COL_GAP = 32;
const ROW_GAP = 100;

// ── Layout ───────────────────────────────────────────────────────────────────

function computeLayout(
  agents: Record<string, Agent>,
  newIds: Set<string>,
  selectedId: string | null,
  payments: Record<string, number>, // agentId → latest payment amount
): { nodes: Node[]; edges: Edge[] } {
  const agentList = Object.values(agents);
  if (agentList.length === 0) return { nodes: [], edges: [] };

  const master = agentList.find((a) => a.depth === 0);
  const children = agentList.filter((a) => a.depth > 0);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const totalChildW =
    children.length * NODE_W + Math.max(0, children.length - 1) * COL_GAP;
  const masterX = Math.max(totalChildW / 2 - NODE_W / 2, 0);
  const masterY = 0;

  if (master) {
    nodes.push({
      id: master.id,
      type: "agentNode",
      position: { x: masterX, y: masterY },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        agent: master,
        color: ROLE_COLORS["master"],
        selected: selectedId === master.id,
        isNew: newIds.has(master.id),
      },
    });
  }

  children.forEach((agent, i) => {
    const x = i * (NODE_W + COL_GAP);
    const y = masterY + NODE_H + ROW_GAP;
    const col = ROLE_COLORS[agent.role] ?? "#4a8fa8";

    nodes.push({
      id: agent.id,
      type: "agentNode",
      position: { x, y },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        agent,
        color: col,
        selected: selectedId === agent.id,
        isNew: newIds.has(agent.id),
      },
    });

    const parentId = agent.parentAgentId ?? master?.id;
    if (parentId) {
      const parentAgent = agents[parentId];
      const active = agent.status === "running";
      const complete = agent.status === "complete";
      edges.push({
        id: `edge-${parentId}-${agent.id}`,
        source: parentId,
        target: agent.id,
        type: "dataFlow",
        data: {
          color: col,
          active,
          complete,
          payment: payments[agent.id],
        },
      });
    }
  });

  return { nodes, edges };
}

// ── Canvas props ──────────────────────────────────────────────────────────────

interface SwarmCanvasProps {
  agents: Record<string, Agent>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  totalSpent: number;
  budgetUsdc: number;
  payments: Array<{ agentId: string; amountUsdc: number }>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SwarmCanvas({
  agents,
  selectedAgentId,
  onSelectAgent,
  totalSpent,
  budgetUsdc,
  payments,
}: SwarmCanvasProps) {
  // Track which agent IDs are "new" so we can trigger spawn animation
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const incoming = Object.keys(agents);
    const fresh = incoming.filter((id) => !seenIdsRef.current.has(id));
    if (fresh.length > 0) {
      fresh.forEach((id) => seenIdsRef.current.add(id));
      setNewIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.add(id));
        return next;
      });
      // Clear "new" flag after animation completes
      const t = setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          fresh.forEach((id) => next.delete(id));
          return next;
        });
      }, 800);
      return () => clearTimeout(t);
    }
  }, [agents]);

  // Latest payment per agent (for edge labels)
  const paymentMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payments) {
      map[p.agentId] = p.amountUsdc;
    }
    return map;
  }, [payments]);

  const { nodes: computed, edges: computedEdges } = useMemo(
    () => computeLayout(agents, newIds, selectedAgentId, paymentMap),
    [agents, newIds, selectedAgentId, paymentMap],
  );

  // Preserve user-moved positions
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, , onEdgesChange] = useEdgesState([]);

  // Merge computed layout into React Flow state (only add/update, don't reposition existing)
  useEffect(() => {
    setNodes((prev) => {
      const prevMap = Object.fromEntries(prev.map((n) => [n.id, n]));
      return computed.map((cn) => {
        const existing = prevMap[cn.id];
        if (existing) {
          // Update data (status, etc) but keep user-moved position
          return { ...cn, position: existing.position };
        }
        return cn;
      });
    });
  }, [computed, setNodes]);

  const syncedEdges = computedEdges;

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onSelectAgent(node.id),
    [onSelectAgent],
  );

  const spentPct = Math.min((totalSpent / budgetUsdc) * 100, 100);
  const agentCount = Object.keys(agents).length;

  return (
    <div className="relative w-full h-full bg-bg">
      {/* ── HUD top-left ──────────────────────────────────────── */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-4">
        {/* System label */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: agentCount > 0 ? "#00ff88" : "#0e3d52",
              boxShadow: agentCount > 0 ? "0 0 6px #00ff88" : "none",
              animation: agentCount > 0 ? "blink 2s step-end infinite" : "none",
            }}
          />
          <span className="text-muted text-[9px] uppercase tracking-[0.3em]">
            SWARM·{agentCount > 0 ? `${agentCount} ACTIVE` : "IDLE"}
          </span>
        </div>

        {/* Budget bar */}
        <div className="flex-1 flex items-center gap-2">
          <div
            className="flex-1 h-px overflow-hidden relative"
            style={{ background: "#0e3d52" }}
          >
            <div
              className="absolute left-0 top-0 h-full transition-all duration-700"
              style={{
                width: `${spentPct}%`,
                background:
                  spentPct > 80
                    ? "linear-gradient(90deg, #ff2d55, #ff6b8a)"
                    : spentPct > 50
                      ? "linear-gradient(90deg, #ffe600, #ffb700)"
                      : "linear-gradient(90deg, #00ff88, #00d4ff)",
                boxShadow: spentPct > 50 ? "0 0 6px currentColor" : "none",
              }}
            />
          </div>
          <span
            className="text-[9px] font-mono shrink-0"
            style={{ color: spentPct > 80 ? "#ff2d55" : "#00ff88" }}
          >
            ${totalSpent.toFixed(3)}&nbsp;/&nbsp;${budgetUsdc.toFixed(2)}
          </span>
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {agentCount === 0 && <EmptyState />}

      {/* ── React Flow ────────────────────────────────────────────────── */}
      <ReactFlow
        nodes={nodes}
        edges={syncedEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelectAgent(null)}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
        nodesDraggable
        panOnScroll
        zoomOnScroll
        minZoom={0.3}
        maxZoom={2}
      >
        <Background
          color="#0e3d52"
          gap={40}
          size={0.5}
          style={{ opacity: 0.4 }}
        />
        <Controls
          position="top-right"
          className="swarm-controls"
          style={{
            background: "transparent",
            border: "none",
            borderRadius: 0,
            boxShadow: "none",
          }}
          showInteractive={false}
        />
      </ReactFlow>

      {/* ── Corner decorations ───────────────────────────────────────── */}
      <CornerDecor position="tl" />
      <CornerDecor position="bl" />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
      {/* Radar rings */}
      <div className="relative flex items-center justify-center mb-6">
        {[60, 90, 120].map((size, i) => (
          <div
            key={size}
            className="absolute rounded-full border"
            style={{
              width: size,
              height: size,
              borderColor: `rgba(0,245,255,${0.12 - i * 0.03})`,
              animation: `ringPulse ${3 + i}s ease-out infinite`,
              animationDelay: `${i * 0.6}s`,
            }}
          />
        ))}
        {/* Radar sweep */}
        <div
          className="absolute w-14 h-14 rounded-full overflow-hidden"
          style={{ border: "1px solid #00f5ff20" }}
        >
          <div
            className="absolute top-1/2 left-1/2 w-7 h-px origin-left"
            style={{
              background: "linear-gradient(90deg, transparent, #00f5ff80)",
              animation: "radarSweep 3s linear infinite",
              marginTop: "-0.5px",
            }}
          />
        </div>
        {/* Center dot */}
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: "#00f5ff", boxShadow: "0 0 8px #00f5ff" }}
        />
      </div>

      <p className="text-[10px] text-muted uppercase tracking-[0.4em] mb-1">
        Swarm Standby
      </p>
      <p className="text-[9px] text-border uppercase tracking-widest">
        Awaiting task deployment
      </p>
    </div>
  );
}

function CornerDecor({ position }: { position: "tl" | "bl" }) {
  const isTL = position === "tl";
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: isTL ? 0 : undefined,
        bottom: isTL ? undefined : 0,
        left: 0,
        width: 32,
        height: 32,
      }}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <path
          d={isTL ? "M 0 16 L 0 0 L 16 0" : "M 0 16 L 0 32 L 16 32"}
          stroke="#0e3d52"
          strokeWidth="1"
          fill="none"
        />
      </svg>
    </div>
  );
}

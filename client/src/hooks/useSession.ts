"use client";

import { useReducer, useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  Agent,
  Payment,
  ChatMessage,
  AgentSpawnedPayload,
  AgentThinkingPayload,
  AgentCompletePayload,
  AgentFailedPayload,
  ToolCalledPayload,
  ToolResultPayload,
  PaymentConfirmedPayload,
  AwaitingApprovalPayload,
  SessionCompletePayload,
  WalletUpdatePayload,
  TreasuryUpdatePayload,
  SessionFundingRequiredPayload,
  SessionFundedPayload,
} from "../types";
import { getSession, sendSessionChatMessage } from "../lib/api";
import type { Node, Edge } from "reactflow";

// ── State ────────────────────────────────────────────────────────────────────

export interface SessionState {
  session: Record<string, unknown> | null;
  agents: Record<string, Agent>;
  chatMessages: ChatMessage[];
  streamingTokens: Record<string, string>; // agentId → accumulated tokens
  payments: Payment[];
  pendingApproval: AwaitingApprovalPayload | null;
  activeTab: "chat" | "details";
  selectedAgentId: string | null;
  finalOutput: string | null;
  connected: boolean;
  sessionStatus:
    | "idle"
    | "pending_funding"
    | "running"
    | "awaiting_approval"
    | "complete"
    | "failed"
    | "cancelled";
  totalSpent: number;
  budgetUsdc: number;
}

const initialState: SessionState = {
  session: null,
  agents: {},
  chatMessages: [],
  streamingTokens: {},
  payments: [],
  pendingApproval: null,
  activeTab: "chat",
  selectedAgentId: null,
  finalOutput: null,
  connected: false,
  sessionStatus: "idle",
  totalSpent: 0,
  budgetUsdc: 2,
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type SessionAction =
  | {
      type: "INIT";
      payload: {
        session: Record<string, unknown>;
        agents: Agent[];
        payments: Payment[];
      };
    }
  | { type: "SESSION_FUNDING_REQUIRED"; payload: SessionFundingRequiredPayload }
  | { type: "SESSION_FUNDED"; payload: SessionFundedPayload }
  | { type: "AGENT_SPAWNED"; payload: AgentSpawnedPayload }
  | { type: "AGENT_THINKING"; payload: AgentThinkingPayload }
  | { type: "AGENT_COMPLETE"; payload: AgentCompletePayload }
  | { type: "AGENT_FAILED"; payload: AgentFailedPayload }
  | { type: "TOOL_CALLED"; payload: ToolCalledPayload }
  | { type: "TOOL_RESULT"; payload: ToolResultPayload }
  | { type: "PAYMENT_CONFIRMED"; payload: PaymentConfirmedPayload }
  | { type: "AWAITING_APPROVAL"; payload: AwaitingApprovalPayload }
  | { type: "SESSION_COMPLETE"; payload: SessionCompletePayload }
  | { type: "SESSION_FAILED"; payload: { error: string } }
  | { type: "WALLET_UPDATE"; payload: WalletUpdatePayload }
  | { type: "TREASURY_UPDATE"; payload: TreasuryUpdatePayload }
  | { type: "SELECT_AGENT"; payload: string | null }
  | { type: "SET_TAB"; payload: "chat" | "details" }
  | { type: "SET_CONNECTED"; payload: boolean }
  | { type: "CHAT_MESSAGE"; payload: ChatMessage };

// ── Reducer ───────────────────────────────────────────────────────────────────

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "INIT": {
      const agentMap: Record<string, Agent> = {};
      action.payload.agents.forEach((a) => {
        agentMap[a.id] = a;
      });
      const s = action.payload.session as {
        budgetUsdc?: number;
        spentUsdc?: number;
        status?: string;
        finalOutput?: string;
      };
      return {
        ...state,
        session: action.payload.session,
        agents: agentMap,
        payments: action.payload.payments,
        budgetUsdc: s.budgetUsdc ?? 2,
        totalSpent: s.spentUsdc ?? 0,
        sessionStatus: (s.status ?? "idle") as SessionState["sessionStatus"],
        finalOutput: s.finalOutput ?? null,
      };
    }

    case "SESSION_FUNDING_REQUIRED":
      return {
        ...state,
        sessionStatus: "pending_funding",
      };

    case "SESSION_FUNDED":
      return {
        ...state,
        sessionStatus: "running",
      };

    case "AGENT_SPAWNED": {
      const { agentId, parentId, role, task, walletAddress, budgetUsdc } =
        action.payload;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: {
            id: agentId,
            sessionId: "",
            parentAgentId: parentId,
            depth: parentId ? 1 : 0,
            role,
            task,
            status: "running",
            walletAddress,
            budgetUsdc,
            spentUsdc: 0,
            toolCallCount: 0,
            createdAt: new Date().toISOString(),
          },
        },
      };
    }

    case "AGENT_THINKING": {
      const { agentId, token } = action.payload;
      return {
        ...state,
        streamingTokens: {
          ...state.streamingTokens,
          [agentId]: (state.streamingTokens[agentId] ?? "") + token,
        },
      };
    }

    case "AGENT_COMPLETE": {
      const { agentId, output, spentUsdc } = action.payload;
      const agent = state.agents[agentId];
      if (!agent) return state;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: {
            ...agent,
            status: "complete",
            output,
            spentUsdc,
            completedAt: new Date().toISOString(),
          },
        },
        streamingTokens: { ...state.streamingTokens, [agentId]: "" },
      };
    }

    case "AGENT_FAILED": {
      const { agentId, error } = action.payload;
      const agent = state.agents[agentId];
      if (!agent) return state;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: { ...agent, status: "failed", output: `Error: ${error}` },
        },
      };
    }

    case "PAYMENT_CONFIRMED": {
      const { paymentId, agentId, amountUsdc, txHash, description } =
        action.payload;
      return {
        ...state,
        totalSpent: state.totalSpent + amountUsdc,
        payments: [
          ...state.payments,
          {
            id: paymentId,
            sessionId: "",
            agentId,
            amountUsdc,
            txHash,
            status: "confirmed",
            description,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }

    case "AWAITING_APPROVAL":
      return {
        ...state,
        pendingApproval: action.payload,
        sessionStatus: "awaiting_approval",
      };

    case "SESSION_COMPLETE":
      return {
        ...state,
        finalOutput: action.payload.finalOutput,
        totalSpent: action.payload.totalSpentUsdc,
        sessionStatus: "complete",
        pendingApproval: null,
      };

    case "SESSION_FAILED":
      return { ...state, sessionStatus: "failed" };

    case "WALLET_UPDATE": {
      const { agentId, spentUsdc, budgetUsdc } = action.payload;
      const agent = state.agents[agentId];
      if (!agent) return state;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: { ...agent, spentUsdc, budgetUsdc },
        },
      };
    }

    case "TREASURY_UPDATE":
      return {
        ...state,
        totalSpent: action.payload.spentUsdc,
        budgetUsdc: action.payload.budgetUsdc,
      };

    case "CHAT_MESSAGE":
      return {
        ...state,
        chatMessages: [...state.chatMessages, action.payload],
      };

    case "SELECT_AGENT":
      return { ...state, selectedAgentId: action.payload };

    case "SET_TAB":
      return { ...state, activeTab: action.payload };

    case "SET_CONNECTED":
      return { ...state, connected: action.payload };

    default:
      return state;
  }
}

// ── React Flow helpers ────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  master: "#00f5ff",
  "portfolio-scout": "#00ff88",
  "yield-scanner": "#ffe600",
  "risk-analyst": "#ff6b6b",
  "route-planner": "#c084fc",
  executor: "#fb923c",
};

export function agentsToFlowNodes(
  agents: Record<string, Agent>,
  selected: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const agentList = Object.values(agents);
  const master = agentList.find((a) => a.role === "master" || a.depth === 0);
  const children = agentList.filter((a) => a.role !== "master" && a.depth > 0);

  if (master) {
    nodes.push({
      id: master.id,
      type: "agentNode",
      position: { x: 350, y: 50 },
      data: {
        agent: master,
        color: ROLE_COLORS["master"],
        selected: selected === master.id,
      },
    });
  }

  children.forEach((agent, i) => {
    const x = 100 + i * 220;
    nodes.push({
      id: agent.id,
      type: "agentNode",
      position: { x, y: 260 },
      data: {
        agent,
        color: ROLE_COLORS[agent.role] ?? "#4a8fa8",
        selected: selected === agent.id,
      },
    });

    const parentId = agent.parentAgentId ?? master?.id;
    if (parentId) {
      edges.push({
        id: `${parentId}-${agent.id}`,
        source: parentId,
        target: agent.id,
        animated: agent.status === "running",
        style: {
          stroke: ROLE_COLORS[agent.role] ?? "#4a8fa8",
          strokeWidth: 2,
          opacity: 0.6,
        },
        labelStyle: { fill: "#c8f0f8", fontFamily: "JetBrains Mono" },
      });
    }
  });

  return { nodes, edges };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSession(sessionId: string | null) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const [sendingChat, setSendingChat] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Load initial state
  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then((data) => {
        dispatch({
          type: "INIT",
          payload: {
            session: data,
            agents: data.agents ?? [],
            payments: data.payments ?? [],
          },
        });
      })
      .catch(console.error);
  }, [sessionId]);

  // Socket.io connection
  useEffect(() => {
    if (!sessionId) return;

    const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";
    const socket = io(WS_URL, {
      query: { sessionId },
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("connect", () =>
      dispatch({ type: "SET_CONNECTED", payload: true }),
    );
    socket.on("disconnect", () =>
      dispatch({ type: "SET_CONNECTED", payload: false }),
    );

    socket.on("SESSION_FUNDING_REQUIRED", (p: SessionFundingRequiredPayload) =>
      dispatch({ type: "SESSION_FUNDING_REQUIRED", payload: p }),
    );
    socket.on("SESSION_FUNDED", (p: SessionFundedPayload) =>
      dispatch({ type: "SESSION_FUNDED", payload: p }),
    );
    socket.on("AGENT_SPAWNED", (p: AgentSpawnedPayload) =>
      dispatch({ type: "AGENT_SPAWNED", payload: p }),
    );
    socket.on("AGENT_THINKING", (p: AgentThinkingPayload) =>
      dispatch({ type: "AGENT_THINKING", payload: p }),
    );
    socket.on("AGENT_COMPLETE", (p: AgentCompletePayload) =>
      dispatch({ type: "AGENT_COMPLETE", payload: p }),
    );
    socket.on("AGENT_FAILED", (p: AgentFailedPayload) =>
      dispatch({ type: "AGENT_FAILED", payload: p }),
    );
    socket.on("TOOL_CALLED", (p: ToolCalledPayload) =>
      dispatch({ type: "TOOL_CALLED", payload: p }),
    );
    socket.on("TOOL_RESULT", (p: ToolResultPayload) =>
      dispatch({ type: "TOOL_RESULT", payload: p }),
    );
    socket.on("PAYMENT_CONFIRMED", (p: PaymentConfirmedPayload) =>
      dispatch({ type: "PAYMENT_CONFIRMED", payload: p }),
    );
    socket.on("AWAITING_APPROVAL", (p: AwaitingApprovalPayload) =>
      dispatch({ type: "AWAITING_APPROVAL", payload: p }),
    );
    socket.on("SESSION_COMPLETE", (p: SessionCompletePayload) =>
      dispatch({ type: "SESSION_COMPLETE", payload: p }),
    );
    socket.on("SESSION_FAILED", (p: { error: string }) =>
      dispatch({ type: "SESSION_FAILED", payload: p }),
    );
    socket.on("WALLET_UPDATE", (p: WalletUpdatePayload) =>
      dispatch({ type: "WALLET_UPDATE", payload: p }),
    );
    socket.on("TREASURY_UPDATE", (p: TreasuryUpdatePayload) =>
      dispatch({ type: "TREASURY_UPDATE", payload: p }),
    );
    socket.on("CHAT_MESSAGE", (p: Partial<ChatMessage>) => {
      const normalized: ChatMessage = {
        id: p.id ?? `${p.agentId ?? "agent"}-${Date.now()}`,
        agentId: p.agentId ?? "unknown",
        role: (p.role ?? "assistant") as ChatMessage["role"],
        content: p.content ?? "",
        timestamp: p.timestamp ?? Date.now(),
      };
      dispatch({ type: "CHAT_MESSAGE", payload: normalized });
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId]);

  const selectAgent = useCallback((id: string | null) => {
    dispatch({ type: "SELECT_AGENT", payload: id });
  }, []);

  const setTab = useCallback((tab: "chat" | "details") => {
    dispatch({ type: "SET_TAB", payload: tab });
  }, []);

  const sendChatMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!sessionId || !trimmed || sendingChat) return;
      setSendingChat(true);
      try {
        await sendSessionChatMessage(sessionId, trimmed);
      } finally {
        setSendingChat(false);
      }
    },
    [sessionId, sendingChat],
  );

  return { state, selectAgent, setTab, sendChatMessage, sendingChat };
}

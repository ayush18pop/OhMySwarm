/**
 * server/agent/executor.ts
 *
 * Generic sub-agent ReAct runner.
 * Given a role, task, and set of tools — runs a tool-calling loop
 * until the agent produces a final text response or hits max tool calls.
 */

import { llmCallWithTools, llmCall, LLMMessage, LLMTool } from "../llm";
import { buildSubAgentSystemPrompt } from "./prompts";
import { prisma } from "../db";
import { Prisma } from "@prisma/client";
import {
  emitToolCalled,
  emitToolResult,
  emitChatMessage,
  emitAgentThinking,
} from "../emit";
import { v4 as uuidv4 } from "uuid";
import { executeSpawnSubAgent } from "../tools/spawnSubAgent";

const MAX_DEPTH = parseInt(process.env.AGENT_MAX_DEPTH ?? "2");

const SPAWN_TOOL: LLMTool = {
  name: "spawn_sub_agent",
  description:
    "Spawn a specialist sub-agent for a focused sub-task. Only use when the task genuinely benefits from parallelism or specialization.",
  parameters: {
    type: "object",
    properties: {
      role: {
        type: "string",
        description: "Agent role to spawn",
        enum: [
          "portfolio-scout",
          "yield-scanner",
          "risk-analyst",
          "route-planner",
          "executor",
          "chain-analyst",
          "token-analyst",
          "protocol-researcher",
          "liquidity-scout",
        ],
      },
      task: {
        type: "string",
        description: "Task description for the sub-agent",
      },
      budgetUsdc: {
        type: "number",
        description: "Budget in USDC (0.01 - 0.10)",
      },
      context: { type: "string", description: "Optional context to pass" },
    },
    required: ["role", "task", "budgetUsdc"],
  },
};

export interface SubAgentRunInput {
  agentId: string;
  sessionId: string;
  role: string;
  task: string;
  budgetUsdc: number;
  context?: string;
  tools: LLMTool[];
  toolHandlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >;
}

export interface SubAgentRunResult {
  output: string;
  spentUsdc: number;
}

const MAX_TOOL_CALLS = parseInt(process.env.AGENT_MAX_TOOL_CALLS ?? "15");

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function toNullableInputJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function runSubAgent(
  input: SubAgentRunInput,
): Promise<SubAgentRunResult> {
  const { agentId, sessionId, role, task, context, tools, toolHandlers } =
    input;

  // Allow sub-agents to spawn their own sub-agents if below depth limit
  const agentRecord = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { depth: true },
  });
  const depth = agentRecord?.depth ?? 0;
  const canSpawn = depth < MAX_DEPTH;

  const allTools = canSpawn ? [...tools, SPAWN_TOOL] : tools;
  const allHandlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  > = {
    ...toolHandlers,
    ...(canSpawn
      ? {
          spawn_sub_agent: async (args: Record<string, unknown>) => {
            return executeSpawnSubAgent({
              sessionId,
              parentId: agentId,
              role: String(args.role),
              task: String(args.task),
              budgetUsdc: Number(args.budgetUsdc),
              context: args.context ? String(args.context) : undefined,
            });
          },
        }
      : {}),
  };

  const systemPrompt = buildSubAgentSystemPrompt(role);
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: context
        ? `Context:\n${context}\n\nTask: ${task}`
        : `Task: ${task}`,
    },
  ];

  let toolCallCount = 0;

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await llmCallWithTools(messages, allTools, {
      temperature: 0.2,
      max_tokens: 1024,
    });

    // Stream content to chat panel token by token
    if (response.content) {
      for (const char of response.content) {
        emitAgentThinking(sessionId, { agentId, token: char });
      }
      emitChatMessage(sessionId, {
        id: uuidv4(),
        agentId,
        role: "assistant",
        content: response.content,
        timestamp: Date.now(),
      });
      messages.push({ role: "assistant", content: response.content });
    }

    // No tool calls → final answer
    if (response.toolCalls.length === 0) {
      const output = response.content ?? "No output produced";
      await prisma.agent.update({
        where: { id: agentId },
        data: { toolCallCount, output },
      });
      return { output, spentUsdc: 0 };
    }

    // Store tool calls as structured data (not JSON-in-content)
    messages.push({
      role: "assistant",
      content: response.content ?? null,
      tool_calls: response.toolCalls,
    });

    // Execute each tool call
    for (const tc of response.toolCalls) {
      const toolCallId = uuidv4();
      const start = Date.now();

      emitToolCalled(sessionId, {
        agentId,
        toolCallId,
        toolName: tc.name,
        input: tc.arguments,
      });

      // Save tool call to DB
      await prisma.toolCall.create({
        data: {
          id: toolCallId,
          agentId,
          sessionId,
          toolName: tc.name,
          input: toInputJson(tc.arguments),
          status: "running",
        },
      });

      let toolOutput: unknown;
      let status = "done";

      try {
        const handler = allHandlers[tc.name];
        if (!handler) throw new Error(`Unknown tool: ${tc.name}`);
        toolOutput = await handler(tc.arguments as Record<string, unknown>);
      } catch (err) {
        toolOutput = {
          error: err instanceof Error ? err.message : String(err),
        };
        status = "failed";
      }

      const durationMs = Date.now() - start;

      await prisma.toolCall.update({
        where: { id: toolCallId },
        data: { output: toNullableInputJson(toolOutput), status, durationMs },
      });

      emitToolResult(sessionId, {
        agentId,
        toolCallId,
        toolName: tc.name,
        output: toolOutput,
        durationMs,
      });

      messages.push({
        role: "tool",
        content: JSON.stringify(toolOutput),
        tool_call_id: tc.id,
        name: tc.name,
      });

      toolCallCount++;
    }
  }

  // Hit max tool calls — force final answer
  const finalMsg = await llmCall(messages, {
    system: `${systemPrompt}\n\nYou have reached the tool call limit. Summarize your findings now.`,
    temperature: 0,
  });

  await prisma.agent.update({
    where: { id: agentId },
    data: { toolCallCount, output: finalMsg },
  });

  return { output: finalMsg, spentUsdc: 0 };
}

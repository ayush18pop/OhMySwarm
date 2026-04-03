/**
 * server/agent/graph.ts
 *
 * LangGraph ReAct loop for the master agent.
 * Two tools: spawn_sub_agent (blocking, parallel) and request_approval (interrupt).
 * Checkpointed to Supabase via PostgresSaver.
 */

import { Annotation, StateGraph, interrupt, START, END } from '@langchain/langgraph'
import { PostgresSaver }    from '@langchain/langgraph-checkpoint-postgres'
import { llmCallWithTools, LLMMessage, summarizeMessages } from '../llm'
import { MASTER_TOOLS }     from './tools'
import { MASTER_SYSTEM_PROMPT } from './prompts'
import { executeSpawnSubAgent } from '../tools/spawnSubAgent'

// ── State ─────────────────────────────────────────────────────────────────────

const GraphState = Annotation.Root({
  sessionId:   Annotation<string>(),
  task:        Annotation<string>(),
  messages:    Annotation<LLMMessage[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  toolCallCount: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  pendingApproval: Annotation<{
    phase:     'research' | 'execution'
    summary:   string
    proposals: unknown[]
  } | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  approvalDecision: Annotation<'approved' | 'rejected' | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  finalOutput: Annotation<string | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
})

type GraphStateType = typeof GraphState.State
type ToolCall = { id: string; name: string; arguments: Record<string, unknown> }

// ── Node: llm ─────────────────────────────────────────────────────────────────

async function llmNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { messages, toolCallCount, approvalDecision } = state

  // If we just got an approval decision, inject it into messages
  let currentMessages = [...messages]
  if (approvalDecision) {
    currentMessages.push({
      role: 'user',
      content: `User approval decision: ${approvalDecision}. Continue with the next phase.`,
    })
  }

  // Context-window management: summarize every 5 tool calls
  if (toolCallCount > 0 && toolCallCount % 5 === 0) {
    const older  = currentMessages.slice(0, -4)
    const recent = currentMessages.slice(-4)
    if (older.length > 2) {
      const summary = await summarizeMessages(older)
      currentMessages = [
        { role: 'system',    content: MASTER_SYSTEM_PROMPT },
        { role: 'assistant', content: `[Context summary]\n${summary}` },
        ...recent,
      ]
    }
  }

  const response = await llmCallWithTools(
    currentMessages,
    MASTER_TOOLS,
    { system: MASTER_SYSTEM_PROMPT, temperature: 0.2 },
  )

  const newMessages: LLMMessage[] = []

  if (response.content) {
    newMessages.push({ role: 'assistant', content: response.content })
  }

  if (response.toolCalls.length > 0) {
    // Store tool calls as structured data — NOT as JSON-in-content
    // This avoids the Gemini "function_response.name cannot be empty" error
    newMessages.push({
      role:      'assistant',
      content:   response.content ?? '',
      tool_calls: response.toolCalls as LLMMessage['tool_calls'],
    })
  }

  return {
    messages:         newMessages,
    toolCallCount:    toolCallCount + response.toolCalls.length,
    finalOutput:      response.toolCalls.length === 0 ? (response.content ?? null) : null,
    approvalDecision: null, // Reset approval decision after consuming it
  }
}

// ── Node: tools ───────────────────────────────────────────────────────────────

async function toolNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { sessionId, messages } = state

  // Read tool calls from the structured field on the last assistant message
  const lastMsg = messages[messages.length - 1]
  const toolCalls: ToolCall[] = (lastMsg?.tool_calls as ToolCall[] | undefined) ?? []

  if (toolCalls.length === 0) return {}

  const newMessages: LLMMessage[] = []

  // Handle request_approval first (it's an interrupt — must be singular)
  const approvalCall = toolCalls.find(tc => tc.name === 'request_approval')
  if (approvalCall) {
    const args = approvalCall.arguments as {
      phase:     'research' | 'execution'
      summary:   string
      proposals: string
    }
    let proposals: unknown[] = []
    try { proposals = JSON.parse(args.proposals) } catch { proposals = [] }

    const decision = await interrupt({
      phase:     args.phase,
      summary:   args.summary,
      proposals,
    }) as 'approved' | 'rejected'

    newMessages.push({
      role:        'tool',
      content:     `Approval decision: ${decision}`,
      tool_call_id: approvalCall.id,
      name:        approvalCall.name,
    })

    return {
      messages:         newMessages,
      pendingApproval:  null,
      approvalDecision: decision,
    }
  }

  // All spawn_sub_agent calls run IN PARALLEL with Promise.all
  const spawnCalls = toolCalls.filter(tc => tc.name === 'spawn_sub_agent')

  const results = await Promise.all(
    spawnCalls.map(async tc => {
      const args = tc.arguments as {
        role:       string
        task:       string
        budgetUsdc: number
        context?:   string
      }
      try {
        const result = await executeSpawnSubAgent({
          sessionId,
          role:       args.role,
          task:       args.task,
          budgetUsdc: args.budgetUsdc,
          context:    args.context,
        })
        return { tc, content: JSON.stringify(result), ok: true }
      } catch (err) {
        return { tc, content: `Error: ${err instanceof Error ? err.message : String(err)}`, ok: false }
      }
    }),
  )

  for (const { tc, content } of results) {
    newMessages.push({
      role:        'tool',
      content,
      tool_call_id: tc.id,
      name:        tc.name,
    })
  }

  return { messages: newMessages }
}

// ── Router ────────────────────────────────────────────────────────────────────

function shouldContinue(state: GraphStateType): 'tools' | 'end' {
  if (state.finalOutput !== null) return 'end'
  const lastMsg = state.messages[state.messages.length - 1]
  if (!lastMsg) return 'end'
  const calls = (lastMsg.tool_calls as ToolCall[] | undefined) ?? []
  return calls.length > 0 ? 'tools' : 'end'
}

// ── Graph build ───────────────────────────────────────────────────────────────

export function buildMasterGraph(checkpointer: PostgresSaver) {
  return new StateGraph(GraphState)
    .addNode('llm',   llmNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'llm')
    .addConditionalEdges('llm', shouldContinue, { tools: 'tools', end: END })
    .addEdge('tools', 'llm')
    .compile({ checkpointer, interruptBefore: [] })
}

// ── Checkpointer factory ──────────────────────────────────────────────────────

let _checkpointer: PostgresSaver | null = null

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (_checkpointer) return _checkpointer
  const saver = PostgresSaver.fromConnString(process.env.DATABASE_URL!)
  await saver.setup()
  _checkpointer = saver
  return saver
}

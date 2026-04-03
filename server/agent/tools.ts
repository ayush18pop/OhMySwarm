/**
 * server/agent/tools.ts
 *
 * Tool definitions for the master agent ReAct loop.
 * Only two tools: spawn_sub_agent and request_approval.
 */

import type { LLMTool } from '../llm'

export const MASTER_TOOLS: LLMTool[] = [
  {
    name: 'spawn_sub_agent',
    description: `Spawn a specialist sub-agent to perform a DeFi task.
The call is BLOCKING — you will receive the agent's complete output when done.
Always use this tool. Never answer DeFi questions directly.`,
    parameters: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'Agent role to spawn',
          enum: [
          'portfolio-scout', 'yield-scanner', 'risk-analyst', 'route-planner', 'executor',
          'chain-analyst', 'token-analyst', 'protocol-researcher', 'liquidity-scout',
        ],
        },
        task: {
          type: 'string',
          description: 'Clear, specific task description for the sub-agent. Include relevant context from previous agents.',
        },
        budgetUsdc: {
          type: 'number',
          description: 'Budget in USDC allocated to this sub-agent (0.01 - 0.50)',
        },
        context: {
          type: 'string',
          description: 'Optional prior research context to pass to this agent (e.g. portfolio summary from scout)',
        },
      },
      required: ['role', 'task', 'budgetUsdc'],
    },
  },
  {
    name: 'request_approval',
    description: `Pause execution and request user approval before proceeding.
Use phase='research' after research agents complete (before planning execution).
Use phase='execution' after route-planner completes (before executing transactions).
This will interrupt the graph and wait for the user to approve or reject.`,
    parameters: {
      type: 'object',
      properties: {
        phase: {
          type: 'string',
          description: 'Which approval gate this is',
          enum: ['research', 'execution'],
        },
        summary: {
          type: 'string',
          description: 'Human-readable summary of what was found / what will be executed',
        },
        proposals: {
          type: 'string',
          description: 'JSON array string of proposals. For research: yield pools. For execution: transaction steps.',
        },
      },
      required: ['phase', 'summary', 'proposals'],
    },
  },
]

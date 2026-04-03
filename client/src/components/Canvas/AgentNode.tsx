'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position }                   from 'reactflow'
import type { Agent }                         from '../../types'

interface AgentNodeProps {
  data: {
    agent:       Agent
    color:       string
    selected:    boolean
    isNew:       boolean   // triggers spawn animation
  }
}

// Inline SVG logos for each API provider — no external dependencies
const ROLE_LOGOS: Record<string, React.ReactNode> = {
  // OWS — custom hex icon
  master: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" stroke="#00f5ff" strokeWidth="2" fill="none"/>
      <circle cx="12" cy="12" r="3" fill="#00f5ff"/>
    </svg>
  ),
  // Zerion — Z letter
  'portfolio-scout': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#6c5ce7" opacity="0.9"/>
      <path d="M7 8h10L7 16h10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  // DefiLlama — llama silhouette approximated
  'yield-scanner': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="10" fill="#2ed573" opacity="0.9"/>
      <text x="5" y="16" fontSize="12" fontWeight="bold" fill="white" fontFamily="monospace">Σ</text>
    </svg>
  ),
  // Risk — shield
  'risk-analyst': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 3L4 7v5c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V7L12 3z" fill="#ff6b35" opacity="0.9"/>
      <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  // Route — path icon
  'route-planner': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#0070f3" opacity="0.9"/>
      <path d="M6 18c0-4 3-6 6-6s6-2 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <circle cx="6" cy="18" r="2" fill="white"/>
      <circle cx="18" cy="6" r="2" fill="white"/>
    </svg>
  ),
  // Executor — lightning bolt
  executor: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#ffe600" opacity="0.9"/>
      <path d="M13 3L5 13h7l-1 8 8-10h-7l1-8z" fill="#1a1a00"/>
    </svg>
  ),
  // Chain Analyst — chain links
  'chain-analyst': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#6366f1" opacity="0.9"/>
      <path d="M9 17H7a4 4 0 0 1 0-8h2M15 7h2a4 4 0 0 1 0 8h-2M9 12h6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  // CoinGecko — gecko/coin
  'token-analyst': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#8dc63f" opacity="0.9"/>
      <circle cx="12" cy="12" r="6" fill="white" opacity="0.3"/>
      <text x="7" y="16" fontSize="10" fontWeight="bold" fill="white" fontFamily="monospace">CG</text>
    </svg>
  ),
  // Protocol Researcher — magnifier + graph
  'protocol-researcher': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#e74c3c" opacity="0.9"/>
      <circle cx="10" cy="10" r="4" stroke="white" strokeWidth="2" fill="none"/>
      <path d="M14 14l4 4" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  // Liquidity Scout — droplet / pool
  'liquidity-scout': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#00b4d8" opacity="0.9"/>
      <path d="M12 4c0 0-6 6-6 10a6 6 0 0 0 12 0C18 10 12 4 12 4z" fill="white" opacity="0.9"/>
    </svg>
  ),
}

const ROLE_META: Record<string, { icon: string; label: string; shortDesc: string; provider: string }> = {
  master:                { icon: '◈', label: 'MASTER',      shortDesc: 'Orchestrator',    provider: 'OWS'        },
  'portfolio-scout':     { icon: '◎', label: 'SCOUT',       shortDesc: 'Portfolio scan',  provider: 'Zerion'     },
  'yield-scanner':       { icon: '◉', label: 'SCANNER',     shortDesc: 'Yield research',  provider: 'DefiLlama'  },
  'risk-analyst':        { icon: '◐', label: 'RISK',        shortDesc: 'Risk analysis',   provider: 'DefiLlama'  },
  'route-planner':       { icon: '⊕', label: 'PLANNER',     shortDesc: 'Route planning',  provider: 'OWS'        },
  executor:              { icon: '▶', label: 'EXEC',        shortDesc: 'Tx execution',    provider: 'OWS'        },
  'chain-analyst':       { icon: '⬡', label: 'CHAIN',       shortDesc: 'Chain metrics',   provider: 'DefiLlama'  },
  'token-analyst':       { icon: '◆', label: 'TOKEN',       shortDesc: 'Token prices',    provider: 'CoinGecko'  },
  'protocol-researcher': { icon: '🔍', label: 'PROTOCOL',   shortDesc: 'Protocol deep-dive', provider: 'DefiLlama' },
  'liquidity-scout':     { icon: '💧', label: 'LIQUIDITY',  shortDesc: 'LP pools',        provider: 'DefiLlama'  },
}

const MAX_TOOL_DOTS = 8

export const AgentNode = memo(function AgentNode({ data }: AgentNodeProps) {
  const { agent, color, selected, isNew } = data
  const meta     = ROLE_META[agent.role] ?? { icon: '●', label: agent.role.toUpperCase(), shortDesc: '', provider: '' }
  const isMaster = agent.role === 'master'

  const [spawned,   setSpawned]   = useState(false)
  const [showCheck, setShowCheck] = useState(false)
  const prevStatus = useRef(agent.status)

  // Trigger spawn entry animation
  useEffect(() => {
    if (isNew) {
      const t = setTimeout(() => setSpawned(true), 10)
      return () => clearTimeout(t)
    }
    setSpawned(true)
  }, [isNew])

  // Trigger check flash when transitioning to complete
  useEffect(() => {
    if (prevStatus.current !== 'complete' && agent.status === 'complete') {
      setShowCheck(true)
    }
    prevStatus.current = agent.status
  }, [agent.status])

  const isRunning  = agent.status === 'running'
  const isComplete = agent.status === 'complete'
  const isFailed   = agent.status === 'failed'

  const filledDots  = Math.min(agent.toolCallCount, MAX_TOOL_DOTS)
  const budgetPct   = Math.min((agent.spentUsdc / agent.budgetUsdc) * 100, 100)

  return (
    <div
      className={`
        relative font-mono cursor-pointer select-none
        transition-opacity duration-300
        ${isNew && !spawned ? 'opacity-0' : ''}
        ${spawned && isNew ? 'node-spawn' : ''}
        ${isFailed ? 'opacity-60' : ''}
      `}
      style={{ minWidth: isMaster ? 200 : 172 }}
    >
      {/* Outer glow ring — only when running */}
      {isRunning && (
        <div
          className="absolute -inset-2 rounded-xl pointer-events-none"
          style={{
            border:    `1px solid ${color}`,
            animation: 'ringPulse 1.8s ease-out infinite',
            color,
          }}
        />
      )}

      {/* Main card */}
      <div
        className={`
          relative overflow-hidden rounded-xl border
          ${isRunning ? 'scan-sweep' : ''}
          ${isRunning ? 'glow-breath' : ''}
        `}
        style={{
          background:  isMaster
            ? `linear-gradient(135deg, #051a24 0%, #0a2535 100%)`
            : `linear-gradient(135deg, #030f17 0%, #051a24 100%)`,
          borderColor: selected ? color : isFailed ? '#ff2d55' : `${color}60`,
          boxShadow:   selected
            ? `0 0 24px ${color}50, inset 0 0 16px ${color}10`
            : isRunning
            ? `0 0 12px ${color}30, inset 0 0 8px ${color}08`
            : isComplete
            ? `0 0 8px ${color}25`
            : 'none',
          '--glow-color': `${color}50`,
        } as React.CSSProperties}
      >
        {/* Top accent bar */}
        <div
          className="h-0.5 w-full"
          style={{
            background: isRunning
              ? `linear-gradient(90deg, transparent, ${color}, transparent)`
              : isComplete
              ? `linear-gradient(90deg, transparent, ${color}80, transparent)`
              : `${color}20`,
          }}
        />

        <div className="px-3 py-2.5">
          {/* Header row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {/* Provider logo */}
              <div
                className="shrink-0"
                style={{ filter: isRunning ? `drop-shadow(0 0 3px ${color})` : 'none' }}
              >
                {ROLE_LOGOS[agent.role] ?? (
                  <span className="text-base leading-none" style={{ color }}>{meta.icon}</span>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color }}>
                  {meta.label}
                </div>
                <div className="text-[8px] text-muted uppercase tracking-widest">
                  {meta.provider || 'OWS'}
                </div>
              </div>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-1.5">
              {isRunning && (
                <span className="text-[9px] text-cyan animate-pulse tracking-widest">
                  LIVE
                </span>
              )}
              {isComplete && showCheck && (
                <span className="text-[11px] text-green check-flash">✓</span>
              )}
              {isComplete && !showCheck && (
                <span className="text-[11px] text-green">✓</span>
              )}
              {isFailed && (
                <span className="text-[11px] text-red">✗</span>
              )}
              <div
                className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
                style={{
                  background: isRunning ? color : isComplete ? '#00ff88' : isFailed ? '#ff2d55' : color,
                  boxShadow:  isRunning ? `0 0 6px ${color}` : 'none',
                }}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="h-px mb-2" style={{ background: `${color}20` }} />

          {/* Task text */}
          <p
            className="text-[9px] leading-relaxed mb-2"
            style={{ color: '#7ab8cc' }}
          >
            {agent.task.length > 55
              ? `${agent.task.slice(0, 55)}…`
              : agent.task}
          </p>

          {/* Tool call dots */}
          {!isMaster && (
            <div className="flex items-center gap-1 mb-2">
              {Array.from({ length: MAX_TOOL_DOTS }).map((_, i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                  style={{
                    background: i < filledDots ? color : `${color}20`,
                    boxShadow:  i < filledDots && isRunning ? `0 0 4px ${color}` : 'none',
                    transform:  i === filledDots - 1 && isRunning ? 'scale(1.4)' : 'scale(1)',
                  }}
                />
              ))}
              {agent.toolCallCount > 0 && (
                <span className="text-[8px] ml-1" style={{ color: `${color}80` }}>
                  {agent.toolCallCount} calls
                </span>
              )}
            </div>
          )}

          {/* Budget bar */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[8px] text-muted uppercase tracking-widest">Budget</span>
              <span className="text-[8px]" style={{ color: budgetPct > 80 ? '#ff2d55' : color }}>
                ${agent.spentUsdc.toFixed(3)}
              </span>
            </div>
            <div className="h-0.5 rounded-full overflow-hidden" style={{ background: `${color}15` }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width:      `${budgetPct}%`,
                  background: budgetPct > 80
                    ? 'linear-gradient(90deg, #ff2d55, #ff6b8a)'
                    : `linear-gradient(90deg, ${color}80, ${color})`,
                  boxShadow:  `0 0 4px ${color}`,
                }}
              />
            </div>
          </div>

          {/* Output preview for complete */}
          {isComplete && agent.output && (
            <div
              className="mt-2 pt-2 border-t text-[8px] leading-relaxed"
              style={{ borderColor: `${color}20`, color: '#5a9ab5' }}
            >
              {agent.output.slice(0, 80)}…
            </div>
          )}
        </div>

        {/* Bottom accent */}
        {isComplete && (
          <div
            className="h-0.5 w-full"
            style={{ background: `linear-gradient(90deg, transparent, #00ff8880, transparent)` }}
          />
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: color, border: 'none', width: 6, height: 6, top: -3,
          boxShadow: `0 0 6px ${color}` }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, border: 'none', width: 6, height: 6, bottom: -3,
          boxShadow: `0 0 6px ${color}` }}
      />
    </div>
  )
})

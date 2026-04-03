'use client'

import { useState }       from 'react'
import { approveSession } from '../../lib/api'
import type { AwaitingApprovalPayload } from '../../types'

interface ApprovalModalProps {
  sessionId: string
  approval:  AwaitingApprovalPayload
  onDone:    () => void
}

export function ApprovalModal({ sessionId, approval, onDone }: ApprovalModalProps) {
  const [loading,  setLoading]  = useState(false)
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)

  async function handle(d: 'approved' | 'rejected') {
    setLoading(true)
    setDecision(d)
    try {
      await approveSession(sessionId, d)
      onDone()
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const isResearch  = approval.phase === 'research'
  const isExecution = approval.phase === 'execution'
  const accentColor = isResearch ? '#00f5ff' : '#ffe600'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
      <div
        className="relative w-full max-w-lg mx-4 rounded-xl border bg-surface p-6 space-y-5 shadow-2xl"
        style={{ borderColor: accentColor, boxShadow: `0 0 40px ${accentColor}30` }}
      >
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: accentColor }}
            />
            <span
              className="text-xs font-bold uppercase tracking-[0.3em]"
              style={{ color: accentColor }}
            >
              {isResearch ? 'Research Complete' : isExecution ? 'Ready to Execute' : 'Approval Required'}
            </span>
          </div>
          <p className="text-muted text-xs">
            {isResearch
              ? 'The swarm has finished its research. Review the proposed yield opportunities and approve to continue planning.'
              : isExecution
              ? 'The execution plan is ready. Review the transaction steps and approve to execute autonomously.'
              : 'Awaiting approval to proceed.'}
          </p>
        </div>

        {/* Summary */}
        <div className="bg-surface2 rounded-lg p-4 border border-border">
          <h4 className="text-muted text-[10px] uppercase tracking-widest mb-2">Summary</h4>
          <p className="text-primary text-xs leading-relaxed whitespace-pre-wrap">
            {approval.summary}
          </p>
        </div>

        {/* Proposals */}
        {approval.proposals.length > 0 && (
          <div>
            <h4 className="text-muted text-[10px] uppercase tracking-widest mb-2">
              {isResearch ? 'Top Yield Opportunities' : 'Transaction Steps'}
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {approval.proposals.map((p, i) => (
                <div key={i} className="bg-surface2 rounded p-3 border border-border text-xs">
                  <pre className="text-primary font-mono text-[10px] whitespace-pre-wrap">
                    {JSON.stringify(p, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => handle('rejected')}
            disabled={loading}
            className="flex-1 py-2.5 border border-red text-red text-xs font-bold rounded-lg
                       hover:bg-red/10 disabled:opacity-30 transition-all"
          >
            {loading && decision === 'rejected' ? 'REJECTING...' : '✕  REJECT'}
          </button>
          <button
            onClick={() => handle('approved')}
            disabled={loading}
            className="flex-1 py-2.5 text-bg text-xs font-bold rounded-lg
                       hover:opacity-90 disabled:opacity-30 transition-all"
            style={{ background: accentColor }}
          >
            {loading && decision === 'approved'
              ? isExecution ? 'EXECUTING...' : 'APPROVING...'
              : isExecution ? '⚡  EXECUTE' : '✓  APPROVE'}
          </button>
        </div>
      </div>
    </div>
  )
}

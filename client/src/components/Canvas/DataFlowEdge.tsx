'use client'

import { memo }       from 'react'
import { getBezierPath, type EdgeProps } from 'reactflow'

interface EdgeData {
  color:     string
  active:    boolean   // true while source agent is running
  complete:  boolean
  payment?:  number    // flash a payment amount
}

export const DataFlowEdge = memo(function DataFlowEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data,
}: EdgeProps<EdgeData>) {
  const color    = data?.color    ?? '#00f5ff'
  const active   = data?.active   ?? false
  const complete = data?.complete ?? false

  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const pathLen = Math.sqrt(
    (targetX - sourceX) ** 2 + (targetY - sourceY) ** 2,
  ) * 1.3  // rough bezier length estimate

  return (
    <g>
      {/* Base dim path */}
      <path
        d={edgePath}
        fill="none"
        stroke={`${color}18`}
        strokeWidth={1.5}
      />

      {/* Active flowing dashes */}
      {active && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="8 12"
          strokeOpacity={0.7}
          className="edge-flow"
          style={{ filter: `drop-shadow(0 0 3px ${color})` }}
        />
      )}

      {/* Complete solid dim line */}
      {!active && complete && (
        <path
          d={edgePath}
          fill="none"
          stroke={`${color}35`}
          strokeWidth={1}
        />
      )}

      {/* Travelling particle — only when active */}
      {active && (
        <>
          <circle r="3" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }}>
            <animateMotion
              dur="1.4s"
              repeatCount="indefinite"
              path={edgePath}
            />
          </circle>
          {/* Trailing particle */}
          <circle r="2" fill={color} opacity="0.4">
            <animateMotion
              dur="1.4s"
              repeatCount="indefinite"
              begin="0.4s"
              path={edgePath}
            />
          </circle>
          <circle r="1.5" fill={color} opacity="0.25">
            <animateMotion
              dur="1.4s"
              repeatCount="indefinite"
              begin="0.8s"
              path={edgePath}
            />
          </circle>
        </>
      )}

      {/* Payment flash label */}
      {data?.payment != null && data.payment > 0 && (
        <text
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2 - 10}
          fill="#00ff88"
          fontSize={9}
          fontFamily="JetBrains Mono"
          textAnchor="middle"
          opacity={0.85}
          style={{ filter: 'drop-shadow(0 0 4px #00ff8880)' }}
        >
          +${data.payment.toFixed(3)}
        </text>
      )}
    </g>
  )
})

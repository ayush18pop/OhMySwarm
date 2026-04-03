'use client'

import React from 'react'

interface Props {
  content: string
  color?:  string   // accent color for headings
}

/**
 * Lightweight inline markdown renderer.
 * No external deps. Handles:
 *   # ## ### #### headings
 *   **bold** *italic*
 *   `inline code`
 *   * / - bullet lists
 *   --- horizontal rules
 *   > blockquote
 *   blank lines → paragraph break
 */
export function MarkdownBlock({ content, color = '#00f5ff' }: Props) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Heading
    const hMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (hMatch) {
      const level = hMatch[1].length
      const text  = hMatch[2]
      const sizes = ['text-sm', 'text-xs', 'text-[11px]', 'text-[10px]']
      const mbs   = ['mb-2 mt-3', 'mb-1.5 mt-2', 'mb-1 mt-2', 'mb-1 mt-1']
      elements.push(
        <div
          key={i}
          className={`font-bold ${sizes[level - 1]} ${mbs[level - 1]} tracking-wide`}
          style={{ color }}
        >
          {inlineRender(text)}
        </div>,
      )
      i++
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <div key={i} className="my-2 h-px" style={{ background: `${color}30` }} />,
      )
      i++
      continue
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)/)
    if (bqMatch) {
      elements.push(
        <div
          key={i}
          className="pl-3 text-[10px] text-muted italic"
          style={{ borderLeft: `2px solid ${color}40` }}
        >
          {inlineRender(bqMatch[1])}
        </div>,
      )
      i++
      continue
    }

    // Bullet list item
    const bulletMatch = line.match(/^[\*\-]\s+(.+)/)
    if (bulletMatch) {
      // Collect consecutive bullet lines
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^[\*\-]\s+/)) {
        items.push(lines[i].replace(/^[\*\-]\s+/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1 pl-3">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-[10px] leading-relaxed text-primary">
              <span style={{ color, flexShrink: 0 }}>·</span>
              <span>{inlineRender(item)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s+(.+)/)
    if (numMatch) {
      const items: Array<{ n: string; text: string }> = []
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        const m = lines[i].match(/^(\d+)\.\s+(.+)/)!
        items.push({ n: m[1], text: m[2] })
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-0.5 my-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-[10px] leading-relaxed text-primary">
              <span className="font-bold shrink-0" style={{ color }}>{item.n}.</span>
              <span>{inlineRender(item.text)}</span>
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // Empty line — small spacer
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />)
      i++
      continue
    }

    // Normal paragraph line
    elements.push(
      <div key={i} className="text-[10px] leading-relaxed text-primary">
        {inlineRender(line)}
      </div>,
    )
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}

// ── Inline renderer (bold, italic, code, emoji-preserve) ─────────────────────

function inlineRender(text: string): React.ReactNode {
  // Split on **bold**, *italic*, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-white">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={i} className="italic text-primary">
          {part.slice(1, -1)}
        </em>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1 py-0 rounded text-[9px] font-mono"
          style={{ background: 'rgba(0,245,255,0.1)', color: '#00f5ff' }}
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

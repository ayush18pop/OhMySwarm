'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag-to-resize hook for a horizontal split panel.
 * Returns the left panel width as a percentage.
 */
export function useResizable(defaultPct = 70, min = 30, max = 85) {
  const [pct, setPct]     = useState(defaultPct)
  const dragging          = useRef(false)
  const containerRef      = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return
      const rect  = containerRef.current.getBoundingClientRect()
      const raw   = ((e.clientX - rect.left) / rect.width) * 100
      setPct(Math.min(max, Math.max(min, raw)))
    }
    function onMouseUp() {
      if (!dragging.current) return
      dragging.current              = false
      document.body.style.cursor    = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [min, max])

  return { pct, containerRef, onMouseDown }
}

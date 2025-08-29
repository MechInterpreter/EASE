import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot, SnapshotNode } from '../types'
import type { GraphNode } from '../lib/graph-types'
import { labelResolver } from '../services/labels/labelResolver'
import type { LabelMode } from '../services/labels/autoInterp'

type VizNode = { id: string; x: number; y: number; r: number; layer: number; type: 'super' | 'logit' }
type VizEdge = { source: string; target: string; w: number }
type ViewRange = { minX: number; minY: number; maxX: number; maxY: number }

const ZOOM_BUTTON_FACTOR = 0.32 // similar to Neuronpedia
const PAD_X_FRAC = 0.04
const PAD_Y_FRAC = 0.10

// Convert SnapshotNode to GraphNode for label resolution
function snapshotNodeToGraphNode(node: SnapshotNode): GraphNode {
  return {
    id: node.id,
    label: node.id, // Default label is the ID
    layer: node.layer || 0,
    size: node.size,
    members: node.members,
    feature_type: 'supernode'
  }
}

function GraphCanvas({ snap }: { snap: Snapshot }) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [view, setView] = useState<ViewRange | null>(null)
  const [boxRect, setBoxRect] = useState<null | { x: number; y: number; w: number; h: number }>(null)

  const { nodes, edges } = useMemo(() => {
    // Lay out supernodes by layer in columns; synthesize logit nodes on the far right.
    const layerOrder = Array.from(new Set(snap.nodes.map(n => (n.layer ?? -1))))
      .sort((a,b)=>a-b)
    const layerIndex = new Map<number, number>()
    layerOrder.forEach((L, i) => layerIndex.set(L, i))

    const perLayerRow: Record<number, number> = {}
    const layerSpacing = 220
    const rowSpacing = 22
    const nmap = new Map<string, VizNode>()

    for (const n of snap.nodes) {
      const L = n.layer ?? -1
      const col = layerIndex.get(L) ?? 0
      const row = perLayerRow[L] ?? 0
      const x = col * layerSpacing
      const y = row * rowSpacing
      const r = Math.max(3, Math.sqrt(n.size))
      nmap.set(n.id, { id: n.id, x, y, r, layer: L, type: 'super' })
      perLayerRow[L] = row + 1
    }

    // Pick top edges to keep viz responsive
    const keptEdges = snap.edges
      .slice()
      .sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight))
      .slice(0, 300)
      .map(e => ({ source: e.source, target: e.target, w: e.weight }))

    // Synthesize logit nodes (targets)
    const logits = Array.from(new Set(keptEdges.map(e => e.target)))
    const logitCol = layerOrder.length // rightmost column
    logits.forEach((lid, i) => {
      if (!nmap.has(lid)) {
        nmap.set(lid, { id: lid, x: logitCol * layerSpacing, y: i * rowSpacing, r: 3, layer: 9999, type: 'logit' })
      }
    })

    const nodes = Array.from(nmap.values())
    return { nodes, edges: keptEdges as VizEdge[] }
  }, [snap])

  // Resize canvas to container
  useEffect(() => {
    const el = containerRef.current
    const cvs = canvasRef.current
    if (!el || !cvs) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      cvs.width = Math.max(1, Math.floor(rect.width * dpr))
      cvs.height = Math.max(1, Math.floor(rect.height * dpr))
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr, nodes.length, edges.length, view])

  // Compute default padded bounds from laid-out nodes
  const dataBounds = useMemo<ViewRange>(() => {
    if (!nodes.length) return { minX: -100, minY: -100, maxX: 100, maxY: 100 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      if (n.x < minX) minX = n.x
      if (n.y < minY) minY = n.y
      if (n.x > maxX) maxX = n.x
      if (n.y > maxY) maxY = n.y
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return { minX: -100, minY: -100, maxX: 100, maxY: 100 }
    }
    const padX = (maxX - minX || 1) * PAD_X_FRAC
    const padY = (maxY - minY || 1) * PAD_Y_FRAC
    return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY }
  }, [nodes])

  // Initialize view once nodes are available
  useEffect(() => {
    setView(prev => prev ?? dataBounds)
  }, [dataBounds])

  const draw = () => {
    const cvs = canvasRef.current
    if (!cvs || !view) return
    const ctx = cvs.getContext('2d')!
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cvs.width, cvs.height)

    const spanX = (view.maxX - view.minX) || 1
    const spanY = (view.maxY - view.minY) || 1
    const scaleX = cvs.width / spanX
    const scaleY = cvs.height / spanY
    const worldToScreen = (x: number, y: number) => ({
      x: (x - view.minX) * scaleX,
      y: (y - view.minY) * scaleY,
    })

    // Edges
    ctx.lineCap = 'round'
    for (const e of edges) {
      const u = nodes.find(n => n.id === e.source)
      const v = nodes.find(n => n.id === e.target)
      if (!u || !v) continue
      const a = worldToScreen(u.x, u.y)
      const b = worldToScreen(v.x, v.y)
      const w = Math.min(6, Math.max(0.5, Math.abs(e.w)))
      const hl = hoverId && (hoverId === u.id || hoverId === v.id)
      ctx.strokeStyle = hl ? 'rgba(59,130,246,0.8)' : 'rgba(0,0,0,0.15)'
      ctx.lineWidth = (w * (hl ? 1.5 : 1)) * dpr
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    // Nodes
    for (const n of nodes) {
      const p = worldToScreen(n.x, n.y)
      const r = Math.max(2, n.r) * dpr
      const isHover = hoverId === n.id
      const fill = n.type === 'logit' ? '#6b7280' : '#2563eb'
      const stroke = isHover ? '#f59e0b' : '#ffffff'
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 2 * dpr
      ctx.strokeStyle = stroke
      ctx.stroke()
    }

    // Labels for hovered node
    if (hoverId) {
      const n = nodes.find(nn => nn.id === hoverId)
      if (n) {
        const p = worldToScreen(n.x, n.y)
        const label = `${n.type === 'logit' ? 'logit' : 'super'} | L${n.layer}`
        ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, -apple-system`
        ctx.fillStyle = 'rgba(17,24,39,0.9)'
        ctx.fillText(label, p.x + 8 * dpr, p.y - 8 * dpr)
      }
    }

    ctx.restore()
  }

  // Initial draw and on state changes
  useEffect(() => { draw() }, [hoverId, view, nodes, edges])

  // Interactions
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs || !view) return
    let dragging = false
    let boxZooming = false
    let lastX = 0, lastY = 0
    let startCssX = 0, startCssY = 0

    function getScalesLocal() {
      const spanX = (view.maxX - view.minX) || 1
      const spanY = (view.maxY - view.minY) || 1
      const scaleX = cvs.width / spanX
      const scaleY = cvs.height / spanY
      return { spanX, spanY, scaleX, scaleY }
    }

    const onMove = (ev: MouseEvent) => {
      if (!cvs) return
      const rect = cvs.getBoundingClientRect()
      const sxCss = (ev.clientX - rect.left)
      const syCss = (ev.clientY - rect.top)
      const sx = sxCss * dpr
      const sy = syCss * dpr
      if (dragging) {
        const { scaleX, scaleY } = getScalesLocal()
        setView(v => {
          if (!v) return v
          const dx = sx - lastX
          const dy = sy - lastY
          const dxW = dx / scaleX
          const dyW = dy / scaleY
          return { minX: v.minX - dxW, maxX: v.maxX - dxW, minY: v.minY - dyW, maxY: v.maxY - dyW }
        })
        lastX = sx; lastY = sy
        return
      }
      if (boxZooming) {
        const x = Math.min(sxCss, startCssX)
        const y = Math.min(syCss, startCssY)
        const w = Math.abs(sxCss - startCssX)
        const h = Math.abs(syCss - startCssY)
        setBoxRect({ x, y, w, h })
        return
      }
      // hover (in screen pixels for stable tolerance)
      const { scaleX, scaleY } = getScalesLocal()
      let hid: string | null = null
      const tolPx = 10 * dpr
      for (const n of nodes) {
        const nx = (n.x - view.minX) * scaleX
        const ny = (n.y - view.minY) * scaleY
        const dpx = Math.hypot(nx - sx, ny - sy)
        if (dpx <= Math.max(tolPx, n.r * dpr)) { hid = n.id; break }
      }
      setHoverId(hid)
    }
    const onDown = (ev: MouseEvent) => {
      const rect = cvs.getBoundingClientRect()
      const sxCss = (ev.clientX - rect.left)
      const syCss = (ev.clientY - rect.top)
      const sx = sxCss * dpr
      const sy = syCss * dpr
      if (ev.shiftKey) {
        boxZooming = true
        startCssX = sxCss; startCssY = syCss
        setBoxRect({ x: sxCss, y: syCss, w: 0, h: 0 })
      } else {
        dragging = true
        lastX = sx; lastY = sy
      }
    }
    const onUp = (ev: MouseEvent) => {
      if (boxZooming) {
        const rect = cvs.getBoundingClientRect()
        const endCssX = (ev.clientX - rect.left)
        const endCssY = (ev.clientY - rect.top)
        const w = Math.abs(endCssX - startCssX)
        const h = Math.abs(endCssY - startCssY)
        if (w > 4 && h > 4) {
          const { scaleX, scaleY } = getScalesLocal()
          const x1c = Math.min(startCssX, endCssX) * dpr
          const y1c = Math.min(startCssY, endCssY) * dpr
          const x2c = Math.max(startCssX, endCssX) * dpr
          const y2c = Math.max(startCssY, endCssY) * dpr
          const minX = view.minX + x1c / scaleX
          const minY = view.minY + y1c / scaleY
          const maxX = view.minX + x2c / scaleX
          const maxY = view.minY + y2c / scaleY
          setView({ minX, minY, maxX, maxY })
        }
      }
      boxZooming = false
      dragging = false
      setBoxRect(null)
    }
    const onWheel = (ev: WheelEvent) => {
      // Gate zoom to Ctrl/Cmd like Neuronpedia, to avoid page scroll conflicts
      if (!(ev.ctrlKey || ev.metaKey)) return
      ev.preventDefault()
      const rect = cvs.getBoundingClientRect()
      const sx = (ev.clientX - rect.left) * dpr
      const sy = (ev.clientY - rect.top) * dpr
      const { scaleX, scaleY } = getScalesLocal()
      const wx = view.minX + sx / scaleX
      const wy = view.minY + sy / scaleY
      const factor = Math.pow(1.001, -ev.deltaY)
      setView(v => {
        if (!v) return v
        const spanX = v.maxX - v.minX
        const spanY = v.maxY - v.minY
        const newSpanX = spanX / factor
        const newSpanY = spanY / factor
        const tx = (wx - v.minX) / spanX
        const ty = (wy - v.minY) / spanY
        const minX = wx - tx * newSpanX
        const maxX = minX + newSpanX
        const minY = wy - ty * newSpanY
        const maxY = minY + newSpanY
        return { minX, minY, maxX, maxY }
      })
    }
    const onDblClick = () => {
      setView(dataBounds)
      setHoverId(null)
      setBoxRect(null)
    }
    cvs.addEventListener('mousemove', onMove)
    cvs.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    cvs.addEventListener('wheel', onWheel, { passive: false })
    cvs.addEventListener('dblclick', onDblClick)
    return () => {
      cvs.removeEventListener('mousemove', onMove)
      cvs.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      cvs.removeEventListener('wheel', onWheel)
      cvs.removeEventListener('dblclick', onDblClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, dpr, view, dataBounds])

  const zoomBy = (coef: number) => {
    if (!view) return
    const cx = (view.minX + view.maxX) / 2
    const cy = (view.minY + view.maxY) / 2
    const spanX = (view.maxX - view.minX) * coef
    const spanY = (view.maxY - view.minY) * coef
    setView({ minX: cx - spanX / 2, maxX: cx + spanX / 2, minY: cy - spanY / 2, maxY: cy + spanY / 2 })
  }

  return (
    <div className="w-full h-[70vh] border rounded relative" ref={containerRef}>
      <canvas ref={canvasRef} className="w-full h-full" />
      <div className="absolute top-2 left-2 text-xs bg-white/80 backdrop-blur px-2 py-1 rounded border">
        Drag to pan • Ctrl/Cmd+Wheel to zoom • Shift+drag box-zoom • Double-click to reset
      </div>
      {boxRect && (
        <div
          className="absolute border-2 border-blue-500/80 bg-blue-200/20 pointer-events-none"
          style={{ left: boxRect.x, top: boxRect.y, width: boxRect.w, height: boxRect.h }}
        />
      )}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white/80 backdrop-blur hover:bg-white transition"
          onClick={() => zoomBy(1 / (1 - ZOOM_BUTTON_FACTOR))}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white/80 backdrop-blur hover:bg-white transition"
          onClick={() => { setView(dataBounds); setHoverId(null) }}
          aria-label="Reset view to default extents"
        >
          Reset
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white/80 backdrop-blur hover:bg-white transition"
          onClick={() => zoomBy(1 - ZOOM_BUTTON_FACTOR)}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  )
}

interface GraphViewProps {
  snap: Snapshot
  labelMode?: LabelMode
}

export default function GraphView({ snap, labelMode = 'autointerp' }: GraphViewProps) {
  if (!snap) {
    return <div className="p-4 text-neutral-500">Run to see the graph snapshot.</div>
  }
  return (
    <div className="p-4 overflow-auto h-full space-y-4">
      <div className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">Nodes: {snap.nodes.length} • Edges: {snap.edges.length}</div>
      <GraphCanvas snap={snap} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="font-semibold mb-2">Groups</div>
          <div className="space-y-1 max-h-[40vh] overflow-auto">
            {snap.nodes.slice(0, 200).map(n => {
              // Convert to GraphNode for label resolution
              const graphNode = snapshotNodeToGraphNode(n)
              const displayLabel = labelResolver.getDisplayLabel(graphNode, labelMode)
              
              return (
                <div key={n.id} className="border rounded p-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium truncate" title={displayLabel}>
                      {displayLabel.length > 20 ? displayLabel.substring(0, 20) + '...' : displayLabel}
                    </span>
                    <span className="text-xs flex-shrink-0 ml-2">L{n.layer}</span>
                  </div>
                  <div className="text-xs text-neutral-500">size {n.size}</div>
                  <div className="text-xs text-neutral-400 line-clamp-2" title={n.members.slice(0, 5).join(', ')}>
                    {n.members.slice(0, 3).join(', ')}{n.members.length > 3 ? ` +${n.members.length - 3} more` : ''}
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">ID: {n.id}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <div className="font-semibold mb-2">Top edges</div>
          <div className="space-y-1 max-h-[40vh] overflow-auto">
            {snap.edges
              .slice()
              .sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight))
              .slice(0, 200)
              .map((e, i) => {
                // Get labels for source and target nodes
                const sourceNode = snap.nodes.find(n => n.id === e.source)
                const targetNode = snap.nodes.find(n => n.id === e.target)
                
                const sourceLabel = sourceNode ? 
                  labelResolver.getDisplayLabel(snapshotNodeToGraphNode(sourceNode), labelMode) : e.source
                const targetLabel = targetNode ? 
                  labelResolver.getDisplayLabel(snapshotNodeToGraphNode(targetNode), labelMode) : e.target
                
                return (
                  <div key={i} className="border rounded p-2 text-sm">
                    <div className="font-medium">
                      <span className="truncate" title={sourceLabel}>
                        {sourceLabel.length > 15 ? sourceLabel.substring(0, 15) + '...' : sourceLabel}
                      </span>
                      <span className="mx-2">→</span>
                      <span className="truncate" title={targetLabel}>
                        {targetLabel.length > 15 ? targetLabel.substring(0, 15) + '...' : targetLabel}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500">w={e.weight.toFixed(3)}</div>
                    <div className="text-xs text-neutral-400">{e.source} → {e.target}</div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}

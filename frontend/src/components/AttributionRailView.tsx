// Attribution Rail View - Neuronpedia-style token/layer visualization
import React, { useEffect, useRef, useState, useCallback } from 'react'
import d3 from '../lib/d3-jetpack'
import type { GraphNode, GraphLink } from '../lib/graph-types'
import type { NeuronpediaJSON, TokenLane, LayerGroup } from '../lib/neuronpedia-parser'
import { parseNeuronpediaJSON, generateAutoInterpLabel } from '../lib/neuronpedia-parser'

interface AttributionRailViewProps {
  data: NeuronpediaJSON
  onNodeHover?: (node: GraphNode | null) => void
  onNodeClick?: (node: GraphNode | null) => void
  onPathHighlight?: (path: GraphNode[]) => void
  edgeOpacityThreshold?: number
  showLabels?: boolean
  darkMode?: boolean
}

const RAIL_CONFIG = {
  tokenWidth: 120,
  layerHeight: 80,
  nodeRadius: 8,
  margin: { top: 40, right: 40, bottom: 40, left: 120 },
  pathHighlightOpacity: 0.8,
  baseEdgeOpacity: 0.2
}

export default function AttributionRailView({
  data,
  onNodeHover,
  onNodeClick,
  onPathHighlight,
  edgeOpacityThreshold = 0.1,
  showLabels = true,
  darkMode = false
}: AttributionRailViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [clickedNode, setClickedNode] = useState<GraphNode | null>(null)
  const [highlightedPath, setHighlightedPath] = useState<GraphNode[]>([])
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null)

  // Parse Neuronpedia data
  const { nodes, links, tokenLanes, layerGroups, metadata } = React.useMemo(() => {
    return parseNeuronpediaJSON(data)
  }, [data])

  // Filter links by threshold
  const filteredLinks = React.useMemo(() => {
    return links.filter(link => Math.abs(link.weight) >= edgeOpacityThreshold)
  }, [links, edgeOpacityThreshold])

  // Calculate dimensions
  const width = tokenLanes.length * RAIL_CONFIG.tokenWidth + RAIL_CONFIG.margin.left + RAIL_CONFIG.margin.right
  const height = layerGroups.length * RAIL_CONFIG.layerHeight + RAIL_CONFIG.margin.top + RAIL_CONFIG.margin.bottom

  // Setup canvas for edge rendering
  const setupCanvas = useCallback(() => {
    if (!canvasRef.current || !containerRef.current) return

    const canvas = canvasRef.current
    const rect = containerRef.current.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.translate(RAIL_CONFIG.margin.left, RAIL_CONFIG.margin.top)
    }
  }, [width, height])

  // Draw edges on canvas
  const drawEdges = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(-RAIL_CONFIG.margin.left, -RAIL_CONFIG.margin.top, width, height)

    // Draw all edges with low opacity
    ctx.globalAlpha = RAIL_CONFIG.baseEdgeOpacity
    filteredLinks.forEach(link => {
      if (!link.sourceNode?.pos || !link.targetNode?.pos) return

      ctx.beginPath()
      ctx.moveTo(link.sourceNode.pos[0], link.sourceNode.pos[1])
      ctx.lineTo(link.targetNode.pos[0], link.targetNode.pos[1])
      ctx.strokeStyle = link.color || '#666'
      ctx.lineWidth = link.strokeWidth || 1
      ctx.stroke()
    })

    // Draw highlighted path with high opacity
    if (highlightedPath.length > 1) {
      ctx.globalAlpha = RAIL_CONFIG.pathHighlightOpacity
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 3

      for (let i = 0; i < highlightedPath.length - 1; i++) {
        const source = highlightedPath[i]
        const target = highlightedPath[i + 1]
        
        if (source.pos && target.pos) {
          ctx.beginPath()
          ctx.moveTo(source.pos[0], source.pos[1])
          ctx.lineTo(target.pos[0], target.pos[1])
          ctx.stroke()
        }
      }
    }

    ctx.globalAlpha = 1
  }, [filteredLinks, highlightedPath, width, height])

  // Find path from token to logit
  const findPath = useCallback((startNode: GraphNode): GraphNode[] => {
    const visited = new Set<string>()
    const path: GraphNode[] = []

    function dfs(node: GraphNode): boolean {
      if (visited.has(node.id)) return false
      visited.add(node.id)
      path.push(node)

      // If this is a logit node, we found a complete path
      if (node.isTargetLogit || node.feature_type === 'logit') {
        return true
      }

      // Try to continue path through strongest outgoing edge
      const outgoingLinks = node.targetLinks?.filter(link => 
        Math.abs(link.weight) >= edgeOpacityThreshold
      ).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)) || []

      for (const link of outgoingLinks) {
        if (link.targetNode && dfs(link.targetNode)) {
          return true
        }
      }

      path.pop()
      return false
    }

    dfs(startNode)
    return path
  }, [edgeOpacityThreshold])

  // Initialize visualization
  useEffect(() => {
    if (!svgRef.current || !nodes.length) return

    setupCanvas()

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')
      .attr('transform', `translate(${RAIL_CONFIG.margin.left},${RAIL_CONFIG.margin.top})`)

    // Draw token lane headers
    const tokenHeaders = g.selectAll('.token-header')
      .data(tokenLanes)
      .join('g')
      .attr('class', 'token-header')
      .attr('transform', d => `translate(${d.position * RAIL_CONFIG.tokenWidth}, -20)`)

    tokenHeaders.append('text')
      .attr('x', RAIL_CONFIG.tokenWidth / 2)
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .attr('fill', darkMode ? '#e5e7eb' : '#374151')
      .text(d => d.token.length > 8 ? d.token.substring(0, 8) + '...' : d.token)

    // Draw layer labels
    const layerLabels = g.selectAll('.layer-label')
      .data(layerGroups)
      .join('text')
      .attr('class', 'layer-label')
      .attr('x', -10)
      .attr('y', d => d.yPosition + RAIL_CONFIG.layerHeight / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', darkMode ? '#9ca3af' : '#6b7280')
      .text(d => `L${d.layer}`)

    // Draw nodes
    const nodeElements = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x}, ${d.y})`)
      .style('cursor', 'pointer')

    nodeElements.append('circle')
      .attr('r', d => RAIL_CONFIG.nodeRadius + Math.log(d.size || 1))
      .attr('fill', d => d.nodeColor || '#6b7280')
      .attr('stroke', darkMode ? '#374151' : '#ffffff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.8)

    // Add node labels if enabled
    if (showLabels) {
      nodeElements.append('text')
        .attr('x', RAIL_CONFIG.nodeRadius + 5)
        .attr('y', 0)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '10px')
        .attr('fill', darkMode ? '#e5e7eb' : '#374151')
        .text(d => {
          const label = d.ppClerp || d.clerp || generateAutoInterpLabel(d)
          return label.length > 15 ? label.substring(0, 15) + '...' : label
        })
    }

    // Add interaction handlers
    nodeElements
      .on('mouseenter', (event, d) => {
        setHoveredNode(d)
        onNodeHover?.(d)
        
        // Find and highlight path
        const path = findPath(d)
        setHighlightedPath(path)
        onPathHighlight?.(path)
        
        const rect = containerRef.current!.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top - 10,
          content: makeTooltipContent(d)
        })
      })
      .on('mouseleave', () => {
        setHoveredNode(null)
        setHighlightedPath([])
        onNodeHover?.(null)
        onPathHighlight?.([])
        setTooltip(null)
      })
      .on('click', (event, d) => {
        const newClickedNode = clickedNode === d ? null : d
        setClickedNode(newClickedNode)
        onNodeClick?.(newClickedNode)
      })

    drawEdges()
  }, [nodes, layerGroups, tokenLanes, width, height, showLabels, darkMode, setupCanvas, drawEdges, findPath, onNodeHover, onNodeClick, onPathHighlight, clickedNode])

  // Redraw edges when highlight changes
  useEffect(() => {
    drawEdges()
  }, [drawEdges, highlightedPath])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-auto">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ zIndex: 1 }}
      />
      <svg
        ref={svgRef}
        className="absolute inset-0"
        style={{ zIndex: 2 }}
      />
      
      {tooltip && (
        <div
          className={`absolute text-xs p-3 rounded-lg shadow-lg pointer-events-none z-20 max-w-xs ${
            darkMode 
              ? 'bg-gray-800 text-white border border-gray-600' 
              : 'bg-white text-gray-900 border border-gray-200'
          }`}
          style={{ left: tooltip.x, top: tooltip.y }}
          dangerouslySetInnerHTML={{ __html: tooltip.content }}
        />
      )}

      {/* Legend */}
      <div className={`absolute top-4 right-4 p-3 rounded-lg text-xs z-10 ${
        darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
      } shadow-lg border ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
        <div className="font-semibold mb-2">Attribution Rail</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            <span>Transcoder</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span>Attention</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <span>MLP</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span>Logit</span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-300">
          <div className="text-xs text-gray-600">
            Hover: Highlight path<br/>
            Click: Select node
          </div>
        </div>
      </div>
    </div>
  )
}

function makeTooltipContent(node: GraphNode): string {
  const parts = [
    `<strong>${node.ppClerp || node.clerp || node.label}</strong>`,
    `Layer: ${node.layer}`,
    `Feature: ${node.featureId}`,
    `Type: ${node.feature_type}`,
    node.activation !== undefined ? `Activation: ${node.activation.toFixed(3)}` : null,
    node.influence !== undefined ? `Influence: ${node.influence.toFixed(3)}` : null,
    node.tokenProb !== undefined ? `Token Prob: ${node.tokenProb.toFixed(3)}` : null
  ].filter(Boolean)
  
  return parts.join('<br>')
}

// Supernode Cluster View - Force layout with expand/collapse and member inspection
import React, { useEffect, useRef, useState, useCallback } from 'react'
import d3 from '../lib/d3-jetpack'
import type { GraphNode, GraphLink, ForceNode } from '../lib/graph-types'
import { forceContainer, drawLinks } from '../lib/graph-utils'

interface SupernodeClusterViewProps {
  data: any // Supernode data
  onNodeHover?: (node: GraphNode | null) => void
  onNodeClick?: (node: GraphNode | null) => void
  onNeighborhoodIsolate?: (node: GraphNode, hops: number) => void
  edgeOpacityThreshold?: number
  neighborsN?: number
  showLabels?: boolean
  darkMode?: boolean
}

interface SupernodeData {
  id: string
  size: number
  layer: number
  members: string[]
  expanded: boolean
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
  pinned?: boolean
}

const CLUSTER_CONFIG = {
  nodeMinRadius: 8,
  nodeMaxRadius: 40,
  memberRadius: 4,
  expandedSpacing: 60,
  margin: { top: 40, right: 40, bottom: 40, left: 40 }
}

export default function SupernodeClusterView({
  data,
  onNodeHover,
  onNodeClick,
  onNeighborhoodIsolate,
  edgeOpacityThreshold = 0.1,
  neighborsN = 2,
  showLabels = true,
  darkMode = false
}: SupernodeClusterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simulationRef = useRef<d3.Simulation<ForceNode, undefined> | null>(null)
  
  const [supernodes, setSupernodes] = useState<SupernodeData[]>([])
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [clickedNode, setClickedNode] = useState<GraphNode | null>(null)
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set())
  const [isolatedNeighborhood, setIsolatedNeighborhood] = useState<Set<string>>(new Set())
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null)

  // Parse supernode data
  const { nodes, links } = React.useMemo(() => {
    if (!data?.nodes) return { nodes: [], links: [] }

    const nodes: GraphNode[] = data.nodes.map((sn: any, i: number) => ({
      id: sn.id,
      label: sn.id,
      layer: sn.layer || 0,
      size: sn.size,
      members: sn.members || [],
      isSuperNode: true,
      expanded: false,
      pinned: false,
      nodeColor: getLayerColor(sn.layer || 0),
      sourceLinks: [],
      targetLinks: [],
      x: Math.random() * 400,
      y: Math.random() * 400
    }))

    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const links: GraphLink[] = (data.edges || []).map((edge: any) => {
      const sourceNode = nodeMap.get(edge.source)
      const targetNode = nodeMap.get(edge.target)
      
      if (!sourceNode || !targetNode) return null

      const link: GraphLink = {
        source: edge.source,
        target: edge.target,
        sourceNode,
        targetNode,
        weight: edge.weight,
        absWeight: Math.abs(edge.weight),
        color: getWeightColor(edge.weight),
        strokeWidth: Math.max(1, Math.abs(edge.weight) * 5)
      }

      sourceNode.targetLinks?.push(link)
      targetNode.sourceLinks?.push(link)
      
      return link
    }).filter(Boolean)

    return { nodes, links }
  }, [data])

  // Filter links and nodes based on isolation
  const { visibleNodes, visibleLinks } = React.useMemo(() => {
    let visibleNodes = nodes
    let visibleLinks = links.filter(link => Math.abs(link.weight) >= edgeOpacityThreshold)

    if (isolatedNeighborhood.size > 0) {
      visibleNodes = nodes.filter(node => isolatedNeighborhood.has(node.id))
      visibleLinks = visibleLinks.filter(link => 
        isolatedNeighborhood.has(link.source as string) && 
        isolatedNeighborhood.has(link.target as string)
      )
    }

    return { visibleNodes, visibleLinks }
  }, [nodes, links, edgeOpacityThreshold, isolatedNeighborhood])

  // Setup canvas
  const setupCanvas = useCallback(() => {
    if (!canvasRef.current || !containerRef.current) return

    const canvas = canvasRef.current
    const rect = containerRef.current.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
    }
  }, [])

  // Draw edges
  const drawEdges = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)

    drawLinks(ctx, visibleLinks, {
      width: rect.width,
      height: rect.height,
      margin: CLUSTER_CONFIG.margin,
      nodeWidth: 0,
      nodeHeight: 0,
      edgeOpacityThreshold,
      layout: 'force'
    }, { opacity: 0.6 })
  }, [visibleLinks, edgeOpacityThreshold])

  // Expand/collapse supernode
  const toggleExpansion = useCallback((nodeId: string) => {
    setSupernodes(prev => prev.map(sn => 
      sn.id === nodeId ? { ...sn, expanded: !sn.expanded } : sn
    ))
  }, [])

  // Pin/unpin node
  const togglePin = useCallback((nodeId: string) => {
    setPinnedNodes(prev => {
      const newSet = new Set(prev)
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId)
      } else {
        newSet.add(nodeId)
      }
      return newSet
    })
  }, [])

  // Isolate neighborhood
  const isolateNeighborhood = useCallback((centerNode: GraphNode, hops: number) => {
    const neighborhood = new Set<string>([centerNode.id])
    const queue = [{ node: centerNode, depth: 0 }]
    const visited = new Set<string>([centerNode.id])

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!
      
      if (depth >= hops) continue

      // Add connected nodes
      const connectedLinks = [...(node.sourceLinks || []), ...(node.targetLinks || [])]
      for (const link of connectedLinks) {
        const connectedNode = link.sourceNode === node ? link.targetNode : link.sourceNode
        if (connectedNode && !visited.has(connectedNode.id)) {
          visited.add(connectedNode.id)
          neighborhood.add(connectedNode.id)
          queue.push({ node: connectedNode, depth: depth + 1 })
        }
      }
    }

    setIsolatedNeighborhood(neighborhood)
    onNeighborhoodIsolate?.(centerNode, hops)
  }, [onNeighborhoodIsolate])

  // Initialize force simulation
  useEffect(() => {
    if (!svgRef.current || !visibleNodes.length) return

    setupCanvas()

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const rect = containerRef.current!.getBoundingClientRect()
    const width = rect.width - CLUSTER_CONFIG.margin.left - CLUSTER_CONFIG.margin.right
    const height = rect.height - CLUSTER_CONFIG.margin.top - CLUSTER_CONFIG.margin.bottom

    svg.attr('width', rect.width).attr('height', rect.height)

    const g = svg.append('g')
      .attr('transform', `translate(${CLUSTER_CONFIG.margin.left},${CLUSTER_CONFIG.margin.top})`)

    // Create force nodes
    const forceNodes: ForceNode[] = visibleNodes.map(node => ({
      ...node,
      x: node.x || Math.random() * width,
      y: node.y || Math.random() * height,
      fx: pinnedNodes.has(node.id) ? node.x : null,
      fy: pinnedNodes.has(node.id) ? node.y : null
    }))

    // Create force simulation
    const simulation = d3.forceSimulation(forceNodes)
      .force('link', d3.forceLink(visibleLinks).id((d: any) => d.id).strength(0.1))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collide', d3.forceCollide((d: any) => getNodeRadius(d) + 10))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('container', forceContainer([[0, 0], [width, height]]))

    simulationRef.current = simulation

    // Create node groups
    const nodeGroups = g.selectAll('.node-group')
      .data(forceNodes)
      .join('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')

    // Main supernode circles
    nodeGroups.append('circle')
      .attr('class', 'main-node')
      .attr('r', d => getNodeRadius(d))
      .attr('fill', d => d.nodeColor || '#6b7280')
      .attr('stroke', d => pinnedNodes.has(d.id) ? '#fbbf24' : (darkMode ? '#374151' : '#ffffff'))
      .attr('stroke-width', d => pinnedNodes.has(d.id) ? 3 : 2)
      .attr('opacity', 0.8)

    // Member count indicators
    nodeGroups.append('text')
      .attr('class', 'member-count')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('fill', 'white')
      .text(d => d.members?.length || 0)

    // Labels
    if (showLabels) {
      nodeGroups.append('text')
        .attr('class', 'node-label')
        .attr('x', 0)
        .attr('y', d => getNodeRadius(d) + 15)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .attr('fill', darkMode ? '#e5e7eb' : '#374151')
        .text(d => d.label.length > 12 ? d.label.substring(0, 12) + '...' : d.label)
    }

    // Interaction handlers
    nodeGroups
      .on('mouseenter', (event, d) => {
        setHoveredNode(d)
        onNodeHover?.(d)
        
        const rect = containerRef.current!.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top - 10,
          content: makeSupernodeTooltip(d)
        })
      })
      .on('mouseleave', () => {
        setHoveredNode(null)
        onNodeHover?.(null)
        setTooltip(null)
      })
      .on('click', (event, d) => {
        event.stopPropagation()
        setClickedNode(d)
        onNodeClick?.(d)
      })
      .on('dblclick', (event, d) => {
        event.stopPropagation()
        toggleExpansion(d.id)
      })
      .on('contextmenu', (event, d) => {
        event.preventDefault()
        togglePin(d.id)
      })

    // Drag behavior
    const drag = d3.drag<SVGGElement, ForceNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        if (!pinnedNodes.has(d.id)) {
          d.fx = null
          d.fy = null
        }
      })

    nodeGroups.call(drag)

    // Update positions on tick
    simulation.on('tick', () => {
      nodeGroups.attr('transform', d => {
        d.pos = [d.x || 0, d.y || 0]
        return `translate(${d.x},${d.y})`
      })
      drawEdges()
    })

    return () => {
      simulation.stop()
    }
  }, [visibleNodes, visibleLinks, pinnedNodes, showLabels, darkMode, setupCanvas, drawEdges, toggleExpansion, togglePin, onNodeHover, onNodeClick])

  // Clear isolation
  const clearIsolation = useCallback(() => {
    setIsolatedNeighborhood(new Set())
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full">
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

      {/* Controls */}
      <div className={`absolute top-4 left-4 p-3 rounded-lg text-xs z-10 ${
        darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
      } shadow-lg border ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
        <div className="font-semibold mb-2">Supernode Clusters</div>
        <div className="space-y-1 text-xs">
          <div>• Double-click: Expand/collapse</div>
          <div>• Right-click: Pin/unpin</div>
          <div>• Ctrl+click: Isolate {neighborsN}-hop neighborhood</div>
        </div>
        {isolatedNeighborhood.size > 0 && (
          <button
            onClick={clearIsolation}
            className="mt-2 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Clear Isolation
          </button>
        )}
      </div>

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
    </div>
  )
}

function getNodeRadius(node: GraphNode): number {
  const size = node.size || 1
  return Math.max(
    CLUSTER_CONFIG.nodeMinRadius,
    Math.min(CLUSTER_CONFIG.nodeMaxRadius, Math.sqrt(size) * 3)
  )
}

function getLayerColor(layer: number): string {
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']
  return colors[layer % colors.length]
}

function getWeightColor(weight: number): string {
  const absWeight = Math.abs(weight)
  if (weight > 0) {
    return `rgba(34, 197, 94, ${Math.min(absWeight, 1)})`
  } else {
    return `rgba(239, 68, 68, ${Math.min(absWeight, 1)})`
  }
}

function makeSupernodeTooltip(node: GraphNode): string {
  const parts = [
    `<strong>${node.label}</strong>`,
    `Layer: ${node.layer}`,
    `Size: ${node.size}`,
    `Members: ${node.members?.length || 0}`,
    node.members?.length ? `<div class="mt-1 text-xs text-gray-500">Members: ${node.members.slice(0, 5).join(', ')}${node.members.length > 5 ? '...' : ''}</div>` : null
  ].filter(Boolean)
  
  return parts.join('<br>')
}

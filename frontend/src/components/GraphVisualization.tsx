import React, { useEffect, useRef, useState, useCallback } from 'react'
import d3 from '../lib/d3-jetpack'
import type { 
  GraphNode, 
  GraphLink, 
  GraphConfig, 
  ForceNode, 
  VisualizationType,
  NeuronpediaData,
  SupernodeData 
} from '../lib/graph-types'
import { 
  forceContainer, 
  parseNeuronpediaData, 
  parseSupernodeData, 
  filterLinksByOpacity,
  getNodeLabel,
  makeTooltipContent,
  drawLinks,
  calculateLuminance
} from '../lib/graph-utils'

interface GraphVisualizationProps {
  data: NeuronpediaData | SupernodeData | null
  type: VisualizationType
  config: GraphConfig
  onNodeHover?: (node: GraphNode | null) => void
  onNodeClick?: (node: GraphNode | null) => void
}

const NODE_WIDTH = 75
const NODE_HEIGHT = 25
const CANVAS_LAYERS = 5 // all, bg, hovered, clicked, pinned

export default function GraphVisualization({ 
  data, 
  type, 
  config, 
  onNodeHover, 
  onNodeClick 
}: GraphVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>(Array(CANVAS_LAYERS).fill(null))
  const simulationRef = useRef<d3.Simulation<ForceNode, undefined> | null>(null)
  
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [clickedNode, setClickedNode] = useState<GraphNode | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null)

  // Parse data based on type
  const { nodes, links } = React.useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    
    if (type === 'attribution') {
      return parseNeuronpediaData(data as NeuronpediaData)
    } else {
      return parseSupernodeData(data as SupernodeData)
    }
  }, [data, type])

  // Filter links by opacity threshold
  const filteredLinks = React.useMemo(() => {
    return filterLinksByOpacity(links, config.edgeOpacityThreshold)
  }, [links, config.edgeOpacityThreshold])

  // Setup canvas layers
  const setupCanvasLayers = useCallback(() => {
    if (!containerRef.current) return

    const container = d3.select(containerRef.current)
    const rect = containerRef.current.getBoundingClientRect()
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    
    // Clear existing canvases
    container.selectAll('canvas').remove()
    
    // Create canvas layers
    for (let i = 0; i < CANVAS_LAYERS; i++) {
      const canvas = container
        .append('canvas')
        // Render size in device pixels
        .attr('width', Math.floor(rect.width * dpr))
        .attr('height', Math.floor(rect.height * dpr))
        .style('position', 'absolute')
        .style('top', '0px')
        .style('left', '0px')
        // CSS size in CSS pixels
        .style('width', `${rect.width}px`)
        .style('height', `${rect.height}px`)
        .style('pointer-events', 'none')
        .node() as HTMLCanvasElement
        
      canvasRefs.current[i] = canvas
      
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Scale for high-DPI displays, then translate margins
        ctx.scale(dpr, dpr)
        ctx.translate(config.margin.left, config.margin.top)
      }
    }
  }, [config.margin])

  // Clear all canvas layers
  const clearCanvasLayers = useCallback(() => {
    canvasRefs.current.forEach(canvas => {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.restore()
        }
      }
    })
  }, [])

  // Draw all links on appropriate canvas layers
  const drawAllLinks = useCallback(() => {
    if (!filteredLinks.length) return

    const allLinksCtx = canvasRefs.current[0]?.getContext('2d')
    const hoveredLinksCtx = canvasRefs.current[2]?.getContext('2d')
    const clickedLinksCtx = canvasRefs.current[3]?.getContext('2d')

    clearCanvasLayers()

    // Draw all links
    if (allLinksCtx) {
      drawLinks(allLinksCtx, filteredLinks, config, { opacity: 0.3 })
    }

    // Draw hovered links
    if (hoveredNode && hoveredLinksCtx) {
      const hoveredLinks = filteredLinks.filter(link => {
        const src = typeof link.source === 'object' ? (link.source as any) : link.sourceNode
        const tgt = typeof link.target === 'object' ? (link.target as any) : link.targetNode
        return src === hoveredNode || tgt === hoveredNode
      })
      drawLinks(hoveredLinksCtx, hoveredLinks, config, { opacity: 0.8 })
    }

    // Draw clicked links
    if (clickedNode && clickedLinksCtx) {
      const clickedLinks = filteredLinks.filter(link => {
        const src = typeof link.source === 'object' ? (link.source as any) : link.sourceNode
        const tgt = typeof link.target === 'object' ? (link.target as any) : link.targetNode
        return src === clickedNode || tgt === clickedNode
      })
      drawLinks(clickedLinksCtx, clickedLinks, config, { opacity: 1.0 })
    }
  }, [filteredLinks, hoveredNode, clickedNode, config, clearCanvasLayers])

  // Initialize visualization
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !nodes.length) return

    setupCanvasLayers()

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const rect = containerRef.current.getBoundingClientRect()
    const width = rect.width - config.margin.left - config.margin.right
    const height = rect.height - config.margin.top - config.margin.bottom

    // Ensure SVG has explicit size to match container
    svg
      .attr('width', rect.width)
      .attr('height', rect.height)

    const g = svg.append('g')
      .attr('transform', `translate(${config.margin.left},${config.margin.top})`)

    // Create force nodes
    const forceNodes: ForceNode[] = nodes.map((node, i) => ({
      ...node,
      x: config.layout === 'layered' 
        ? (node.layer || 0) * (width / Math.max(1, d3.max(nodes, d => d.layer || 0) || 1))
        : Math.random() * width,
      y: config.layout === 'layered'
        ? (node.streamIdx || 0) * (height / Math.max(1, d3.max(nodes, d => d.streamIdx || 0) || 1))
        : Math.random() * height,
      fx: null,
      fy: null
    }))

    // Update node positions for canvas rendering
    forceNodes.forEach(node => {
      node.pos = [node.x || 0, node.y || 0]
    })

    // Create force simulation
    const simulation = d3.forceSimulation(forceNodes)
      .force('link', d3.forceLink(filteredLinks).id((d: any) => d.id).strength(0.1))
      .force('charge', d3.forceManyBody().strength(-100))
      .force('collide', d3.forceCollide(Math.max(NODE_WIDTH, NODE_HEIGHT) / 2 + 5))
      .force('container', forceContainer([
        [0, 0],
        [width - NODE_WIDTH, height - NODE_HEIGHT]
      ]))

    if (config.layout === 'layered') {
      simulation
        .force('x', d3.forceX((d: ForceNode) => 
          (d.layer || 0) * (width / Math.max(1, d3.max(nodes, n => n.layer || 0) || 1))
        ).strength(0.3))
        .force('y', d3.forceY((d: ForceNode) => 
          (d.streamIdx || 0) * (height / Math.max(1, d3.max(nodes, n => n.streamIdx || 0) || 1))
        ).strength(0.1))
    }

    simulationRef.current = simulation

    // Create node elements
    const nodeElements = g.selectAll('.node')
      .data(forceNodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')

    // Add node rectangles
    nodeElements.append('rect')
      .attr('width', NODE_WIDTH)
      .attr('height', NODE_HEIGHT)
      .attr('rx', 4)
      .attr('fill', d => d.isSuperNode ? '#3b82f6' : '#6b7280')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1)

    // Add node labels
    nodeElements.append('text')
      .attr('x', NODE_WIDTH / 2)
      .attr('y', NODE_HEIGHT / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-sans-serif, system-ui')
      .text(d => {
        const label = getNodeLabel(d)
        return label.length > 10 ? label.substring(0, 10) + '...' : label
      })

    // Add interaction handlers
    nodeElements
      .on('mouseenter', (event, d) => {
        setHoveredNode(d)
        onNodeHover?.(d)
        
        const rect = containerRef.current!.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top - 10,
          content: makeTooltipContent(d)
        })
      })
      .on('mouseleave', () => {
        setHoveredNode(null)
        onNodeHover?.(null)
        setTooltip(null)
      })
      .on('click', (event, d) => {
        const newClickedNode = clickedNode === d ? null : d
        setClickedNode(newClickedNode)
        onNodeClick?.(newClickedNode)
      })

    // Add drag behavior
    const drag = d3.drag<SVGGElement, ForceNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
        d.x = event.x
        d.y = event.y
        d.pos = [d.x, d.y]
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })

    nodeElements.call(drag)

    // Update positions on simulation tick
    simulation.on('tick', () => {
      nodeElements.attr('transform', d => {
        d.pos = [d.x || 0, d.y || 0]
        return `translate(${d.x},${d.y})`
      })
      drawAllLinks()
    })

    return () => {
      simulation.stop()
    }
  }, [nodes, filteredLinks, config, setupCanvasLayers, drawAllLinks, onNodeHover, onNodeClick])

  // Redraw links when hover/click state changes
  useEffect(() => {
    drawAllLinks()
  }, [hoveredNode, clickedNode, drawAllLinks])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 10 }}
      />
      
      {tooltip && (
        <div
          className="absolute bg-gray-900 text-white text-xs p-2 rounded shadow-lg pointer-events-none z-20"
          style={{ left: tooltip.x, top: tooltip.y }}
          dangerouslySetInnerHTML={{ __html: tooltip.content }}
        />
      )}
    </div>
  )
}

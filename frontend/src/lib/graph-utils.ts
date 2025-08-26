// Graph utilities adapted from Neuronpedia patterns

import d3 from './d3-jetpack'
import type { GraphNode, GraphLink, NeuronpediaData, SupernodeData, GraphConfig } from './graph-types'

// Color scales and styling
export const pctInputColorFn = (d: number) => {
  const linearScale = d3.scaleLinear().domain([-0.4, 0.4])
  const linearTScale = d3
    .scaleLinear()
    .domain([0, 0.5, 0.5, 1])
    .range([0, 0.5 - 0.001, 0.5 + 0.001, 1])
  return d3.interpolatePRGn(linearTScale(linearScale(d)))
}

export const widthScale = d3.scaleSqrt().domain([0, 1]).range([0.5, 6])

// Calculate luminance for color adjustments
export function calculateLuminance(color: string): number {
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!rgbMatch) return 1
  const r = parseInt(rgbMatch[1], 10)
  const g = parseInt(rgbMatch[2], 10)
  const b = parseInt(rgbMatch[3], 10)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

// Custom force to keep nodes within bounds
export function forceContainer(bbox: [[number, number], [number, number]]) {
  let nodes: any[]

  function force(alpha: number) {
    let i
    const n = nodes.length
    let node
    let x = 0
    let y = 0

    for (i = 0; i < n; i += 1) {
      node = nodes[i]
      x = node.x
      y = node.y

      if (x < bbox[0][0]) node.vx += (bbox[0][0] - x) * alpha
      if (y < bbox[0][1]) node.vy += (bbox[0][1] - y) * alpha
      if (x > bbox[1][0]) node.vx += (bbox[1][0] - x) * alpha
      if (y > bbox[1][1]) node.vy += (bbox[1][1] - y) * alpha
    }
  }

  force.initialize = function (_: any[]) {
    nodes = _
  }

  return force
}

// Convert Neuronpedia JSON to graph format
export function parseNeuronpediaData(data: NeuronpediaData): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = data.nodes.map((n, i) => ({
    id: `${n.layer}_${n.feature}`,
    featureId: `${n.layer}_${n.feature}`,
    nodeId: `${n.layer}_${n.feature}`,
    label: n.label || n.explanations?.[0] || `L${n.layer}F${n.feature}`,
    layer: n.layer,
    ctx_idx: i, // Use index as context position
    streamIdx: n.layer,
    size: n.activations?.reduce((a, b) => a + Math.abs(b), 0) || 1,
    feature_type: n.feature_type,
    ppClerp: n.label || n.explanations?.[0] || `L${n.layer}F${n.feature}`,
    clerp: n.label || `L${n.layer}F${n.feature}`,
    nodeColor: '#ffffff',
    sourceLinks: [],
    targetLinks: []
  }))

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const links: GraphLink[] = data.edges.map(e => {
    const sourceNode = nodeMap.get(`${Math.floor(e.source)}_${e.source % 1000}`) || nodes[e.source] || nodes[0]
    const targetNode = nodeMap.get(`${Math.floor(e.target)}_${e.target % 1000}`) || nodes[e.target] || nodes[0]
    
    const link: GraphLink = {
      source: sourceNode.id,
      target: targetNode.id,
      sourceNode,
      targetNode,
      weight: e.weight,
      absWeight: Math.abs(e.weight),
      pctInput: e.weight,
      color: pctInputColorFn(e.weight),
      pctInputColor: pctInputColorFn(e.weight),
      strokeWidth: widthScale(Math.abs(e.weight))
    }

    sourceNode.targetLinks?.push(link)
    targetNode.sourceLinks?.push(link)
    
    return link
  })

  return { nodes, links }
}

// Convert EASE supernode data to graph format
export function parseSupernodeData(data: SupernodeData): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = data.nodes.map((n, i) => ({
    id: n.id,
    featureId: n.id,
    nodeId: n.id,
    label: n.id,
    layer: n.layer || 0,
    ctx_idx: i,
    streamIdx: n.layer || 0,
    size: n.size,
    members: n.members,
    memberNodeIds: n.members,
    isSuperNode: n.members.length > 1,
    ppClerp: n.id,
    clerp: n.id,
    nodeColor: '#ffffff',
    sourceLinks: [],
    targetLinks: []
  }))

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const links: GraphLink[] = data.edges.map(e => {
    const sourceNode = nodeMap.get(e.source)!
    const targetNode = nodeMap.get(e.target)!
    
    const link: GraphLink = {
      source: e.source,
      target: e.target,
      sourceNode,
      targetNode,
      weight: e.weight,
      absWeight: Math.abs(e.weight),
      pctInput: e.weight,
      color: pctInputColorFn(e.weight),
      pctInputColor: pctInputColorFn(e.weight),
      strokeWidth: widthScale(Math.abs(e.weight))
    }

    sourceNode.targetLinks?.push(link)
    targetNode.sourceLinks?.push(link)
    
    return link
  })

  return { nodes, links }
}

// Filter links by opacity threshold
export function filterLinksByOpacity(links: GraphLink[], threshold: number): GraphLink[] {
  return links.filter(link => Math.abs(link.weight) >= threshold)
}

// Get human-readable label with fallbacks
export function getNodeLabel(node: GraphNode): string {
  return node.ppClerp || node.localClerp || node.remoteClerp || node.clerp || node.label || node.id
}

// Tooltip content generator
export function makeTooltipContent(node: GraphNode): string {
  const label = getNodeLabel(node)
  const parts = [
    `<strong>${label}</strong>`,
    node.layer !== undefined ? `Layer: ${node.layer}` : null,
    node.size !== undefined ? `Size: ${node.size}` : null,
    node.feature_type ? `Type: ${node.feature_type}` : null,
    node.members?.length ? `Members: ${node.members.length}` : null
  ].filter(Boolean)
  
  return parts.join('<br>')
}

// Draw links on canvas with performance optimizations
export function drawLinks(
  ctx: CanvasRenderingContext2D,
  links: GraphLink[],
  config: GraphConfig,
  options: {
    strokeWidthOffset?: number
    colorOverride?: string
    maxLuminance?: number
    opacity?: number
  } = {}
) {
  const { strokeWidthOffset = 0, colorOverride, maxLuminance = 0.9, opacity = 0.8 } = options

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.lineCap = 'round'

  // Sort by stroke width for better rendering
  const sortedLinks = [...links].sort((a, b) => (a.strokeWidth || 0) - (b.strokeWidth || 0))

  for (const link of sortedLinks) {
    // Prefer d3-resolved nodes from forceLink (objects), fallback to sourceNode/targetNode
    const srcNode = (typeof link.source === 'object' ? (link.source as any) : link.sourceNode) as any
    const tgtNode = (typeof link.target === 'object' ? (link.target as any) : link.targetNode) as any

    if (!srcNode?.pos || !tgtNode?.pos) continue

    ctx.beginPath()
    ctx.moveTo(srcNode.pos[0], srcNode.pos[1])
    ctx.lineTo(tgtNode.pos[0], tgtNode.pos[1])

    let colorToUse = link.color || 'rgb(100, 100, 100)'
    if (maxLuminance !== undefined && !colorOverride) {
      if (calculateLuminance(colorToUse) > maxLuminance) {
        colorToUse = '#ddd'
      }
    }

    ctx.strokeStyle = colorOverride || colorToUse
    ctx.lineWidth = Math.max(0.5, (link.strokeWidth || 1) + strokeWidthOffset)
    ctx.stroke()
  }

  ctx.restore()
}

// Neuronpedia API integration (placeholder)
export async function fetchNeuronpediaLabel(modelId: string, layer: number, feature: number): Promise<string | null> {
  try {
    // This would integrate with actual Neuronpedia API
    const response = await fetch(`https://neuronpedia.org/api/feature/${modelId}/${layer}/${feature}`)
    if (!response.ok) return null
    const data = await response.json()
    return data.explanations?.[0] || data.label || null
  } catch {
    return null
  }
}

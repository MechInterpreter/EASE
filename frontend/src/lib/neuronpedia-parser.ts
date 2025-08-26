// Neuronpedia JSON parser for charlotte_neuronpedia.json format
import type { GraphNode, GraphLink } from './graph-types'

export interface NeuronpediaJSON {
  metadata: {
    slug: string
    scan: string
    prompt_tokens: string[]
    prompt: string
    node_threshold: number
    schema_version: number
    info: {
      creator_name: string
      creator_url: string
      source_urls: string[]
      generator: {
        name: string
        version: string
        url: string
      }
      create_time_ms: number
    }
    generation_settings: {
      max_n_logits: number
      desired_logit_prob: number
      batch_size: number
      max_feature_nodes: number
    }
    pruning_settings: {
      node_threshold: number
      edge_threshold: number
    }
  }
  qParams: {
    pinnedIds: string[]
    supernodes: any[]
    linkType: string
    clickedId: string
    sg_pos: string
  }
  nodes: Array<{
    node_id: string
    feature: number
    layer: string
    ctx_idx: number
    feature_type: string
    token_prob: number
    is_target_logit: boolean
    run_idx: number
    reverse_ctx_idx: number
    jsNodeId: string
    clerp: string
    influence: number
    activation: number
  }>
  edges: Array<{
    source: string
    target: string
    weight: number
  }>
}

export interface TokenLane {
  token: string
  position: number
  nodes: GraphNode[]
}

export interface LayerGroup {
  layer: number
  nodes: GraphNode[]
  yPosition: number
}

export function parseNeuronpediaJSON(data: NeuronpediaJSON): {
  nodes: GraphNode[]
  links: GraphLink[]
  tokenLanes: TokenLane[]
  layerGroups: LayerGroup[]
  metadata: NeuronpediaJSON['metadata']
} {
  // Parse nodes with enhanced labeling
  const nodes: GraphNode[] = data.nodes.map((node, i) => {
    const layer = parseInt(node.layer) || 0
    const isLogit = node.is_target_logit || node.feature_type === 'logit'
    
    return {
      id: node.node_id,
      featureId: `${layer}_${node.feature}`,
      nodeId: node.jsNodeId || node.node_id,
      label: node.clerp || `L${layer}F${node.feature}`,
      layer,
      ctx_idx: node.ctx_idx,
      streamIdx: layer,
      size: Math.abs(node.activation) * 10 || 1,
      x: node.ctx_idx * 80, // Token position
      y: layer * 60, // Layer position
      pos: [node.ctx_idx * 80, layer * 60],
      feature_type: node.feature_type,
      ppClerp: node.clerp,
      clerp: node.clerp || `L${layer}F${node.feature}`,
      nodeColor: isLogit ? '#ef4444' : getFeatureTypeColor(node.feature_type),
      sourceLinks: [],
      targetLinks: [],
      // Additional Neuronpedia fields
      influence: node.influence,
      activation: node.activation,
      tokenProb: node.token_prob,
      isTargetLogit: node.is_target_logit,
      runIdx: node.run_idx,
      reverseCtxIdx: node.reverse_ctx_idx
    }
  })

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Parse edges
  const links: GraphLink[] = data.edges.map(edge => {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    
    if (!sourceNode || !targetNode) {
      console.warn(`Missing node for edge: ${edge.source} -> ${edge.target}`)
      return null
    }

    const link: GraphLink = {
      source: edge.source,
      target: edge.target,
      sourceNode,
      targetNode,
      weight: edge.weight,
      absWeight: Math.abs(edge.weight),
      pctInput: edge.weight,
      color: getWeightColor(edge.weight),
      pctInputColor: getWeightColor(edge.weight),
      strokeWidth: Math.max(0.5, Math.abs(edge.weight) * 3)
    }

    sourceNode.targetLinks?.push(link)
    targetNode.sourceLinks?.push(link)
    
    return link
  }).filter(Boolean) as GraphLink[]

  // Create token lanes
  const tokenLanes: TokenLane[] = data.metadata.prompt_tokens.map((token, i) => ({
    token,
    position: i,
    nodes: nodes.filter(n => n.ctx_idx === i)
  }))

  // Create layer groups
  const layerMap = new Map<number, GraphNode[]>()
  nodes.forEach(node => {
    const layer = node.layer || 0
    if (!layerMap.has(layer)) layerMap.set(layer, [])
    layerMap.get(layer)!.push(node)
  })

  const layerGroups: LayerGroup[] = Array.from(layerMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([layer, layerNodes], i) => ({
      layer,
      nodes: layerNodes,
      yPosition: i * 60
    }))

  return {
    nodes,
    links,
    tokenLanes,
    layerGroups,
    metadata: data.metadata
  }
}

function getFeatureTypeColor(featureType: string): string {
  const colors = {
    'cross layer transcoder': '#3b82f6',
    'attention': '#10b981',
    'mlp': '#f59e0b',
    'logit': '#ef4444',
    'embedding': '#8b5cf6',
    'residual': '#6b7280'
  }
  return colors[featureType as keyof typeof colors] || '#6b7280'
}

function getWeightColor(weight: number): string {
  // Use d3.interpolatePRGn-like color scheme
  const absWeight = Math.abs(weight)
  const sign = weight >= 0 ? 1 : -1
  
  if (absWeight < 0.1) return '#f7f7f7'
  
  const intensity = Math.min(absWeight / 0.5, 1)
  
  if (sign > 0) {
    // Positive weights: green
    const green = Math.floor(255 - intensity * 100)
    return `rgb(0, ${green}, 0)`
  } else {
    // Negative weights: purple/red
    const red = Math.floor(255 - intensity * 100)
    return `rgb(${red}, 0, 100)`
  }
}

export function generateAutoInterpLabel(node: GraphNode): string {
  // Auto-interpretation label generation based on feature patterns
  const { feature_type, layer, activation = 0, influence = 0 } = node
  
  let label = `L${layer} `
  
  switch (feature_type) {
    case 'cross layer transcoder':
      label += activation > 2 ? 'High-activation transcoder' : 'Transcoder'
      break
    case 'attention':
      label += influence > 0.5 ? 'Key attention head' : 'Attention head'
      break
    case 'mlp':
      label += activation > 1.5 ? 'Active MLP neuron' : 'MLP neuron'
      break
    case 'logit':
      label += 'Output logit'
      break
    default:
      label += `${feature_type} feature`
  }
  
  return `${label} [AI label]`
}

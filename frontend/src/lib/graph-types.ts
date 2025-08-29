// Types for graph visualizations adapted from Neuronpedia and EASE

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  featureId?: string
  nodeId?: string
  label: string
  layer?: number
  ctx_idx?: number
  streamIdx?: number
  size?: number
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  pos?: [number, number]
  nodeColor?: string
  ppClerp?: string
  clerp?: string
  localClerp?: string
  remoteClerp?: string
  feature_type?: string
  members?: string[]
  memberNodes?: GraphNode[]
  memberNodeIds?: string[]
  isSuperNode?: boolean
  supernodeId?: string
  sourceLinks?: GraphLink[]
  targetLinks?: GraphLink[]
  inputAbsSum?: number
  inputAbsSumExternalSn?: number
  sgSnInputWeighting?: number
  tmpHoveredLink?: GraphLink
  tmpClickedLink?: GraphLink
  tmpHoveredSourceLink?: GraphLink
  tmpHoveredTargetLink?: GraphLink
  tmpClickedSourceLink?: GraphLink
  tmpClickedTargetLink?: GraphLink
  // Neuronpedia-specific fields
  activation?: number
  influence?: number
  tokenProb?: number
  isTargetLogit?: boolean
  runIdx?: number
  reverseCtxIdx?: number
  // Force-directed layout
  radius?: number
  color?: string
  type?: 'supernode' | 'logit'
  expanded?: boolean
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
  weight: number
  value?: number
  id?: string
  type?: string
  sourcePort?: string
  targetPort?: string
  tmpHovered?: boolean
  tmpClicked?: boolean
  tmpFaded?: boolean
  tmpHighlighted?: boolean
  tmpSelected?: boolean
  tmpHidden?: boolean
  tmpDimmed?: boolean
  tmpSourceHighlighted?: boolean
  tmpTargetHighlighted?: boolean
  // Force-directed layout
  index?: number
  width?: number
  color?: string
  opacity?: number
  strokeDasharray?: string
  // Neuronpedia-specific fields
  sourceNode?: GraphNode
  targetNode?: GraphNode
  absWeight?: number
  pctInput?: number
  pctInputColor?: string
  strokeWidth?: number
}

export interface NeuronpediaNode {
  feature: number
  layer: number
  feature_type: string
  activations?: number[]
  explanations?: string[]
  label?: string
}

export interface NeuronpediaData {
  nodes: NeuronpediaNode[]
  edges: Array<{
    source: number
    target: number
    weight: number
  }>
  metadata?: {
    model?: string
    scan?: string
    layers?: number
  }
}

export interface SupernodeData {
  nodes: Array<{
    id: string
    size: number
    layer?: number | null
    members: string[]
  }>
  edges: Array<{
    source: string
    target: string
    weight: number
  }>
  groups?: Array<{
    id: string
    size: number
    layer?: number | null
  }>
}

export interface GraphConfig {
  width: number
  height: number
  margin: { left: number; right: number; top: number; bottom: number }
  nodeWidth: number
  nodeHeight: number
  edgeOpacityThreshold: number
  layout: 'force' | 'layered'
}

export interface ForceNode extends GraphNode {
  vx?: number
  vy?: number
  radius: number
  color: string
  type: 'supernode' | 'logit'
  expanded: boolean
  pos: [number, number]
  fx?: number | null
  fy?: number | null
}

export type VisualizationType = 'attribution' | 'supernode' | 'force'

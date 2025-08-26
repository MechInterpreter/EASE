export type NodeType = 'feature' | 'token' | 'logit' | 'super'
export type SimilarityMetric = 'cosine' | 'dot'
export type FingerprintSource = 'delta_logit' | 'adjacency'
export type LayoutType = 'force' | 'layered'

export interface GraphInfo {
  num_nodes: number
  num_edges: number
  layers: number[]
  layer_hist: Record<number, number>
  logit_ids: string[]
}

export interface RunRequest {
  tau_sim: number
  alpha: number
  beta: number
  layer_whitelist: number[] | null
  gate_enabled: boolean
  similarity_metric: SimilarityMetric
  fingerprint_source: FingerprintSource
  normalize_fingerprints: boolean
  topk_candidates_per_node: number
  max_pairs_per_layer: number
  max_merges: number
  min_group_size_postfilter: number
  seed: number
}

export interface MergeEvent {
  u: string
  v: string
  score: number
  layer: number
  mean_corr: number
  ce_gap: number
}

export interface RunStats {
  num_candidates: number
  num_accepted: number
  cr: number
  layers: number[]
  timeline_len: number
}

export interface RunSummary {
  params: Record<string, any>
  stats: RunStats
  merge_log: MergeEvent[]
}

export interface SnapshotNode {
  id: string
  members: string[]
  layer: number | null
  size: number
}

export interface SnapshotEdge {
  source: string
  target: string
  weight: number
}

export interface SnapshotMetrics {
  mean_group_size: number
  num_groups: number
}

export interface Snapshot {
  step: number
  cr: number
  nodes: SnapshotNode[]
  edges: SnapshotEdge[]
  groups: { id: string; size: number; layer?: number | null }[]
  metrics: SnapshotMetrics
}

export interface GraphValidation {
  info: GraphInfo
  notes: string[]
}

export const defaultParams: RunRequest = {
  tau_sim: 0.98,
  alpha: 0.9,
  beta: 0.05,
  layer_whitelist: null,
  gate_enabled: true,
  similarity_metric: 'cosine',
  fingerprint_source: 'adjacency',
  normalize_fingerprints: true,
  topk_candidates_per_node: 50,
  max_pairs_per_layer: 100000,
  max_merges: 0,
  min_group_size_postfilter: 1,
  seed: 123,
}

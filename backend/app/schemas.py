from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


NodeType = Literal["feature", "token", "logit", "super"]
SimilarityMetric = Literal["cosine", "dot"]
FingerprintSource = Literal["delta_logit", "adjacency"]
LayoutType = Literal["force", "layered"]


class NodeSchema(BaseModel):
    id: str
    type: NodeType
    layer: Optional[int] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class EdgeSchema(BaseModel):
    source: str
    target: str
    weight: float


class RunRequest(BaseModel):
    tau_sim: float = 0.98
    alpha: float = 0.90
    beta: float = 0.05
    layer_whitelist: Optional[List[int]] = None
    gate_enabled: bool = True
    similarity_metric: SimilarityMetric = "cosine"
    fingerprint_source: FingerprintSource = "adjacency"
    normalize_fingerprints: bool = True
    topk_candidates_per_node: int = 50
    max_pairs_per_layer: int = 100_000
    max_merges: int = 0  # 0 = unlimited
    min_group_size_postfilter: int = 1
    seed: int = 123


class MergeEvent(BaseModel):
    u: str
    v: str
    score: float
    layer: int
    mean_corr: float
    ce_gap: float


class RunStats(BaseModel):
    num_candidates: int
    num_accepted: int
    cr: float
    layers: List[int]
    timeline_len: int


class RunSummary(BaseModel):
    params: Dict[str, Any]
    stats: RunStats
    merge_log: List[MergeEvent]


class SnapshotNode(BaseModel):
    id: str
    members: List[str]
    layer: Optional[int] = None
    size: int


class SnapshotEdge(BaseModel):
    source: str
    target: str
    weight: float


class SnapshotMetrics(BaseModel):
    mean_group_size: float
    num_groups: int


class Snapshot(BaseModel):
    step: int
    cr: float
    nodes: List[SnapshotNode]
    edges: List[SnapshotEdge]
    groups: List[Dict[str, Any]]
    metrics: SnapshotMetrics


class GraphInfo(BaseModel):
    num_nodes: int
    num_edges: int
    layers: List[int]
    layer_hist: Dict[int, int]
    logit_ids: List[str]


class LoadUrlRequest(BaseModel):
    url: str


class GraphValidation(BaseModel):
    info: GraphInfo
    notes: List[str] = Field(default_factory=list)

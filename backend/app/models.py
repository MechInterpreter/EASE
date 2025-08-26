from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class Node:
    id: str
    type: str  # 'feature' | 'token' | 'logit' | 'super'
    layer: Optional[int] = None
    meta: Dict = field(default_factory=dict)


@dataclass
class Edge:
    source: str
    target: str
    weight: float


@dataclass
class Graph:
    nodes: List[Node]
    edges: List[Edge]
    # Derived indices
    node_by_id: Dict[str, Node] = field(init=False, default_factory=dict)
    outgoing: Dict[str, List[Edge]] = field(init=False, default_factory=dict)
    incoming: Dict[str, List[Edge]] = field(init=False, default_factory=dict)
    layers: List[int] = field(init=False, default_factory=list)
    feature_ids: List[str] = field(init=False, default_factory=list)
    token_ids: List[str] = field(init=False, default_factory=list)
    logit_ids: List[str] = field(init=False, default_factory=list)

    def __post_init__(self) -> None:
        self.build_indices()

    def build_indices(self) -> None:
        self.node_by_id = {n.id: n for n in self.nodes}
        self.outgoing = {n.id: [] for n in self.nodes}
        self.incoming = {n.id: [] for n in self.nodes}
        for e in self.edges:
            if e.source in self.outgoing:
                self.outgoing[e.source].append(e)
            if e.target in self.incoming:
                self.incoming[e.target].append(e)
        # Collect IDs by type
        self.feature_ids = [n.id for n in self.nodes if n.type == "feature"]
        self.token_ids = [n.id for n in self.nodes if n.type == "token"]
        self.logit_ids = [n.id for n in self.nodes if n.type == "logit"]
        # Layers histogram order
        layer_set = sorted({n.layer for n in self.nodes if n.layer is not None})
        self.layers = list(layer_set)

    def layer_of(self, node_id: str) -> Optional[int]:
        n = self.node_by_id.get(node_id)
        return n.layer if n else None

    def counts(self) -> Tuple[int, int]:
        return len(self.nodes), len(self.edges)

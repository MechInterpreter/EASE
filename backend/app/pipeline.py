from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np

from .dsu import DSU
from .loader import build_fingerprints
from .models import Graph
from .schemas import (
    FingerprintSource,
    MergeEvent,
    RunRequest,
    RunStats,
    Snapshot,
    SnapshotEdge,
    SnapshotMetrics,
    SnapshotNode,
)
from .utils import (
    cosine_similarity_matrix,
    dot_similarity_matrix,
    select_topk_above_threshold,
    stable_pair_hash,
)


@dataclass
class RunState:
    graph: Graph
    params: RunRequest
    feature_ids: List[str]
    feature_layers: List[Optional[int]]
    X: np.ndarray  # fingerprints [N, D]
    dsu: DSU
    layer_to_indices: Dict[int, List[int]]
    candidates_count: int
    merge_log: List[MergeEvent] = field(default_factory=list)
    parent_snapshots: List[List[int]] = field(default_factory=list)

    def timeline_len(self) -> int:
        return len(self.parent_snapshots)


_CURRENT_RUN: Optional[RunState] = None


def _similarity_matrix(X: np.ndarray, metric: str) -> np.ndarray:
    if metric == "cosine":
        return cosine_similarity_matrix(X)
    elif metric == "dot":
        return dot_similarity_matrix(X)
    else:
        raise ValueError(f"Unknown similarity metric: {metric}")


def _group_by_layer(ids: List[str], layers: List[Optional[int]]) -> Dict[int, List[int]]:
    m: Dict[int, List[int]] = {}
    for i, L in enumerate(layers):
        key = -1 if L is None else int(L)
        m.setdefault(key, []).append(i)
    return m


def _apply_gates(u: str, v: str, score: float, layer: int, seed: int, alpha: float, beta: float) -> Optional[Tuple[float, float]]:
    """Return (mean_corr, ce_gap) if pair passes gates, else None.

    Placeholder deterministic gating using a stable pair hash.
    mean_corr in [0.9, 1.0], ce_gap in [0.0, 0.02]
    """
    h = stable_pair_hash(u, v, seed)
    mean_corr = 0.9 + 0.1 * h
    ce_gap = 0.02 * (1.0 - h)
    if mean_corr >= alpha and ce_gap <= beta:
        return (mean_corr, ce_gap)
    return None


def run_pipeline(graph: Graph, req: RunRequest) -> RunState:
    # Build fingerprints and select features (optionally by layer whitelist)
    fids, X, layers = build_fingerprints(
        graph,
        fingerprint_source=req.fingerprint_source,
        normalize_fingerprints=req.normalize_fingerprints,
        layer_whitelist=req.layer_whitelist,
    )
    # Group by layer for candidate generation
    layer_to_indices = _group_by_layer(fids, layers)

    dsu = DSU(items=fids)
    merge_log: List[MergeEvent] = []
    parent_snapshots: List[List[int]] = []
    total_candidates = 0

    # For each layer, compute pair candidates and apply gates
    for L, idxs in layer_to_indices.items():
        if len(idxs) < 2:
            continue
        Xl = X[idxs, :]
        S = _similarity_matrix(Xl, req.similarity_metric)
        # Zero diagonal to avoid self-pairs (although selector uses i<j)
        np.fill_diagonal(S, -np.inf)

        pairs: List[Tuple[int, int, float]] = list(
            select_topk_above_threshold(S, req.tau_sim, req.topk_candidates_per_node)
        )
        # Cap by max_pairs_per_layer
        if req.max_pairs_per_layer and req.max_pairs_per_layer > 0:
            pairs = pairs[: req.max_pairs_per_layer]
        total_candidates += len(pairs)

        # Score sort: high to low, deterministic tie-breaker on ids
        pairs.sort(key=lambda t: (-t[2], f"{fids[idxs[t[0]]]}|{fids[idxs[t[1]]]}") )

        # Apply gates and perform merges
        for i_local, j_local, score in pairs:
            u = fids[idxs[i_local]]
            v = fids[idxs[j_local]]
            # Skip if already in same set
            if dsu.find(u) == dsu.find(v):
                continue
            mean_ce = (1.0, 0.0)
            if req.gate_enabled:
                r = _apply_gates(u, v, float(score), L, req.seed, req.alpha, req.beta)
                if r is None:
                    continue
                mean_ce = r
            ok = dsu.union(u, v)
            if ok:
                me = MergeEvent(
                    u=u,
                    v=v,
                    score=float(score),
                    layer=int(L),
                    mean_corr=float(mean_ce[0]),
                    ce_gap=float(mean_ce[1]),
                )
                merge_log.append(me)
                parent_snapshots.append(dsu.snapshot())
                if req.max_merges and req.max_merges > 0 and len(merge_log) >= req.max_merges:
                    break
        if req.max_merges and req.max_merges > 0 and len(merge_log) >= req.max_merges:
            break

    # Stats
    num_features = len(fids)
    groups = dsu.groups()
    num_groups = sum(1 for members in groups.values() if len(members) >= 1)
    cr = (num_features / num_groups) if num_groups > 0 else 1.0

    state = RunState(
        graph=graph,
        params=req,
        feature_ids=fids,
        feature_layers=layers,
        X=X,
        dsu=dsu,
        layer_to_indices=layer_to_indices,
        candidates_count=total_candidates,
        merge_log=merge_log,
        parent_snapshots=parent_snapshots,
    )
    global _CURRENT_RUN
    _CURRENT_RUN = state
    return state


def _build_groups_from_parents(state: RunState, parents: List[int]) -> Dict[int, List[int]]:
    # Build groups mapping root->member indices given a parent array
    d: Dict[int, List[int]] = {}
    for i, p in enumerate(parents):
        # Path compression equivalence: use p directly
        d.setdefault(p, []).append(i)
    return d


def _aggregate_edges_to_logits(state: RunState, groups: Dict[int, List[int]], edge_threshold: float) -> List[SnapshotEdge]:
    # Aggregate outgoing edges of member features to logits
    graph = state.graph
    edges: List[SnapshotEdge] = []
    for gid, members in groups.items():
        # Compute supernode id
        Ls = {state.feature_layers[i] for i in members if state.feature_layers[i] is not None}
        L = list(Ls)[0] if Ls else -1
        sid = f"super|{L}|{gid}"
        # accumulate
        acc: Dict[str, float] = {}
        for i in members:
            fid = state.feature_ids[i]
            for e in graph.outgoing.get(fid, []):
                if e.target in graph.logit_ids:
                    acc[e.target] = acc.get(e.target, 0.0) + float(e.weight)
        for tgt, w in acc.items():
            if abs(w) >= edge_threshold:
                edges.append(SnapshotEdge(source=sid, target=tgt, weight=float(w)))
    return edges


def snapshot(state: RunState, step: int, edge_opacity_threshold: float = 0.1) -> Snapshot:
    # Determine parents at given step
    if step <= 0:
        parents = list(range(len(state.feature_ids)))
    elif step >= len(state.parent_snapshots):
        parents = state.parent_snapshots[-1][:]
    else:
        parents = state.parent_snapshots[step - 1][:]

    groups = _build_groups_from_parents(state, parents)

    # Build nodes, grouped by root
    nodes: List[SnapshotNode] = []
    group_records: List[dict] = []
    total_size = 0
    for gid, members in groups.items():
        member_ids = [state.feature_ids[i] for i in members]
        Ls = {state.feature_layers[i] for i in members if state.feature_layers[i] is not None}
        L = list(Ls)[0] if Ls else -1
        size = len(members)
        total_size += size
        sid = f"super|{L}|{gid}"
        nodes.append(
            SnapshotNode(id=sid, members=member_ids, layer=int(L), size=size)
        )
        group_records.append({"id": sid, "size": size, "layer": int(L)})

    # Metrics
    num_groups = len(groups)
    mean_group_size = (total_size / num_groups) if num_groups > 0 else 0.0
    cr = (len(state.feature_ids) / num_groups) if num_groups > 0 else 1.0

    # Aggregate edges to logits
    edges = _aggregate_edges_to_logits(state, groups, edge_opacity_threshold)

    snap = Snapshot(
        step=int(step),
        cr=float(cr),
        nodes=nodes,
        edges=edges,
        groups=group_records,
        metrics=SnapshotMetrics(mean_group_size=float(mean_group_size), num_groups=int(num_groups)),
    )
    return snap


def get_current_run() -> Optional[RunState]:
    return _CURRENT_RUN

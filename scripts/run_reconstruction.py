#!/usr/bin/env python3
"""
Run supernode reconstruction on the Charlotte dataset with relaxed thresholds and
print concise summary stats as JSON. This script avoids importing heavy loader/pipeline
modules to prevent optional dependency issues (e.g., orjson), and instead implements
the essential steps inline using the light modules in app/ (models, utils, dsu, ct_compat).
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np

# Ensure we can import from ease/backend/app
ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
import sys
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models import Graph  # type: ignore
from app.ct_compat.id_utils import normalize_nodes_edges  # type: ignore
from app.utils import (
    l2_normalize_rows,
    cosine_similarity_matrix,
    dot_similarity_matrix,
    select_topk_above_threshold,
    stable_pair_hash,
)  # type: ignore
from app.dsu import DSU  # type: ignore


# Heuristic extraction copied from app.loader.extract_nodes_edges to avoid importing loader (orjson dep)
def extract_nodes_edges(raw: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    notes: List[str] = []
    raw_nodes = raw.get("nodes") or raw.get("Vertices") or raw.get("NODES")
    raw_edges = raw.get("edges") or raw.get("Edges") or raw.get("EDGES")
    if raw_edges is None:
        raw_edges = raw.get("links") or raw.get("Links") or raw.get("LINKS")
        if raw_edges is not None:
            notes.append("using 'links' as edges")
    # Nested graph structures
    if (raw_nodes is None or raw_edges is None) and isinstance(raw.get("graph"), dict):
        graw = raw.get("graph")
        if raw_nodes is None:
            raw_nodes = graw.get("nodes") or graw.get("Vertices") or graw.get("NODES")
        if raw_edges is None:
            raw_edges = (
                graw.get("edges")
                or graw.get("Edges")
                or graw.get("EDGES")
                or graw.get("links")
                or graw.get("Links")
                or graw.get("LINKS")
            )
        notes.append("using nested graph.* keys")
    # Final fallback to empty lists
    if raw_nodes is None:
        raw_nodes = []
        notes.append("no nodes found; defaulting to empty list")
    if raw_edges is None:
        raw_edges = []
        notes.append("no edges found; defaulting to empty list")
    return raw_nodes, raw_edges, notes


def build_graph_from_raw(raw: Dict[str, Any]) -> Tuple[Graph, List[str]]:
    raw_nodes, raw_edges, notes = extract_nodes_edges(raw)
    nodes, edges = normalize_nodes_edges(raw_nodes, raw_edges)
    g = Graph(nodes=nodes, edges=edges)
    return g, notes


def similarity_matrix(X: np.ndarray, metric: str) -> np.ndarray:
    if metric == "cosine":
        return cosine_similarity_matrix(X)
    elif metric == "dot":
        return dot_similarity_matrix(X)
    else:
        raise ValueError(f"Unknown similarity metric: {metric}")


def apply_gates(u: str, v: str, score: float, layer: int, seed: int, alpha: float, beta: float) -> Optional[Tuple[float, float]]:
    """Deterministic placeholder gate; mirrors app.pipeline._apply_gates."""
    h = stable_pair_hash(u, v, seed)
    mean_corr = 0.9 + 0.1 * h
    ce_gap = 0.02 * (1.0 - h)
    if mean_corr >= alpha and ce_gap <= beta:
        return (mean_corr, ce_gap)
    return None


@dataclass
class Params:
    tau_sim: float = 0.9
    alpha: float = 0.8
    beta: float = 0.5
    gate_enabled: bool = True
    similarity_metric: str = "cosine"  # or "dot"
    normalize_fingerprints: bool = True
    layer_whitelist: Optional[List[int]] = None
    topk_candidates_per_node: int = 50
    max_pairs_per_layer: int = 100_000
    seed: int = 123
    edge_opacity_threshold: float = 0.1


@dataclass
class RunResult:
    feature_ids: List[str]
    feature_layers: List[Optional[int]]
    X: np.ndarray
    dsu: DSU
    candidates_count: int
    merge_log: List[Dict[str, Any]]


def run_reconstruction(g: Graph, p: Params) -> RunResult:
    # Build adjacency-based fingerprints
    feature_ids = g.feature_ids
    feature_layers = [g.layer_of(fid) for fid in feature_ids]

    # Apply optional layer whitelist
    sel_idx: List[int] = []
    if p.layer_whitelist is not None:
        wl = set(p.layer_whitelist)
        for i, L in enumerate(feature_layers):
            if L in wl:
                sel_idx.append(i)
    else:
        sel_idx = list(range(len(feature_ids)))

    sel_fids = [feature_ids[i] for i in sel_idx]
    sel_layers = [feature_layers[i] for i in sel_idx]

    # Choose columns (logits preferred; fallback to tokens)
    logit_index: Dict[str, int] = {lid: j for j, lid in enumerate(g.logit_ids)}
    D = len(logit_index)
    if D == 0:
        token_index: Dict[str, int] = {tid: j for j, tid in enumerate(g.token_ids)}
        D = len(token_index)
        col_index = token_index
    else:
        col_index = logit_index

    X = np.zeros((len(sel_fids), D), dtype=np.float32)
    for row, fid in enumerate(sel_fids):
        for e in g.outgoing.get(fid, []):
            j = col_index.get(e.target)
            if j is not None:
                X[row, j] += float(e.weight)

    if p.normalize_fingerprints and X.size > 0:
        X = l2_normalize_rows(X)

    # Group by layer
    layer_to_indices: Dict[int, List[int]] = {}
    for i, L in enumerate(sel_layers):
        key = -1 if L is None else int(L)
        layer_to_indices.setdefault(key, []).append(i)

    dsu = DSU(items=sel_fids)
    merge_log: List[Dict[str, Any]] = []
    total_candidates = 0

    # Candidate generation and merging
    for L, idxs in layer_to_indices.items():
        if len(idxs) < 2:
            continue
        Xl = X[idxs, :]
        # Skip degenerate layers
        if Xl.shape[1] == 0 or not np.any(np.linalg.norm(Xl, axis=1) > 0):
            continue
        S = similarity_matrix(Xl, p.similarity_metric)
        np.fill_diagonal(S, -np.inf)
        pairs: List[Tuple[int, int, float]] = list(
            select_topk_above_threshold(S, p.tau_sim, p.topk_candidates_per_node)
        )
        if p.max_pairs_per_layer and p.max_pairs_per_layer > 0:
            pairs = pairs[: p.max_pairs_per_layer]
        total_candidates += len(pairs)

        pairs.sort(key=lambda t: (-t[2], f"{sel_fids[idxs[t[0]]]}|{sel_fids[idxs[t[1]]]}") )

        for i_local, j_local, score in pairs:
            u = sel_fids[idxs[i_local]]
            v = sel_fids[idxs[j_local]]
            if dsu.find(u) == dsu.find(v):
                continue
            ok_to_merge = True
            mean_corr, ce_gap = 1.0, 0.0
            if p.gate_enabled:
                r = apply_gates(u, v, float(score), L, p.seed, p.alpha, p.beta)
                if r is None:
                    ok_to_merge = False
                else:
                    mean_corr, ce_gap = float(r[0]), float(r[1])
            if ok_to_merge and dsu.union(u, v):
                merge_log.append({
                    "u": u,
                    "v": v,
                    "score": float(score),
                    "layer": int(L),
                    "mean_corr": mean_corr,
                    "ce_gap": ce_gap,
                })

    return RunResult(
        feature_ids=sel_fids,
        feature_layers=sel_layers,
        X=X,
        dsu=dsu,
        candidates_count=total_candidates,
        merge_log=merge_log,
    )


def aggregate_snapshot_edges(g: Graph, fids: List[str], layers: List[Optional[int]], parents: List[int], edge_threshold: float) -> int:
    # Build groups mapping root->member indices
    groups: Dict[int, List[int]] = {}
    for i, p in enumerate(parents):
        groups.setdefault(p, []).append(i)

    edges_count = 0
    for gid, members in groups.items():
        # Derive super id (not used except for grouping)
        Ls = {layers[i] for i in members if layers[i] is not None}
        L = list(Ls)[0] if Ls else -1
        # accumulate outgoing to logits
        acc: Dict[str, float] = {}
        for i in members:
            fid = fids[i]
            for e in g.outgoing.get(fid, []):
                if e.target in g.logit_ids:
                    acc[e.target] = acc.get(e.target, 0.0) + float(e.weight)
        for tgt, w in acc.items():
            if abs(w) >= edge_threshold:
                edges_count += 1
    return edges_count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-path", type=str, default=str(os.getenv("EASE_DATA_PATH", ROOT / "data" / "charlotte_neuronpedia.json")))
    ap.add_argument("--tau-sim", type=float, default=0.85)
    ap.add_argument("--alpha", type=float, default=0.8)
    ap.add_argument("--beta", type=float, default=0.5)
    ap.add_argument("--preset", type=str, choices=["charlotte"], default=None, help="Use tuned parameter preset")
    ap.add_argument("--metric", type=str, default="cosine", choices=["cosine", "dot"])
    ap.add_argument("--no-normalize", action="store_true")
    ap.add_argument("--topk", type=int, default=50)
    ap.add_argument("--max-pairs-per-layer", type=int, default=100_000)
    ap.add_argument("--edge-threshold", type=float, default=0.1)
    args = ap.parse_args()

    # Load dataset via stdlib json to avoid orjson dependency
    data_path = Path(args.data_path)
    with data_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    # Build graph and run
    g, notes = build_graph_from_raw(raw)
    # Apply preset overrides if specified
    tau_sim = float(args.tau_sim)
    alpha = float(args.alpha)
    beta = float(args.beta)
    if args.preset == "charlotte":
        tau_sim = 0.85
        alpha = 0.8
        beta = 0.5

    p = Params(
        tau_sim=tau_sim,
        alpha=alpha,
        beta=beta,
        gate_enabled=True,
        similarity_metric=str(args.metric),
        normalize_fingerprints=not bool(args.no_normalize),
        topk_candidates_per_node=int(args.topk),
        max_pairs_per_layer=int(args.max_pairs_per_layer),
        edge_opacity_threshold=float(args.edge_threshold),
    )

    res = run_reconstruction(g, p)

    # Snapshot @ final step
    parents = res.dsu.snapshot()
    num_groups = len({r for r in parents})
    snapshot_edges_count = aggregate_snapshot_edges(g, res.feature_ids, res.feature_layers, parents, p.edge_opacity_threshold)

    out = {
        "num_features": len(res.feature_ids),
        "fingerprint_dim": int(res.X.shape[1]) if res.X.ndim == 2 else 0,
        "layers": g.layers,
        "candidates": int(res.candidates_count),
        "merges": len(res.merge_log),
        "num_groups": int(num_groups),
        "cr": (len(res.feature_ids) / num_groups) if num_groups > 0 else 1.0,
        "snapshot_edges_count": int(snapshot_edges_count),
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

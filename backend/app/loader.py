from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import orjson
import numpy as np

from .config import config
from .models import Edge, Graph, Node
from .ct_compat.id_utils import normalize_nodes_edges
from . import utils


_GRAPH_CACHE: Optional[Graph] = None


def reset_cache() -> None:
    """Reset the cached Graph (used by tests)."""
    global _GRAPH_CACHE
    _GRAPH_CACHE = None


def _read_json(path: Path) -> dict:
    data = path.read_bytes()
    return orjson.loads(data)


def load_graph() -> Graph:
    global _GRAPH_CACHE
    if _GRAPH_CACHE is not None:
        return _GRAPH_CACHE
    path = Path(config.data_path)
    if not path.exists():
        raise FileNotFoundError(f"Data file not found: {path}")
    raw = _read_json(path)
    raw_nodes, raw_edges, _notes = extract_nodes_edges(raw)
    nodes, edges = normalize_nodes_edges(raw_nodes, raw_edges)
    g = Graph(nodes=nodes, edges=edges)
    _GRAPH_CACHE = g
    return g


def extract_nodes_edges(raw: Dict) -> Tuple[List[Dict], List[Dict], List[str]]:
    """Heuristically extract nodes/edges arrays from diverse JSON schemas.

    Returns (raw_nodes, raw_edges, notes).
    """
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


def set_graph_from_raw(raw: Dict) -> Tuple[Graph, List[str]]:
    """Normalize and set the global graph cache from a raw JSON dict.

    Returns (graph, notes) where notes include schema extraction decisions.
    """
    raw_nodes, raw_edges, notes = extract_nodes_edges(raw)
    nodes, edges = normalize_nodes_edges(raw_nodes, raw_edges)
    g = Graph(nodes=nodes, edges=edges)
    global _GRAPH_CACHE
    _GRAPH_CACHE = g
    return g, notes


def validate_raw(raw: Dict) -> Tuple[Graph, List[str]]:
    """Normalize a raw JSON dict without mutating cache, returning a Graph and notes."""
    raw_nodes, raw_edges, notes = extract_nodes_edges(raw)
    nodes, edges = normalize_nodes_edges(raw_nodes, raw_edges)
    g = Graph(nodes=nodes, edges=edges)
    return g, notes


def _delta_logit_vectors_from_meta(graph: Graph) -> Optional[np.ndarray]:
    """Try to build a fingerprint matrix from stored per-feature vectors.

    Expected to find in Node.meta keys like 'delta_logit', 'fingerprint', or 'vec'.
    Returns None if not available or inconsistent.
    """
    vecs: List[Optional[np.ndarray]] = []
    dim: Optional[int] = None
    for fid in graph.feature_ids:
        n = graph.node_by_id[fid]
        m = n.meta or {}
        arr = None
        for k in ("delta_logit", "fingerprint", "vec"):
            if k in m:
                try:
                    arr = np.asarray(m[k], dtype=np.float32)
                except Exception:
                    arr = None
                break
        if arr is not None:
            if arr.ndim != 1:
                return None
            if dim is None:
                dim = int(arr.shape[0])
            elif arr.shape[0] != dim:
                return None
            vecs.append(arr)
        else:
            vecs.append(None)
    if any(v is None for v in vecs):
        return None
    X = np.vstack([v for v in vecs if v is not None])
    return X


def build_fingerprints(
    graph: Graph,
    fingerprint_source: str = "adjacency",
    normalize_fingerprints: bool = True,
    layer_whitelist: Optional[List[int]] = None,
) -> Tuple[List[str], np.ndarray, List[int]]:
    """Return (feature_ids, X, feature_layers) restricted by optional layer_whitelist.

    - fingerprint_source: 'delta_logit' or 'adjacency'
    - X shape: [num_features_selected, D]
    - feature_layers: per-row layer indices
    """
    feature_ids = graph.feature_ids
    feature_layers = [graph.layer_of(fid) for fid in feature_ids]

    # Apply whitelist restriction
    sel_idx: List[int] = []
    if layer_whitelist is not None:
        wl = set(layer_whitelist)
        for i, L in enumerate(feature_layers):
            if L in wl:
                sel_idx.append(i)
    else:
        sel_idx = list(range(len(feature_ids)))

    sel_fids = [feature_ids[i] for i in sel_idx]
    sel_layers = [feature_layers[i] for i in sel_idx]

    if fingerprint_source == "delta_logit":
        X_full = _delta_logit_vectors_from_meta(graph)
        if X_full is None:
            # fallback to adjacency
            fingerprint_source = "adjacency"
        else:
            X = X_full[sel_idx, :]
            if normalize_fingerprints:
                X = utils.l2_normalize_rows(X)
            return sel_fids, X, sel_layers

    # adjacency-based fingerprints over logit ids
    logit_index: Dict[str, int] = {lid: j for j, lid in enumerate(graph.logit_ids)}
    D = len(logit_index)
    if D == 0:
        # If there are no logits, fallback to tokens as columns
        token_index: Dict[str, int] = {tid: j for j, tid in enumerate(graph.token_ids)}
        D = len(token_index)
        col_index = token_index
        col_type = "token"
    else:
        col_index = logit_index
        col_type = "logit"

    X = np.zeros((len(sel_fids), D), dtype=np.float32)
    for row, fid in enumerate(sel_fids):
        for e in graph.outgoing.get(fid, []):
            if e.target in col_index:
                X[row, col_index[e.target]] += float(e.weight)

    if normalize_fingerprints:
        X = utils.l2_normalize_rows(X)

    return sel_fids, X, sel_layers

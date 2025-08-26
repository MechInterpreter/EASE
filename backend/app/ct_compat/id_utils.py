"""
Adapted compatibility helpers for ID normalization and minimal utilities inspired by
MechInterpreter/circuit-tracer. This is a lightweight vendor of only what's needed
for the demo. See the original project for the full implementation.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from ..models import Node, Edge


def _infer_node_type(raw: Dict[str, Any]) -> Optional[str]:
    # Prefer explicit flags first
    if bool(raw.get("is_target_logit")):
        return "logit"
    t = raw.get("type") or raw.get("node_type") or raw.get("kind")
    if t:
        t = str(t).lower()
        if t in {"feature", "token", "logit"}:
            return t
    # Try to infer from id
    rid = str(raw.get("id", "")).lower()
    for key in ("feature", "token", "logit"):
        if key in rid:
            return key
    return None


def _to_int(value: Any) -> Optional[int]:
    """Best-effort conversion to int, returning None on failure.

    Handles numeric strings like "0".
    """
    try:
        if value is None:
            return None
        # avoid bool being treated as int
        if isinstance(value, bool):
            return None
        return int(value)
    except Exception:
        try:
            return int(str(value))
        except Exception:
            return None


def _get_layer(raw: Dict[str, Any]) -> Optional[int]:
    """Fetch layer index from common keys and coerce to int if possible."""
    for k in ("layer", "L", "layer_index", "layerIndex"):
        L = _to_int(raw.get(k))
        if L is not None:
            return L
    return None


def _norm_feature_id(layer: Optional[int], idx_in_layer: int, raw_id: str) -> str:
    # Try to preserve if already normalized
    if raw_id.startswith("feature|"):
        return raw_id
    L = layer if layer is not None else -1
    return f"feature|{L}|{idx_in_layer}|0"


def _norm_token_id(pos: Optional[int], vocab: Optional[str], raw_id: str, index: int) -> str:
    if raw_id.startswith("token|"):
        return raw_id
    p = pos if pos is not None else index
    v = vocab if vocab is not None else "UNK"
    return f"token|{p}|{v}"


def _norm_logit_id(pos: Optional[int], vocab: Optional[str], raw_id: str, index: int) -> str:
    if raw_id.startswith("logit|"):
        return raw_id
    p = pos if pos is not None else index
    v = vocab if vocab is not None else "UNK"
    return f"logit|{p}|{v}"


def normalize_nodes_edges(raw_nodes: List[Dict[str, Any]], raw_edges: List[Dict[str, Any]]) -> Tuple[List[Node], List[Edge]]:
    # First pass: count features per layer to assign stable indices
    layer_counts: Dict[int, int] = {}
    feature_seq_per_layer: Dict[int, int] = {}
    for rn in raw_nodes:
        t = _infer_node_type(rn)
        if t == "feature":
            L_opt = _get_layer(rn)
            lkey = L_opt if L_opt is not None else -1
            layer_counts[lkey] = layer_counts.get(lkey, 0) + 1

    # Assign normalized ids
    nodes: List[Node] = []
    id_map: Dict[str, str] = {}
    token_i = 0
    logit_i = 0
    for rn in raw_nodes:
        # Choose from a broad set of id aliases seen in Neuronpedia / CT exports
        id_alias_keys = (
            "id",
            "node_id",
            "nodeId",
            "jsNodeId",
            "jsnodeid",
            "feature_id",
            "featureId",
            "feature",
        )
        orig_id_val: Optional[Any] = None
        for k in id_alias_keys:
            if k in rn and rn.get(k) is not None:
                orig_id_val = rn.get(k)
                break
        orig_id = str(orig_id_val) if orig_id_val is not None else f"auto|{len(nodes)}"
        t = _infer_node_type(rn) or rn.get("type", "feature")
        L = _get_layer(rn)
        meta_exclude = {
            "id",
            "type",
            "node_type",
            "kind",
            "layer",
            "L",
            "layer_index",
            "layerIndex",
            # id alias keys
            "node_id",
            "nodeId",
            "jsNodeId",
            "jsnodeid",
            "feature",
            "feature_id",
            "featureId",
        }
        meta = {k: v for k, v in rn.items() if k not in meta_exclude}
        if t == "feature":
            lkey = L if L is not None else -1
            seq = feature_seq_per_layer.get(lkey, 0)
            nid = _norm_feature_id(L, seq, orig_id)
            feature_seq_per_layer[lkey] = seq + 1
        elif t == "token":
            pos = rn.get("pos") or rn.get("position") or rn.get("token_pos")
            vocab = rn.get("vocab") or rn.get("token") or rn.get("text")
            nid = _norm_token_id(pos if isinstance(pos, int) else None, str(vocab) if vocab is not None else None, orig_id, token_i)
            token_i += 1
        elif t == "logit":
            pos = rn.get("pos") or rn.get("position")
            vocab = rn.get("vocab") or rn.get("token") or rn.get("text")
            nid = _norm_logit_id(pos if isinstance(pos, int) else None, str(vocab) if vocab is not None else None, orig_id, logit_i)
            logit_i += 1
        else:
            # default to feature
            lkey = L if L is not None else -1
            seq = feature_seq_per_layer.get(lkey, 0)
            nid = _norm_feature_id(L, seq, orig_id)
            feature_seq_per_layer[lkey] = seq + 1
            t = "feature"
        # Map all known aliases for this node to the normalized id
        for k in id_alias_keys:
            if k in rn and rn.get(k) is not None:
                id_map[str(rn.get(k))] = nid
        # Always map the chosen orig_id as well
        id_map[str(orig_id)] = nid
        nodes.append(Node(id=nid, type=t, layer=L, meta=meta))

    # Normalize edges
    edges: List[Edge] = []
    for re in raw_edges:
        s = (
            re.get("source")
            or re.get("src")
            or re.get("u")
            or re.get("from")
            or re.get("source_id")
            or re.get("sourceId")
            or re.get("s")
        )
        t = (
            re.get("target")
            or re.get("dst")
            or re.get("v")
            or re.get("to")
            or re.get("target_id")
            or re.get("targetId")
            or re.get("t")
        )
        w = re.get("weight") or re.get("w") or re.get("score") or re.get("influence") or 0.0
        if s is None or t is None:
            continue
        s = str(s)
        t = str(t)
        ns = id_map.get(s, s)
        nt = id_map.get(t, t)
        try:
            wf = float(w)
        except Exception:
            wf = 0.0
        edges.append(Edge(source=ns, target=nt, weight=wf))

    # If there are no edges, try to synthesize from per-node 'influence' to target logits
    if not edges:
        # Build a quick helper to get normalized id for a raw node record
        def _resolve_raw_id(rn: Dict[str, Any]) -> Optional[str]:
            for k in (
                "id",
                "node_id",
                "nodeId",
                "jsNodeId",
                "jsnodeid",
                "feature_id",
                "featureId",
                "feature",
            ):
                if k in rn and rn.get(k) is not None:
                    rid = str(rn.get(k))
                    return id_map.get(rid, rid)
            return None

        target_logits: List[str] = []
        for rn in raw_nodes:
            if bool(rn.get("is_target_logit")):
                nid = _resolve_raw_id(rn)
                if nid is not None:
                    target_logits.append(nid)

        # If we still have none, fall back to any node inferred/declared as type 'logit'
        if not target_logits:
            for rn in raw_nodes:
                inferred = _infer_node_type(rn)
                if inferred == "logit":
                    nid = _resolve_raw_id(rn)
                    if nid is not None:
                        target_logits.append(nid)

        # Create edges: each non-logit node with 'influence' connects to all target logits
        if target_logits:
            for rn in raw_nodes:
                # Skip target logits themselves
                if bool(rn.get("is_target_logit")):
                    continue
                # Influence may be missing or non-numeric
                influ = rn.get("influence")
                try:
                    w = float(influ) if influ is not None else None
                except Exception:
                    w = None
                if w is None:
                    continue
                src_id = _resolve_raw_id(rn)
                if src_id is None:
                    continue
                for tgt_id in target_logits:
                    edges.append(Edge(source=src_id, target=tgt_id, weight=w))

    return nodes, edges

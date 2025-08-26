import numpy as np

from app.models import Graph, Node, Edge
from app.pipeline import run_pipeline, snapshot
from app.schemas import RunRequest


def make_tiny_graph():
    nodes = [
        Node(id="feature|0|0|0", type="feature", layer=0),
        Node(id="feature|0|1|0", type="feature", layer=0),
        Node(id="feature|0|2|0", type="feature", layer=0),
        Node(id="logit|0|A", type="logit"),
        Node(id="logit|0|B", type="logit"),
    ]
    edges = [
        Edge(source="feature|0|0|0", target="logit|0|A", weight=1.0),
        Edge(source="feature|0|1|0", target="logit|0|A", weight=0.9),
        Edge(source="feature|0|1|0", target="logit|0|B", weight=0.1),
        Edge(source="feature|0|2|0", target="logit|0|B", weight=1.0),
    ]
    return Graph(nodes=nodes, edges=edges)


def test_candidate_topk_and_run_merges():
    g = make_tiny_graph()
    req = RunRequest(
        tau_sim=0.98,
        alpha=0.90,
        beta=0.05,
        layer_whitelist=None,
        gate_enabled=True,
        similarity_metric="cosine",
        fingerprint_source="adjacency",
        normalize_fingerprints=True,
        topk_candidates_per_node=1,
        max_pairs_per_layer=0,
        max_merges=0,
        min_group_size_postfilter=1,
        seed=123,
    )
    state = run_pipeline(g, req)
    # Only (f0,f1) should be candidate at tau=0.98 and topk=1
    assert state.candidates_count >= 1
    assert len(state.merge_log) >= 1
    # Replay snapshots
    s0 = snapshot(state, step=0)
    sN = snapshot(state, step=state.timeline_len())
    assert s0.metrics.num_groups >= sN.metrics.num_groups
    assert sN.cr >= s0.cr

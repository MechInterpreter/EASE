from app.models import Graph, Node, Edge
from app.pipeline import run_pipeline, snapshot
from app.schemas import RunRequest


def tiny_graph():
    nodes = [
        Node(id="feature|0|0|0", type="feature", layer=0),
        Node(id="feature|0|1|0", type="feature", layer=0),
        Node(id="logit|0|A", type="logit"),
    ]
    edges = [
        Edge(source="feature|0|0|0", target="logit|0|A", weight=1.0),
        Edge(source="feature|0|1|0", target="logit|0|A", weight=1.0),
    ]
    return Graph(nodes=nodes, edges=edges)


def test_replay_deterministic_with_seed():
    g = tiny_graph()
    req = RunRequest()
    s1 = run_pipeline(g, req)
    s2 = run_pipeline(g, req)
    # Compare merge logs length and content
    assert len(s1.merge_log) == len(s2.merge_log)
    for a, b in zip(s1.merge_log, s2.merge_log):
        assert a.model_dump() == b.model_dump()
    snap1 = snapshot(s1, step=s1.timeline_len())
    snap2 = snapshot(s2, step=s2.timeline_len())
    assert snap1.model_dump() == snap2.model_dump()

from __future__ import annotations

from io import StringIO
from typing import Dict, List

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, PlainTextResponse
import httpx

from .config import config
from .loader import load_graph, set_graph_from_raw, validate_raw
from .pipeline import get_current_run, run_pipeline, snapshot
from .schemas import (
    GraphInfo,
    LayoutType,
    MergeEvent,
    RunRequest,
    RunStats,
    RunSummary,
    Snapshot,
    LoadUrlRequest,
    GraphValidation,
)

app = FastAPI(title="EASE Backend", version="0.1.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/graph/info", response_model=GraphInfo)
def api_graph_info(graph: str | None = Query(default=None, description="Optional URL to load a graph before returning info")) -> GraphInfo:
    # Optional: if a 'graph' URL is provided, fetch and set before returning info
    if graph:
        try:
            with httpx.Client(timeout=15) as client:
                r = client.get(graph)
                r.raise_for_status()
                raw = r.json()
            set_graph_from_raw(raw)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to load graph from URL: {e}")
    g = load_graph()
    num_nodes, num_edges = g.counts()
    # layer histogram over features
    layer_hist: Dict[int, int] = {}
    for fid in g.feature_ids:
        L = g.layer_of(fid)
        key = -1 if L is None else int(L)
        layer_hist[key] = layer_hist.get(key, 0) + 1
    # Present layers as a contiguous range (min..max) for UI completeness
    present_layers = g.layers
    if present_layers:
        mn, mx = int(min(present_layers)), int(max(present_layers))
        layers = list(range(mn, mx + 1))
    else:
        layers = []
    return GraphInfo(
        num_nodes=num_nodes,
        num_edges=num_edges,
        layers=layers,
        layer_hist=layer_hist,
        logit_ids=g.logit_ids,
    )


@app.post("/api/run", response_model=RunSummary)
def api_run(req: RunRequest) -> RunSummary:
    g = load_graph()
    state = run_pipeline(g, req)
    # Stats
    num_features = len(state.feature_ids)
    groups = state.dsu.groups()
    num_groups = sum(1 for m in groups.values() if len(m) >= 1)
    cr = (num_features / num_groups) if num_groups > 0 else 1.0
    stats = RunStats(
        num_candidates=state.candidates_count,
        num_accepted=len(state.merge_log),
        cr=cr,
        layers=list(state.layer_to_indices.keys()),
        timeline_len=state.timeline_len(),
    )
    return RunSummary(
        params=req.model_dump(),
        stats=stats,
        merge_log=state.merge_log,
    )


@app.get("/api/replay", response_model=Snapshot)
def api_replay(
    step: int = Query(0, ge=0),
    edge_opacity_threshold: float = Query(0.1, ge=0.0, le=1.0),
    layout: LayoutType = Query("force"),
) -> Snapshot:
    state = get_current_run()
    if state is None:
        raise HTTPException(status_code=400, detail="No run state; POST /api/run first")
    snap = snapshot(state, step=step, edge_opacity_threshold=edge_opacity_threshold)
    # layout is currently handled client-side; included for API parity
    return snap


@app.post("/api/graph/load/url", response_model=GraphValidation)
def api_graph_load_url(req: LoadUrlRequest) -> GraphValidation:
    try:
        with httpx.Client(timeout=30) as client:
            r = client.get(req.url)
            r.raise_for_status()
            raw = r.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {e}")
    g, notes = set_graph_from_raw(raw)
    # Build info
    num_nodes, num_edges = g.counts()
    layer_hist: Dict[int, int] = {}
    for fid in g.feature_ids:
        L = g.layer_of(fid)
        key = -1 if L is None else int(L)
        layer_hist[key] = layer_hist.get(key, 0) + 1
    # Present layers as a contiguous range (min..max)
    present_layers = g.layers
    if present_layers:
        mn, mx = int(min(present_layers)), int(max(present_layers))
        layers = list(range(mn, mx + 1))
    else:
        layers = []
    info = GraphInfo(num_nodes=num_nodes, num_edges=num_edges, layers=layers, layer_hist=layer_hist, logit_ids=g.logit_ids)
    return GraphValidation(info=info, notes=notes)


@app.post("/api/graph/upload", response_model=GraphValidation)
async def api_graph_upload(file: UploadFile = File(...)) -> GraphValidation:
    try:
        data = await file.read()
        import orjson

        raw = orjson.loads(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read JSON: {e}")
    g, notes = set_graph_from_raw(raw)
    num_nodes, num_edges = g.counts()
    layer_hist: Dict[int, int] = {}
    for fid in g.feature_ids:
        L = g.layer_of(fid)
        key = -1 if L is None else int(L)
        layer_hist[key] = layer_hist.get(key, 0) + 1
    # Present layers as a contiguous range (min..max)
    present_layers = g.layers
    if present_layers:
        mn, mx = int(min(present_layers)), int(max(present_layers))
        layers = list(range(mn, mx + 1))
    else:
        layers = []
    info = GraphInfo(num_nodes=num_nodes, num_edges=num_edges, layers=layers, layer_hist=layer_hist, logit_ids=g.logit_ids)
    return GraphValidation(info=info, notes=notes)


@app.post("/api/graph/validate", response_model=GraphValidation)
async def api_graph_validate(file: UploadFile = File(...)) -> GraphValidation:
    try:
        data = await file.read()
        import orjson

        raw = orjson.loads(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read JSON: {e}")
    g, notes = validate_raw(raw)
    num_nodes, num_edges = g.counts()
    layer_hist: Dict[int, int] = {}
    for fid in g.feature_ids:
        L = g.layer_of(fid)
        key = -1 if L is None else int(L)
        layer_hist[key] = layer_hist.get(key, 0) + 1
    # Present layers as a contiguous range (min..max)
    present_layers = g.layers
    if present_layers:
        mn, mx = int(min(present_layers)), int(max(present_layers))
        layers = list(range(mn, mx + 1))
    else:
        layers = []
    info = GraphInfo(num_nodes=num_nodes, num_edges=num_edges, layers=layers, layer_hist=layer_hist, logit_ids=g.logit_ids)
    return GraphValidation(info=info, notes=notes)


@app.get("/api/export/merge_log.json")
def api_export_merge_log() -> ORJSONResponse:
    state = get_current_run()
    if state is None:
        raise HTTPException(status_code=400, detail="No run state; POST /api/run first")
    payload = [me.model_dump() for me in state.merge_log]
    resp = ORJSONResponse(content=payload)
    resp.headers["Content-Disposition"] = 'attachment; filename="merge_log.json"'
    return resp


@app.get("/api/export/groups.csv")
def api_export_groups_csv() -> PlainTextResponse:
    state = get_current_run()
    if state is None:
        raise HTTPException(status_code=400, detail="No run state; POST /api/run first")
    # Build final groups from DSU
    groups = state.dsu.groups()
    # Optional post-filter by size
    min_sz = max(1, int(state.params.min_group_size_postfilter))
    out = StringIO()
    out.write("group_id,layer,size,members\n")
    for root, members in groups.items():
        if len(members) < min_sz:
            continue
        member_ids = [state.feature_ids[i] for i in members]
        Ls = {state.feature_layers[i] for i in members if state.feature_layers[i] is not None}
        L = list(Ls)[0] if Ls else -1
        gid = f"super|{L}|{root}"
        out.write(f"{gid},{int(L)},{len(members)},\"{';'.join(member_ids)}\"\n")
    txt = out.getvalue()
    resp = PlainTextResponse(txt, media_type="text/csv")
    resp.headers["Content-Disposition"] = 'attachment; filename="groups.csv"'
    return resp

@app.get("/api/export/graph.json")
def api_export_graph_json() -> ORJSONResponse:
    g = load_graph()
    nodes = [
        {"id": n.id, "type": n.type, "layer": n.layer, "meta": n.meta} for n in g.nodes
    ]
    edges = [
        {"source": e.source, "target": e.target, "weight": e.weight} for e in g.edges
    ]
    payload = {"nodes": nodes, "edges": edges}
    resp = ORJSONResponse(content=payload)
    resp.headers["Content-Disposition"] = 'attachment; filename="graph.json"'
    return resp

# Optional: health
@app.get("/api/health")
def api_health():
    return {"status": "ok"}

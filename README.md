# EASE: Automated Supernode Discovery & Replay Demo

Prototype demo for automated discovery of supernodes (merging similar features) and interactive replay/visualization.

- Backend: FastAPI (Python 3.11)
- Frontend: React + Vite + Tailwind + shadcn/ui + d3-force (Node 20)

## Quickstart

1) Copy the attribution graph

- Source: `circuit-tracer/charlotte_neuronpedia.json`
- Destination: `ease/data/charlotte_neuronpedia.json`

2) Backend

```bash
# From repo root
cd backend
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -U pip
pip install -e .
uvicorn app.main:app --reload --port 8000
```

3) Frontend

```bash
cd frontend
npm i
npm run dev
```

Then visit http://localhost:5173

Click Run with defaults to build candidates, gate, and merge. Scrub timeline using the slider.

## API overview

- `POST /api/run` → run proposals + gating + merging
- `GET /api/replay?step=k&edge_opacity_threshold=0.1&layout=force` → snapshot at step k
- `GET /api/export/merge_log.json` → download merge log
- `GET /api/export/groups.csv` → download groups CSV
- `GET /api/graph/info` → basic graph info (counts, layers, logits)

## Data format

Expected Neuronpedia-style JSON with nodes and edges. IDs are normalized to:

- Feature: `feature|L|A|P`
- Token: `token|pos|vocab`
- Logit: `logit|pos|vocab`

If fields differ, the backend loader includes a small adapter to normalize.

To point at a different graph, set env var `EASE_DATA_PATH` to a JSON file or replace `data/charlotte_neuronpedia.json`.

## Makefile targets

- `make dev` → run backend (uvicorn, reload) + frontend (vite) concurrently
- `make backend` → start backend
- `make frontend` → start frontend
- `make test` → run backend unit tests

## Dev tooling

- Pre-commit (backend only) with black, isort, ruff

```bash
cd backend
pre-commit install
```

## Repository structure

```
 ease/
 ├─ backend/                 # FastAPI app, tests, pre-commit
 ├─ frontend/                # React + Vite + Tailwind + shadcn/ui
 ├─ data/                    # Attribution graph JSON lives here
 ├─ scripts/                 # helper scripts
 ├─ Makefile
 ├─ LICENSE
 └─ README.md
```

## GitHub remote (optional)

If GitHub CLI is available and you want to push:

```bash
# From repo root
gh repo create ease --public --source=. --remote=origin --push
```

Or set the remote later with:

```bash
git remote add origin <YOUR_GH_REPO_URL>
git push -u origin main
```

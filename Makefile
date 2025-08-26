SHELL := /bin/sh

.PHONY: dev backend frontend test

DEV_SCRIPT=python scripts/dev.py

# Run backend (uvicorn) + frontend (vite) concurrently
dev:
	$(DEV_SCRIPT)

# Start backend server
backend:
	cd backend && uvicorn app.main:app --reload --port 8000

# Start frontend dev server
frontend:
	cd frontend && npm run dev

# Run backend tests
test:
	cd backend && pytest -q && ../scripts/push_on_change.sh || true

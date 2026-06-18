.PHONY: dev play backend backend-dev frontend frontend-dev install seed build stop

PORT ?= 7500

install:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
	cd frontend && bash ../scripts/npm.sh install

backend:
	cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $(PORT)

backend-dev:
	cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $(PORT) --reload --reload-dir app --reload-exclude '.venv'

# Serves pre-built assets — no file watchers (recommended)
frontend:
	bash scripts/dev-frontend.sh

# Hot-reload dev server — may fail if system open-file limit is low
frontend-dev:
	bash scripts/dev-frontend-hot.sh

# Easiest: one terminal, one port (7500) for LAN play
play:
	bash scripts/play.sh

dev:
	@echo "Recommended: make play"
	@echo "Or: make backend  +  make frontend  (in two terminals)"

seed:
	cd backend && .venv/bin/python seed.py

build:
	cd frontend && bash ../scripts/npm.sh run build

stop:
	@fuser -k $(PORT)/tcp 2>/dev/null && echo "Stopped process on port $(PORT)" || echo "Nothing listening on port $(PORT)"
	@fuser -k 5173/tcp 2>/dev/null && echo "Stopped process on port 5173" || true

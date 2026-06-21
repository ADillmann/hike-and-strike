# Hike&strike

Browser-based tabletop RPG for local network play. Master organizes campaigns; players join with credentials and control their characters.

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind
- **Backend:** FastAPI + SQLite + WebSockets
- **Phase 1:** Auth, character creation, events, campaigns, rewards/punishments, master stat editing
- **Phase 2:** Battle system (stubbed in UI)

## Quick start

### 1. Install dependencies

From the **hike-and-strike** repository root:

```bash
make install
```

### 2. Run

**Easiest (one terminal, one port — best for LAN):**
```bash
make play
```
Open **http://\<your-machine-ip\>:7500** from any device on the network.

**Or two terminals:**
```bash
# Terminal 1
make backend

# Terminal 2 — serves built frontend without file watchers
make frontend
```
Open **http://localhost:5173** (proxies API to backend on 7500).

`make frontend` uses `vite preview` (no hot-reload) to avoid "too many open files" errors.
For hot-reload during UI development, try `make frontend-dev` (may still fail on low system limits).

If you see `Address already in use`:
```bash
make stop
```

### 3. First launch

1. Open http://localhost:5173 (or http://\<your-lan-ip\>:5173 from other devices)
2. Create the **Master** account on first visit
3. Master: create player users, groups, events, campaigns
4. Players: log in with master-provided credentials and create characters

## LAN access

The backend binds to `0.0.0.0:7500`. For other devices on your network:

1. Find your host IP: `hostname -I`
2. Run frontend dev server with host exposure:
   ```bash
   cd frontend && npm run dev -- --host 0.0.0.0
   ```
3. Players connect to `http://<your-ip>:5173`

For production-like LAN deploy, build the frontend and serve from FastAPI:

```bash
make build
make backend
# Open http://<your-ip>:7500
```

## Master workflow

1. **Users** — Create player accounts (username + password)
2. **Groups** — Assign characters to adventure parties
3. **Events** — Build story/rest/puzzle events (generic events seeded: Bonfire, House, Shop, etc.)
4. **Items** — Manage loot pool (base items seeded on first run)
5. **Campaigns** — Chain events, assign group, start campaign
6. **Campaign Control** — Evaluate outcomes, jump to any event, grant rewards/punishments, edit stats permanently

## Player workflow

1. Log in → create character (point-buy stats, race, skills)
2. View character sheet, inventory, skills
3. When campaign is active, follow along on Campaign page (live updates via WebSocket)

## API

- REST: `http://localhost:7500/api`
- WebSocket: `ws://localhost:7500/ws/campaigns/{id}?token=...`
- Uploads: `http://localhost:7500/uploads/...`

## Project structure

```
hike-and-strike/
├── backend/          # FastAPI app
├── frontend/         # React app
├── uploads/          # Character portraits, event images
├── Makefile
└── README.md
```

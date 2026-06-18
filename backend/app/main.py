from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.routers import (
    auth,
    battles,
    campaign_runtime,
    campaigns,
    characters,
    enemies,
    events,
    groups,
    items,
    player_campaign,
    users,
    websocket,
)
from seed import seed_data


@asynccontextmanager
async def lifespan(_: FastAPI):
    import app.models  # noqa: F401 — register models

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_data(db)
    finally:
        db.close()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = FastAPI()
api.include_router(auth.router)
api.include_router(users.router)
api.include_router(characters.router)
api.include_router(groups.router)
api.include_router(events.router)
api.include_router(items.router)
api.include_router(campaigns.router)
api.include_router(campaign_runtime.router)
api.include_router(player_campaign.router)
api.include_router(enemies.router)
api.include_router(battles.router)

app.mount("/api", api)
app.include_router(websocket.router)
app.mount("/uploads", StaticFiles(directory=str(settings.uploads_dir)), name="uploads")

frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.routers import (
    auth,
    battles,
    campaign_runtime,
    campaigns,
    characters,
    classes,
    currency,
    enemies,
    events,
    effects,
    groups,
    items,
    player_campaign,
    secrets,
    skills,
    users,
    websocket,
)
from seed import seed_data


class SPAStaticFiles(StaticFiles):
    """Serve built frontend; fall back to index.html for client-side routes."""

    async def get_response(self, path: str, scope):
        serve_index = path in ("", ".", "index.html")
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and scope["method"] in ("GET", "HEAD"):
                index_path = Path(self.directory) / "index.html"
                if index_path.is_file():
                    response = FileResponse(index_path)
                    serve_index = True
                else:
                    raise
            else:
                raise
        # Always revalidate the shell so clients pick up new hashed asset names
        if serve_index:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response

@asynccontextmanager
async def lifespan(_: FastAPI):
    import app.models  # noqa: F401 — register models

    Base.metadata.create_all(bind=engine)
    from app.db_migrations import apply_schema_patches

    apply_schema_patches(engine)
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
api.include_router(skills.router)
api.include_router(classes.router)
api.include_router(effects.router)
api.include_router(secrets.router)
api.include_router(currency.router)
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
    app.mount("/", SPAStaticFiles(directory=str(frontend_dist), html=True), name="frontend")

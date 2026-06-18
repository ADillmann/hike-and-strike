from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Hike&strike"
    secret_key: str = "change-me-in-production-use-env-var"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    database_url: str = f"sqlite:///{Path(__file__).resolve().parent.parent / 'hike_and_strike.db'}"
    uploads_dir: Path = Path(__file__).resolve().parent.parent.parent / "uploads"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    host: str = "0.0.0.0"
    port: int = 7500

    class Config:
        env_file = ".env"


settings = Settings()
settings.uploads_dir.mkdir(parents=True, exist_ok=True)

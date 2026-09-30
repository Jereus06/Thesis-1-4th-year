from functools import lru_cache
from pathlib import Path

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: PostgresDsn
    app_env: str = "development"
    host: str = "127.0.0.1"
    port: int = Field(default=3001, ge=1, le=65535)
    cors_origin: str = "http://localhost:5173"
    session_hours: int = Field(default=12, ge=1, le=168)
    artifact_dir: Path = Path("data/models")
    forecast_poll_seconds: int = Field(default=5, ge=1, le=3600)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

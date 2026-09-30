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
    node_env: str = "development"
    host: str = "127.0.0.1"
    port: int = Field(default=3001, ge=1, le=65535)
    cors_origin: str = "http://127.0.0.1:5173"
    session_hours: int = Field(default=12, ge=1, le=168)
    artifact_dir: Path = Path("data/models")
    forecast_poll_seconds: int = Field(default=5, ge=1, le=3600)


class BootstrapSettings(BaseSettings):
    """Owner bootstrap values loaded from the same backend environment file."""

    model_config = Settings.model_config

    owner_business_id: str
    owner_business_name: str
    owner_data_origin: str = "demo"
    owner_email: str
    owner_display_name: str
    owner_password: str = Field(min_length=12)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

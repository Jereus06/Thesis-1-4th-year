from functools import lru_cache
from pathlib import Path
from uuid import UUID

from pydantic import EmailStr, Field, PostgresDsn, SecretStr
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
    cors_origin: str = "http://127.0.0.1:5173"
    session_hours: int = Field(default=12, ge=1, le=168)
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = ""
    artifact_dir: Path = Path("data/models")
    forecast_poll_seconds: int = Field(default=5, ge=1, le=3600)
    forecast_daily_enabled: bool = True
    forecast_daily_time: str = Field(
        default="00:15", pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$"
    )
    forecast_schedule_poll_seconds: int = Field(default=60, ge=1, le=60)
    owner_business_id: UUID = UUID("00000000-0000-4000-8000-000000000001")
    owner_business_name: str = "StockCast Store"
    owner_data_origin: str = "demo"
    owner_email: EmailStr = "owner@example.com"
    owner_display_name: str = "Store Owner"
    owner_password: str = ""
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""
    smtp_starttls: bool = True
    public_app_url: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

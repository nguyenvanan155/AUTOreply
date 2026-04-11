"""GBP Auto-Reply — Application Configuration."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────
    app_name: str = "gbp-auto-reply"
    app_env: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    secret_key: SecretStr = SecretStr("change-me")
    admin_password: SecretStr = SecretStr("change-me")
    log_level: str = "INFO"

    # ── Database ──────────────────────────────────────────────
    database_url: str = "postgresql+psycopg2://gbp_user:gbp_pass@localhost:5432/gbp_auto_reply"
    async_database_url: str = "postgresql+asyncpg://gbp_user:gbp_pass@localhost:5432/gbp_auto_reply"

    # ── Redis ─────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── Celery ────────────────────────────────────────────────
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ── Google OAuth 2.0 ──────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = "http://localhost:8000/oauth/callback"

    # ── Google Sheets (BACKEND-ONLY — never exposed in UI) ────
    template_spreadsheet_id: str = ""
    template_worksheet_name: str = "Sheet1"
    template_range: str = "A:A"
    template_cache_ttl_seconds: int = 300

    # ── Token Encryption ──────────────────────────────────────
    token_encryption_key: SecretStr = SecretStr("")

    # ── Scheduler ─────────────────────────────────────────────
    default_schedule_interval_minutes: int = 60
    scheduler_tick_interval_seconds: int = 60

    # ── Rate Limiting ─────────────────────────────────────────
    gbp_api_rate_limit_per_minute: int = 60
    sheets_api_rate_limit_per_minute: int = 30

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache()
def get_settings() -> Settings:
    """Singleton settings instance."""
    return Settings()

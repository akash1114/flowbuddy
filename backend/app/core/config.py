"""Application configuration managed via environment variables."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "FlowBuddy Backend"
    debug: bool = False
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/flowbuddy"
    opik_enabled: bool = False
    opik_api_key: str | None = None
    opik_project: str = "flowbuddy"


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


settings = get_settings()

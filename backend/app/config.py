from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str  # runtime role (kmk_app)
    migration_database_url: str | None = None  # owner role (kmk); falls back to database_url
    session_secret: str = "dev-only-change-me"
    cookie_secure: bool = True
    allowed_origins: list[str] = ["https://app.kmk-entretien.ca"]
    session_days: int = 5
    rl_ip_max: int = 10
    rl_identifier_max: int = 5
    rl_window_minutes: int = 15
    trusted_proxy_ips: list[str] = ["127.0.0.1", "::1"]
    api_host: str = "127.0.0.1"
    api_port: int = 8001


@lru_cache
def get_settings() -> Settings:
    return Settings()

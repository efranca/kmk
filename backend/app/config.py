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
    email_backend: str = "log"  # "log" (dev: prints the message) or "resend"
    resend_api_key: str | None = None
    email_from: str = "KMK Entretien <no-reply@mail.kmk-entretien.ca>"
    public_base_url: str = "https://app.kmk-entretien.ca"
    invite_hours: int = 48
    reset_minutes: int = 30
    mfa_encryption_key: str | None = None  # Fernet key; without it the MFA endpoints answer 503
    mfa_required_roles: str = ""  # comma-separated roles forced to use TOTP; empty = nobody is forced
    mfa_issuer: str = "KMK Entretien"
    vapid_public_key: str | None = None  # Web Push (python -m app.cli vapid-keys); without them nothing is pushed
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:admin@kmk-entretien.ca"
    api_host: str = "127.0.0.1"
    api_port: int = 8001

    @property
    def required_roles(self) -> set[str]:
        return {r.strip() for r in self.mfa_required_roles.split(",") if r.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()

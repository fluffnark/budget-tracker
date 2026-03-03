import base64

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_master_key() -> str:
    # Deterministic non-secret fallback for local dev/test when env is absent.
    raw = b"budget-tracker-local-dev-master-key"
    return base64.urlsafe_b64encode(raw.ljust(32, b"0")[:32]).decode("utf-8")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", case_sensitive=False)

    database_url: str = "postgresql+psycopg://budget:budget@db:5432/budget"
    master_key: str = Field(default_factory=_default_master_key)
    session_secret: str = "dev-session-secret"
    log_level: str = "INFO"
    simplefin_mock: bool = False
    categorization_suggestions: bool = False
    auto_categorization: bool = True
    simplefin_initial_history_days: int = 365
    simplefin_max_window_days: int = 60
    sync_daily_hour: int = 6
    sync_daily_minute: int = 0
    testing: bool = False

    @property
    def is_dev_fallback_master_key(self) -> bool:
        return self.master_key == _default_master_key()


settings = Settings()

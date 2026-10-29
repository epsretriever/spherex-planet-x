"""Runtime settings, overridable through environment variables (prefix SPX_)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _env(name: str, default: str) -> str:
    return os.environ.get(f"SPX_{name}", default)


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(
        default_factory=lambda: Path(_env("DATA_DIR", str(BACKEND_ROOT / "var")))
    )
    s3_base_url: str = field(
        default_factory=lambda: _env(
            "S3_BASE_URL", "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com"
        )
    )
    irsa_tap_url: str = field(
        default_factory=lambda: _env("IRSA_TAP_URL", "https://irsa.ipac.caltech.edu/TAP")
    )
    irsa_base_url: str = field(
        default_factory=lambda: _env("IRSA_BASE_URL", "https://irsa.ipac.caltech.edu")
    )
    sbident_url: str = field(
        default_factory=lambda: _env("SBIDENT_URL", "https://ssd-api.jpl.nasa.gov/sb_ident.api")
    )
    horizons_url: str = field(
        default_factory=lambda: _env("HORIZONS_URL", "https://ssd.jpl.nasa.gov/api/horizons.api")
    )
    http_timeout_s: float = field(default_factory=lambda: float(_env("HTTP_TIMEOUT_S", "60")))
    http_retries: int = field(default_factory=lambda: int(_env("HTTP_RETRIES", "4")))
    max_parallel_requests: int = field(default_factory=lambda: int(_env("MAX_PARALLEL", "8")))

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def products_dir(self) -> Path:
        return self.data_dir / "products"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def set_settings(settings: Settings) -> None:
    global _settings
    _settings = settings

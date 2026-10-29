"""Shared HTTP client with retries and exponential backoff."""

from __future__ import annotations

import logging
import threading
import time

import httpx

from ..settings import get_settings

log = logging.getLogger(__name__)

_RETRY_STATUS = {429, 500, 502, 503, 504}
_local = threading.local()


class UpstreamError(RuntimeError):
    """An upstream service failed or could not be reached."""


def client() -> httpx.Client:
    """One client per thread (httpx clients are not shared across threads here)."""
    c = getattr(_local, "client", None)
    if c is None:
        settings = get_settings()
        c = httpx.Client(
            timeout=settings.http_timeout_s,
            follow_redirects=True,
            headers={
                "User-Agent": "spherex-planet-x/0.1 (+https://github.com/epsretriever/spherex-planet-x)"
            },
        )
        _local.client = c
    return c


def request(method: str, url: str, **kwargs) -> httpx.Response:
    """Send a request, retrying network errors and 429/5xx with backoff (1, 2, 4, 8 s)."""
    retries = get_settings().http_retries
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = client().request(method, url, **kwargs)
        except httpx.TransportError as exc:
            last = exc
            log.warning("%s %s failed (%s), attempt %d", method, url, exc, attempt + 1)
        else:
            if resp.status_code not in _RETRY_STATUS:
                return resp
            last = UpstreamError(f"{method} {url} -> HTTP {resp.status_code}")
            log.warning("%s, attempt %d", last, attempt + 1)
        if attempt < retries:
            time.sleep(2**attempt)
    raise UpstreamError(f"{method} {url} failed after {retries + 1} attempts: {last}") from last


def reachable(url: str, timeout_s: float = 5.0) -> tuple[bool, str | None]:
    """Quick reachability probe for /api/health (any HTTP response counts as reachable)."""
    try:
        resp = client().get(url, timeout=timeout_s)
    except httpx.HTTPError as exc:
        return False, type(exc).__name__
    return True, f"HTTP {resp.status_code}"

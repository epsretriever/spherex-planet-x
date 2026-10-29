"""pipeline_version: package version plus the git commit it was built from."""

from __future__ import annotations

import functools
import subprocess
from pathlib import Path

from . import __version__


@functools.cache
def pipeline_version() -> str:
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return __version__
    return f"{__version__}+git.{sha}" if sha else __version__

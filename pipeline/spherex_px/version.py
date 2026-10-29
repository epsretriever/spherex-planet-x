"""Version and run identity stamped into every file the pipeline publishes.

pipeline_version is "<package version>+git.<commit>": the commit of the pipeline code that
produced the data. In GitHub Actions the commit and run come from GITHUB_SHA and
GITHUB_RUN_ID. Locally the commit is HEAD, and building from uncommitted pipeline code is
refused (set SPX_ALLOW_DIRTY=1 to override; the version then ends in ".dirty"), so published
data always names a commit that exists.
"""

from __future__ import annotations

import functools
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from . import __version__

PIPELINE_DIR = Path(__file__).resolve().parents[1]


class DirtyTreeError(RuntimeError):
    """The pipeline code has uncommitted changes, so no commit describes the build."""


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=PIPELINE_DIR, capture_output=True, text=True, check=True, timeout=10
    ).stdout.strip()


@functools.cache
def build_commit() -> tuple[str | None, bool]:
    """(short commit, dirty) for the pipeline code."""
    sha = os.environ.get("GITHUB_SHA")
    if sha:
        return sha[:7], False
    try:
        head = _git("rev-parse", "--short=7", "HEAD")
        dirty = bool(_git("status", "--porcelain", "--untracked-files=no", "--", str(PIPELINE_DIR)))
    except (OSError, subprocess.SubprocessError):
        return None, False
    return head or None, dirty


def pipeline_version(require_clean: bool = False) -> str:
    sha, dirty = build_commit()
    if dirty and require_clean and os.environ.get("SPX_ALLOW_DIRTY") != "1":
        raise DirtyTreeError(
            "pipeline/ has uncommitted changes; commit them first so the data names a real "
            "commit (or set SPX_ALLOW_DIRTY=1 for a throwaway build)"
        )
    if not sha:
        return __version__
    return f"{__version__}+git.{sha}{'.dirty' if dirty else ''}"


@functools.cache
def build_run_id() -> str:
    """Identifier of this build run: the GitHub Actions run, or a local timestamped run."""
    run = os.environ.get("GITHUB_RUN_ID")
    if run:
        return f"gh-{run}-{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}"
    sha, _ = build_commit()
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"local-{stamp}-{sha or 'nogit'}"

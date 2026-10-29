import pytest

from spherex_px import version


def _reset():
    version.build_commit.cache_clear()
    version.build_run_id.cache_clear()


def test_ci_uses_github_sha_and_run(monkeypatch):
    monkeypatch.setenv("GITHUB_SHA", "0123456789abcdef")
    monkeypatch.setenv("GITHUB_RUN_ID", "42")
    monkeypatch.setenv("GITHUB_RUN_ATTEMPT", "2")
    _reset()
    assert version.pipeline_version().endswith("+git.0123456")
    assert version.build_run_id() == "gh-42-2"
    _reset()


def test_dirty_tree_is_refused(monkeypatch):
    monkeypatch.delenv("GITHUB_SHA", raising=False)
    monkeypatch.delenv("SPX_ALLOW_DIRTY", raising=False)
    monkeypatch.setattr(version, "build_commit", lambda: ("abc1234", True))
    with pytest.raises(version.DirtyTreeError):
        version.pipeline_version(require_clean=True)
    monkeypatch.setenv("SPX_ALLOW_DIRTY", "1")
    assert version.pipeline_version(require_clean=True).endswith("+git.abc1234.dirty")


def test_clean_local_build(monkeypatch):
    monkeypatch.delenv("GITHUB_RUN_ID", raising=False)
    monkeypatch.setattr(version, "build_commit", lambda: ("abc1234", False))
    assert version.pipeline_version(require_clean=True).endswith("+git.abc1234")

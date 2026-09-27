"""The compatibility check: features switch off cleanly when a Hermes update drops an internal."""

import importlib.util
import sys
from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1] / "plugin"


@pytest.fixture()
def compat(tmp_path, monkeypatch):
    # A stand-in "Hermes" on sys.path: one module has what we need, one lost a name.
    pkg = tmp_path / "fakehermes"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "good.py").write_text("_active = {}\nSUFFIX: str = '::x'\ndef helper():\n    pass\nfrom os import path as joined\n")
    (pkg / "old.py").write_text("def renamed_helper():\n    pass\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    spec = importlib.util.spec_from_file_location("hermes_mobile_compat_under_test", PLUGIN / "compat.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    sys.modules.pop("fakehermes", None)


def test_finds_functions_assignments_and_imports(compat):
    assert compat.check_one("fakehermes.good", ["_active", "SUFFIX", "helper", "joined"]) == (True, "ok")


def test_reports_what_a_hermes_update_removed(compat):
    ok, detail = compat.check_one("fakehermes.old", ["helper"])
    assert not ok and "no longer defines helper" in detail


def test_missing_module(compat):
    ok, detail = compat.check_one("fakehermes.gone", ["x"])
    assert not ok and "not found" in detail


def test_features_turn_off_with_their_internals(compat, monkeypatch):
    compat.report.cache_clear()
    monkeypatch.setattr(compat, "REQUIREMENTS", {
        key: ("fakehermes.good", ["_active"], purpose) for key, (_m, _n, purpose) in compat.REQUIREMENTS.items()
    } | {"turn_cleanup": ("fakehermes.old", ["cleanup_browser"], "keeping browsers open between turns")})
    features = compat.features()
    assert features["browser_share"] is True
    assert features["browsers_kept_between_turns"] is False
    assert any("turn_cleanup" in p for p in compat.problems())
    compat.report.cache_clear()

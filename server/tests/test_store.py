"""Unit tests for the hermes-mobile plugin's shared store, with Hermes stubbed out (runs without Hermes)."""

import importlib.util
import sys
import time
import types
from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1] / "plugin"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    constants = types.ModuleType("hermes_constants")
    constants.get_default_hermes_root = lambda: tmp_path / "hermes"
    constants.socket_safe_tmpdir = lambda: str(tmp_path / "sock")
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    spec = importlib.util.spec_from_file_location("hermes_mobile_store_under_test", PLUGIN / "store.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_browser(monkeypatch, sessions):
    bt = types.ModuleType("tools.browser_tool")
    bt._active_sessions = sessions
    bt._LOCAL_SUFFIX = "::local"
    bt._REAL_PROFILE_SESSION = "hermes-real-profile"
    monkeypatch.setitem(sys.modules, "tools.browser_tool", bt)
    return bt


def write_stream_port(tmp_path, name, port):
    folder = tmp_path / "sock" / f"agent-browser-{name}"
    folder.mkdir(parents=True)
    (folder / f"{name}.stream").write_text(str(port))


def test_handoff_lifecycle(store):
    handoff = store.create("task-1", "  Log in to Bitbucket  ", "session-9")
    assert handoff["reason"] == "Log in to Bitbucket"
    assert [h["id"] for h in store.open_handoffs(["task-1"])] == [handoff["id"]]
    assert [h["id"] for h in store.open_handoffs(["session-9"])] == [handoff["id"]]
    assert store.open_handoffs(["other"]) == []
    assert store.finish(handoff["id"], "done") is True
    assert store.finish(handoff["id"], "done") is False  # only a waiting handoff can finish
    assert store.get(handoff["id"])["status"] == "done"
    assert store.open_handoffs(["task-1"]) == []


def test_ids_cannot_escape_the_store(store):
    assert store.get("../../etc/passwd") is None
    assert store.finish("../x", "done") is False


def test_old_handoffs_are_pruned(store):
    handoff = store.create("task-1", "x")
    path = store._path(handoff["id"])
    record = store.get(handoff["id"])
    record["created_at"] = time.time() - store.WAIT_SECONDS * 3
    store._write(record)
    assert store.open_handoffs(["task-1"]) == []
    assert not path.exists()


def test_stream_port_rejects_odd_names(store, tmp_path):
    write_stream_port(tmp_path, "h_abc", 51234)
    assert store.stream_port("h_abc") == 51234
    assert store.stream_port("../h_abc") is None
    assert store.stream_port("missing") is None


def test_browser_sessions_headless_and_real_profile(store, tmp_path, monkeypatch):
    write_stream_port(tmp_path, "h_one", 40001)
    fake_browser(monkeypatch, {
        "chat-a": {"session_name": "h_one", "features": {"local": True}},
        "chat-b::local": {"session_name": "h_none", "features": {"local": True}},  # no stream: not viewable
        "chat-c": {"session_name": "rp_x", "cdp_url": "http://127.0.0.1:9222", "features": {"real_profile": True}},
    })
    sessions = {s["task_id"]: s for s in store.browser_sessions()}
    assert sessions["chat-a"]["port"] == 40001
    assert "chat-b" not in sessions
    assert sessions["chat-c"]["cdp_url"] == "http://127.0.0.1:9222"
    assert [s["task_id"] for s in store.browser_sessions({"chat-a"})] == ["chat-a"]


def test_no_browser_module_means_no_sessions(store, monkeypatch):
    monkeypatch.delitem(sys.modules, "tools.browser_tool", raising=False)
    assert store.browser_sessions() == []


def test_real_profile_viewport_is_left_to_the_viewer(store, monkeypatch):
    fake_browser(monkeypatch, {"chat-c": {"session_name": "rp_x", "cdp_url": "http://127.0.0.1:9222",
                                          "features": {"real_profile": True}}})
    assert store.set_viewport("chat-c", 390, 700) is True
    assert store.desired_viewport["chat-c"] == (390, 700)
    assert store.set_viewport("gone", 390, 700) is False

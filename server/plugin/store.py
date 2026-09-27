"""Shared state for browser handoffs: the agent's tool and the dashboard API are loaded as separate modules
(and may run in separate processes), so a handoff is a small JSON file under the Hermes root.

A handoff is the bot saying "I need a person in my browser" (a login, SSO, 2FA, a captcha). The phone lists
open handoffs for its chat, streams that browser (agent-browser's own viewport stream) and marks the handoff
done, which lets the waiting tool return so the bot continues.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Iterable, Optional

WAIT_SECONDS = 15 * 60
_ID = re.compile(r"^[a-f0-9]{16}$")


def _dir() -> Path:
    from hermes_constants import get_default_hermes_root

    path = get_default_hermes_root() / "hermes-mobile" / "handoffs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path(handoff_id: str) -> Optional[Path]:
    return _dir() / f"{handoff_id}.json" if _ID.match(handoff_id or "") else None


def _write(record: dict) -> None:
    path = _path(record["id"])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(record), encoding="utf-8")
    os.replace(tmp, path)


def get(handoff_id: str) -> Optional[dict]:
    path = _path(handoff_id)
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path else None
    except (OSError, ValueError):
        return None


def create(task_id: str, reason: str, session_id: str = "") -> dict:
    record = {
        "id": uuid.uuid4().hex[:16],
        "task_id": task_id,
        "session_id": session_id,
        "reason": reason.strip()[:300],
        "status": "waiting",
        "created_at": time.time(),
    }
    _write(record)
    return record


def finish(handoff_id: str, status: str) -> bool:
    record = get(handoff_id)
    if not record or record.get("status") != "waiting":
        return False
    record["status"] = status
    record["finished_at"] = time.time()
    _write(record)
    return True


def open_handoffs(keys: Iterable[str]) -> list:
    """Waiting handoffs whose task or session is one of ``keys``; old files are pruned on the way."""
    wanted = {k for k in keys if k}
    out = []
    now = time.time()
    for path in _dir().glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        age = now - float(record.get("created_at") or 0)
        if age > WAIT_SECONDS * 2:
            path.unlink(missing_ok=True)
            continue
        if record.get("status") == "waiting" and wanted & {record.get("task_id"), record.get("session_id")}:
            out.append(record)
    return sorted(out, key=lambda r: r["created_at"])


# ── The bot's browser ─────────────────────────────────────────────────────────────────────────────
# Read, never import: importing tools.browser_tool starts its janitor; if it isn't loaded in this process,
# no browser session lives here.
def _browser_module():
    return sys.modules.get("tools.browser_tool")


def stream_port(session_name: str) -> Optional[int]:
    """agent-browser writes its viewport stream's port next to the session socket."""
    if not re.match(r"^[\w.-]+$", session_name or ""):
        return None
    from hermes_constants import socket_safe_tmpdir

    path = Path(socket_safe_tmpdir()) / f"agent-browser-{session_name}" / f"{session_name}.stream"
    try:
        port = int(path.read_text().strip())
    except (OSError, ValueError):
        return None
    return port if 0 < port < 65536 else None


def browser_sessions(task_ids: Optional[set] = None) -> list:
    """Local browser sessions in this process that a person can view (cloud browsers have no local view).
    Headless sessions are streamed by agent-browser (``port``); real-profile ones by the user's Chrome over
    DevTools (``cdp_url``), since the page the bot drives isn't the one agent-browser's shared daemon shows."""
    bt = _browser_module()
    if bt is None:
        return []
    suffix = getattr(bt, "_LOCAL_SUFFIX", "::local")
    out = []
    for key, info in list(getattr(bt, "_active_sessions", {}).items()):
        task = key[: -len(suffix)] if key.endswith(suffix) else key
        if task_ids is not None and task not in task_ids:
            continue
        info = info or {}
        if (info.get("features") or {}).get("real_profile") and info.get("cdp_url"):
            out.append({"task_id": task, "session_key": key, "cdp_url": str(info["cdp_url"]), "port": None})
            continue
        port = stream_port(str(info.get("session_name") or ""))
        if port:
            out.append({"task_id": task, "session_key": key, "port": port, "cdp_url": None})
    return out


# Phone-sized page for real-profile viewers, applied by the DevTools bridge (see plugin_api.py).
desired_viewport: dict = {}


_last_ping: dict = {}
_PING_EVERY_S = 45


def keep_alive(task_id: str) -> None:
    """A person working in the browser is activity: tell Hermes's idle janitor, and every ~45s send the
    agent-browser daemon a cheap command, because its own idle timer only counts commands (stream input
    doesn't), so it would otherwise shut the browser mid-login. Blocking; call it off the event loop."""
    bt = _browser_module()
    if bt is None:
        return
    try:
        from tools.browser_tool_lifecycle import _session_owner_scope, _update_session_activity
    except Exception:
        return
    suffix = getattr(bt, "_LOCAL_SUFFIX", "::local")
    for key in (task_id, f"{task_id}{suffix}"):
        if key in getattr(bt, "_active_sessions", {}):
            _update_session_activity(key)
    now = time.time()
    if now - _last_ping.get(task_id, 0) < _PING_EVERY_S or not browser_sessions({task_id}):
        return
    _last_ping[task_id] = now
    try:
        from tools.browser_tool_session import _run_browser_command

        with _session_owner_scope(task_id):
            _run_browser_command(task_id, "stream", ["status"], timeout=10)
    except Exception:
        pass


def set_viewport(task_id: str, width: int, height: int) -> bool:
    """Resize the page (phone-sized while a person drives it, back to desktop after). Runs through Hermes's
    own command path, under the session owner's profile, so it's the same browser the bot uses. A
    real-profile page is resized by its viewer's DevTools bridge instead."""
    sessions = browser_sessions({task_id})
    if not sessions:
        return False
    if sessions[0].get("cdp_url"):
        desired_viewport[task_id] = (int(width), int(height))
        return True
    try:
        from tools.browser_tool_session import _run_browser_command
    except Exception:  # this Hermes has no such command path (compat.py reports it)
        return False
    try:
        from tools.browser_tool_lifecycle import _session_owner_scope
    except Exception:
        _session_owner_scope = lambda _task: contextlib.nullcontext()  # noqa: E731
    with _session_owner_scope(task_id):
        result = _run_browser_command(task_id, "set", ["viewport", str(int(width)), str(int(height))], timeout=15)
    return bool((result or {}).get("success"))

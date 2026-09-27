"""hermes-mobile API, mounted at /api/plugins/hermes-mobile/ (HTTP routes sit behind the dashboard's auth).

  GET  /capabilities                        plugin version and the server features the app can use
  GET  /browser?session=<id>&hold=1         open handoffs + live browsers for a chat (stored or live ids);
                                             hold=1 while the app shows the sign-in card keeps them open
  POST /handoffs/{id}                        {"status": "done" | "cancelled"}: the tool waiting on it returns
  POST /viewport                             {"task", "width", "height"}: size the page for the phone (or back)
  WS   /stream?task=<task_id>&token|ticket   the bot's browser viewport, relayed from agent-browser's stream

The stream is only relayed for a browser Hermes itself started for that task, and only input messages
(mouse, keyboard, touch) pass from the phone to the browser.
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import json
import logging
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

_log = logging.getLogger("hermes_cli.web_server")
router = APIRouter()


def _load_store():
    name = "hermes_mobile_store"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent.parent / "store.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


store = _load_store()


def _load_compat():
    name = "hermes_mobile_compat"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent.parent / "compat.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


compat = _load_compat()


def _require(feature: str) -> None:
    if not compat.features().get(feature):
        raise HTTPException(status_code=503, detail=(
            "This Hermes version doesn't support that yet: " + "; ".join(compat.problems())
            + ". Update the hermes-mobile plugin (re-run the installer)."))
_INPUT_TYPES = {"input_mouse", "input_keyboard", "input_touch"}
_MAX_INPUT_BYTES = 8192


VERSION = "1.0.0"


def _push_relay_seen() -> bool:
    """The push relay writes its state file every poll; fresh within ~5 minutes means it's running."""
    import time
    from hermes_constants import get_default_hermes_root

    state = get_default_hermes_root() / "mobile-push-relay.json"
    try:
        return time.time() - state.stat().st_mtime < 300
    except OSError:
        return False


@router.get("/capabilities")
async def capabilities():
    """What this Hermes offers the app. The app hides features the server can't back."""
    return {
        "plugin": "hermes-mobile",
        "version": VERSION,
        "features": {**compat.features(), "push_relay": _push_relay_seen()},
        # Hermes internals this plugin needs that this Hermes no longer has (empty when all is well).
        "problems": compat.problems(),
    }


def _task_keys(ids: List[str]) -> set:
    """A chat's browser is keyed by its session key: the stored id, or the live session's key."""
    keys = {i for i in ids if i}
    server = sys.modules.get("tui_gateway.server")
    sessions = getattr(server, "_sessions", None) if server else None
    lookup = getattr(server, "_session_lookup_key", None) if server else None
    if isinstance(sessions, dict) and lookup:
        for sid in list(keys):
            live = sessions.get(sid)
            if live:
                with contextlib.suppress(Exception):
                    keys.add(lookup(live, fallback=sid))
    return keys


@router.get("/browser")
async def chat_browser(session: List[str] = Query(default=[]), hold: bool = False):
    _require("browser_share")
    keys = _task_keys(session)
    browsers = store.browser_sessions(keys)
    if hold:
        for browser in browsers:
            await asyncio.to_thread(store.keep_alive, browser["task_id"])
    return {
        "handoffs": [
            {k: h.get(k) for k in ("id", "task_id", "reason", "created_at")} for h in store.open_handoffs(keys)
        ],
        "browsers": [{"task_id": b["task_id"]} for b in browsers],
    }


class HandoffUpdate(BaseModel):
    status: str


@router.post("/handoffs/{handoff_id}")
async def finish_handoff(handoff_id: str, body: HandoffUpdate):
    if body.status not in ("done", "cancelled"):
        raise HTTPException(status_code=400, detail="status must be done or cancelled")
    if not store.get(handoff_id):
        raise HTTPException(status_code=404, detail="No such handoff")
    return {"ok": True, "changed": store.finish(handoff_id, body.status)}


class ViewportUpdate(BaseModel):
    task: str
    width: int
    height: int


@router.post("/viewport")
async def set_viewport(body: ViewportUpdate):
    _require("browser_share")
    width = max(320, min(1920, body.width))
    height = max(320, min(1400, body.height))
    ok = await asyncio.to_thread(store.set_viewport, body.task, width, height)
    if not ok:
        raise HTTPException(status_code=404, detail="That browser is closed")
    return {"ok": True, "width": width, "height": height}


def _session_for(task: str) -> Optional[dict]:
    for browser in store.browser_sessions({task}):
        return browser
    return None


def _cdp_http_base(cdp_url: str) -> str:
    """``http://host:port`` from a DevTools URL in either form (http endpoint or ws browser URL)."""
    parsed = urllib.parse.urlparse(cdp_url)
    return f"http://{parsed.hostname or '127.0.0.1'}:{parsed.port}"


def _pick_page(cdp_url: str) -> Optional[dict]:
    """The page the bot is working in: the most recently active real page (not a blank or chrome:// tab)."""
    with urllib.request.urlopen(f"{_cdp_http_base(cdp_url)}/json/list", timeout=5) as response:
        targets = json.loads(response.read().decode("utf-8"))
    pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    real = [t for t in pages if not str(t.get("url", "")).startswith(("about:", "chrome:", "chrome-"))]
    return (real or pages or [None])[0]


async def _relay_agent_browser(ws: WebSocket, task: str, port: int) -> None:
    from websockets.asyncio.client import connect

    async with connect(f"ws://127.0.0.1:{port}", max_size=None, open_timeout=5) as upstream:

        async def to_phone():
            async for message in upstream:
                await ws.send_text(message if isinstance(message, str) else message.decode("utf-8", "replace"))

        async def to_browser():
            while True:
                text = await ws.receive_text()
                if len(text) > _MAX_INPUT_BYTES:
                    continue
                try:
                    kind = json.loads(text).get("type")
                except (ValueError, AttributeError):
                    continue
                if kind in _INPUT_TYPES:
                    await upstream.send(text)

        await _run_until_first_done(to_phone(), to_browser(), _keep_alive_loop(task))


async def _bridge_devtools(ws: WebSocket, task: str, cdp_url: str) -> None:
    """Real-profile page over DevTools: Chrome's own screencast out, the app's input in. The app speaks
    agent-browser's stream messages, whose fields are Chrome's Input.dispatch* parameters."""
    from websockets.asyncio.client import connect

    page = await asyncio.to_thread(_pick_page, cdp_url)
    if not page:
        await ws.send_text(json.dumps({"type": "status", "connected": False}))
        return
    async with connect(page["webSocketDebuggerUrl"], max_size=None, open_timeout=5) as cdp:
        ids = iter(range(1, 1 << 30))

        async def call(method: str, params: Optional[dict] = None):
            await cdp.send(json.dumps({"id": next(ids), "method": method, "params": params or {}}))

        await ws.send_text(json.dumps({"type": "tabs", "tabs": [
            {"active": True, "title": page.get("title") or "", "url": page.get("url") or ""}]}))
        await call("Page.enable")
        await call("Page.startScreencast", {"format": "jpeg", "quality": 70, "maxWidth": 1280, "maxHeight": 1600})

        async def to_phone():
            async for raw in cdp:
                message = json.loads(raw)
                method = message.get("method")
                if method == "Page.screencastFrame":
                    params = message["params"]
                    await call("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
                    await ws.send_text(json.dumps({"type": "frame", "data": params["data"], "metadata": params["metadata"]}))
                elif method == "Page.frameNavigated" and not message["params"]["frame"].get("parentId"):
                    frame = message["params"]["frame"]
                    await ws.send_text(json.dumps({"type": "tabs", "tabs": [
                        {"active": True, "title": "", "url": frame.get("url") or ""}]}))

        async def to_browser():
            while True:
                text = await ws.receive_text()
                if len(text) > _MAX_INPUT_BYTES:
                    continue
                try:
                    message = json.loads(text)
                except ValueError:
                    continue
                kind = message.get("type")
                if kind not in _INPUT_TYPES:
                    continue
                params = {k: v for k, v in message.items() if k not in ("type", "eventType") and v is not None}
                params["type"] = message.get("eventType")
                method = {"input_mouse": "Input.dispatchMouseEvent", "input_keyboard": "Input.dispatchKeyEvent",
                          "input_touch": "Input.dispatchTouchEvent"}[kind]
                await call(method, params)

        async def fit_to_phone():
            applied = None
            while True:
                wanted = store.desired_viewport.get(task)
                if wanted and wanted != applied:
                    width, height = wanted
                    await call("Emulation.setDeviceMetricsOverride",
                               {"width": width, "height": height, "deviceScaleFactor": 0, "mobile": False})
                    applied = wanted
                await asyncio.sleep(0.5)

        try:
            await _run_until_first_done(to_phone(), to_browser(), fit_to_phone(), _keep_alive_loop(task))
        finally:
            # Hand the page back to the bot at its normal size.
            store.desired_viewport.pop(task, None)
            with contextlib.suppress(Exception):
                await call("Emulation.clearDeviceMetricsOverride")
                await call("Page.stopScreencast")


async def _keep_alive_loop(task: str) -> None:
    while True:
        await asyncio.to_thread(store.keep_alive, task)
        await asyncio.sleep(10)


async def _run_until_first_done(*coroutines) -> None:
    tasks = [asyncio.ensure_future(c) for c in coroutines]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()


@router.websocket("/stream")
async def stream(ws: WebSocket, task: str = ""):
    from hermes_cli.web_server_chat import _ws_auth_ok, _ws_request_is_allowed

    if not _ws_auth_ok(ws):
        await ws.close(code=4401)
        return
    if not _ws_request_is_allowed(ws):
        await ws.close(code=4403)
        return
    if not compat.features().get("browser_share"):
        await ws.close(code=4503, reason="unsupported Hermes version")
        return
    session = _session_for(task)
    if not session:
        await ws.close(code=4404, reason="That browser is closed")
        return
    await ws.accept()
    try:
        if session.get("cdp_url"):
            await _bridge_devtools(ws, task, session["cdp_url"])
        else:
            await _relay_agent_browser(ws, task, session["port"])
    except (WebSocketDisconnect, OSError, asyncio.TimeoutError):
        pass
    except Exception as exc:  # the upstream closing mid-send, a protocol error: end this viewer only
        _log.info("hermes-mobile stream for %s ended: %s", task, exc)
    finally:
        with contextlib.suppress(Exception):
            await ws.close()

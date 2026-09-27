"""hermes-mobile: the Hermes side of the Hermes Mobile app.

Browser screen share: a bot hands its browser to the person chatting from the app.

``browser_handoff`` joins the ``browser`` toolset, so every bot that can browse can use it. The tool
opens a handoff and waits; the app shows a "screen share" card, streams the bot's browser, and marks the
handoff done when the person taps Done. The browser stays open the whole time.

Two small adjustments to Hermes make this work for real sign-ins:
- Hermes closes a headless browser at the end of every turn, which destroys a login page the moment the
  bot replies ("please log in") and drops the cookies a login just created. Local browsers now outlive the
  turn; the idle janitor (browser.inactivity_timeout) still closes them, and a person viewing one keeps it.
- Tool search defers plugin tools, so the model never saw browser_handoff. It joins the core (always
  visible) tools.
"""

from __future__ import annotations

import json
import time

from . import store

SCHEMA = {
    "name": "browser_handoff",
    "description": (
        "Hand your browser to the user so they can do a step only a person can: log in (password, SSO, "
        "passkey), approve 2FA, solve a captcha, or accept a consent screen. Open the page first with "
        "browser_navigate. The user sees a screen-share button on their phone, completes the step on your "
        "browser, and taps Done; this call waits until then (up to 15 minutes). Never ask the user to paste "
        "passwords or codes into the chat; use this instead. After it returns, take a fresh "
        "browser_snapshot and continue."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "One short line shown to the user, e.g. 'Log in to Bitbucket so I can open the PR'.",
            }
        },
        "required": ["reason"],
    },
}


def _interrupted() -> bool:
    try:
        from tools.interrupt import is_interrupted

        return is_interrupted()
    except Exception:
        return False


def _handle(args: dict, task_id: str = "", session_id: str = "", **_) -> str:
    reason = str((args or {}).get("reason") or "Finish this step in my browser").strip()
    task = str(task_id or "")
    if not store.browser_sessions({task}):
        return json.dumps({
            "success": False,
            "error": "No browser page is open for this task. Open the page with browser_navigate first, "
                     "then call browser_handoff.",
        })
    handoff = store.create(task, reason, str(session_id or ""))
    deadline = time.time() + store.WAIT_SECONDS
    while time.time() < deadline:
        if _interrupted():
            store.finish(handoff["id"], "cancelled")
            return json.dumps({"success": False, "error": "Interrupted before the user finished."})
        status = (store.get(handoff["id"]) or {}).get("status")
        if status == "done":
            return json.dumps({
                "success": True,
                "result": "The user finished in your browser and tapped Done. Take a fresh browser_snapshot "
                          "to see where things are now, then continue the task.",
            })
        if status == "cancelled":
            return json.dumps({
                "success": False,
                "error": "The user closed the screen share without finishing. Ask them how to proceed.",
            })
        store.keep_alive(task)
        time.sleep(1)
    store.finish(handoff["id"], "expired")
    return json.dumps({"success": False, "error": "The user didn't finish within 15 minutes."})


def _keep_browsers_across_turns() -> None:
    """Skip the per-turn ``cleanup_browser`` for local browsers (Hermes looks it up on ``run_agent`` at call
    time, the same seam its tests patch). Cloud browsers still close: they're billed while open."""
    try:
        import run_agent
    except Exception:
        return
    original = getattr(run_agent, "cleanup_browser", None)
    if original is None or getattr(original, "_hermes_mobile", False):
        return

    def cleanup_browser(task_id=None, *args, **kwargs):
        if task_id and store.browser_sessions({str(task_id)}):
            store.keep_alive(str(task_id))  # the janitor's clock restarts at the end of the turn
            return None
        return original(task_id, *args, **kwargs)

    cleanup_browser._hermes_mobile = True
    run_agent.cleanup_browser = cleanup_browser


def _always_visible() -> None:
    try:
        import toolsets

        if "browser_handoff" not in toolsets._HERMES_CORE_TOOLS:
            toolsets._HERMES_CORE_TOOLS.append("browser_handoff")
    except Exception:
        pass


def register(ctx) -> None:
    ctx.register_tool(
        name="browser_handoff",
        toolset="browser",
        schema=SCHEMA,
        handler=_handle,
        emoji="🖥️",
        description="Hand the browser to the user (login, 2FA, captcha) and wait for Done.",
    )
    _always_visible()
    _keep_browsers_across_turns()

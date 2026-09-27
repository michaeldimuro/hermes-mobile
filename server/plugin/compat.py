"""Which Hermes internals this plugin relies on, and whether this Hermes still has them.

Hermes has no public API for browser sessions, turn-end cleanup or tool visibility, so the plugin uses a
few internal names. A Hermes update can rename them; instead of failing at runtime, each feature checks
its names first and switches itself off with a clear reason. The check reads the modules' source (no
import, so no side effects such as starting a browser janitor).
"""

from __future__ import annotations

import ast
import importlib.util
from functools import lru_cache
from typing import Dict, List, Tuple

# name -> (module, [top-level names it must define], what breaks without it)
REQUIREMENTS: Dict[str, Tuple[str, List[str], str]] = {
    "browser_sessions": ("tools.browser_tool", ["_active_sessions", "_LOCAL_SUFFIX", "_REAL_PROFILE_SESSION"],
                         "finding a chat's browser for screen share"),
    "browser_keepalive": ("tools.browser_tool_lifecycle", ["_update_session_activity", "_session_owner_scope"],
                          "keeping a browser open while you use it"),
    "browser_commands": ("tools.browser_tool_session", ["_run_browser_command"],
                         "phone-sized pages while you view them"),
    "live_sessions": ("tui_gateway.server", ["_sessions", "_session_lookup_key"],
                      "matching the app's live chat to its browser"),
    "ws_auth": ("hermes_cli.web_server_chat", ["_ws_auth_ok", "_ws_request_is_allowed"],
                "signing in the screen-share stream"),
    "turn_cleanup": ("run_agent", ["cleanup_browser"],
                     "keeping browsers (and fresh logins) open between turns"),
    "core_tools": ("toolsets", ["_HERMES_CORE_TOOLS"],
                   "making browser_handoff visible to bots without a tool search"),
    "tool_interrupt": ("tools.interrupt", ["is_interrupted"],
                       "stopping browser_handoff when you press Stop"),
}


def _top_level_names(path: str) -> set:
    tree = ast.parse(open(path, encoding="utf-8").read(), filename=path)
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update((a.asname or a.name).split(".")[0] for a in node.names)
    return names


def check_one(module: str, names: List[str]) -> Tuple[bool, str]:
    try:
        spec = importlib.util.find_spec(module)
    except (ImportError, ValueError):
        spec = None
    if spec is None or not spec.origin or not spec.origin.endswith(".py"):
        return False, f"{module} not found"
    try:
        present = _top_level_names(spec.origin)
    except (OSError, SyntaxError) as exc:
        return False, f"couldn't read {module}: {exc}"
    missing = [n for n in names if n not in present]
    return (not missing), (f"{module} no longer defines {', '.join(missing)}" if missing else "ok")


@lru_cache(maxsize=1)
def report() -> Dict[str, dict]:
    out = {}
    for key, (module, names, purpose) in REQUIREMENTS.items():
        ok, detail = check_one(module, names)
        out[key] = {"ok": ok, "detail": detail, "needed_for": purpose}
    return out


def ok(*keys: str) -> bool:
    status = report()
    return all(status.get(k, {}).get("ok") for k in keys)


def problems() -> List[str]:
    return [f"{k}: {v['detail']} (needed for {v['needed_for']})" for k, v in report().items() if not v["ok"]]


# Features the app can use, from the internals they need.
FEATURES = {
    "browser_share": ("browser_sessions", "ws_auth", "live_sessions"),
    "browser_handoff_tool": ("browser_sessions", "tool_interrupt"),
    "browsers_kept_between_turns": ("browser_sessions", "turn_cleanup", "browser_keepalive"),
    "handoff_tool_always_visible": ("core_tools",),
    "phone_sized_pages": ("browser_sessions", "browser_commands"),
}


def features() -> Dict[str, bool]:
    return {name: ok(*keys) for name, keys in FEATURES.items()}

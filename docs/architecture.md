# Architecture

Hermes Mobile is a phone client for [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) running on your own computer. There is no hosted backend: the app talks directly to the Hermes dashboard (the Hermes web server, port `9119`) on your machine, extended by a small plugin.

```
 ┌──────────────────┐      Tailscale (HTTPS via tailscale serve)      ┌──────────────────────────────────────────┐
 │  Hermes Mobile   │   or LAN (HTTP) or your own HTTPS URL            │  Your computer (macOS / Linux / Windows) │
 │  app (Expo/RN)   │ ───────────────────────────────────────────────▶ │                                          │
 │  iOS / Android   │   username + password (dashboard auth)           │  Hermes dashboard :9119                  │
 └────────▲─────────┘                                                  │   └─ hermes-mobile plugin                │
          │                                                            │       /api/plugins/hermes-mobile/...     │
          │ push notifications                                         │                                          │
 ┌────────┴─────────┐        Expo push API        ┌──────────────┐     │  push-relay (Node) ── polls dashboard    │
 │  APNs / FCM      │ ◀───────────────────────────│  Expo push   │ ◀───│                                          │
 └──────────────────┘                             └──────────────┘     │  Hermes agents / bots, browsers, tools   │
                                                                       │  Hermes.app launcher (macOS)             │
                                                                       └──────────────────────────────────────────┘
```

## Components

### `app/` — the mobile app

Expo / React Native app for iPhone and Android. Chat (streaming, reasoning, tool calls, approvals, questions, group chats, `/` skills, `@` mentions, file/image/PDF viewers), voice mode, screen share, Kanban boards, automations, usage, notifications, iOS widget and Live Activity, Face ID lock and an offline cache. It connects to one Hermes dashboard using the URL, username and password from pairing. See [self-build.md](self-build.md) to build it.

### `server/plugin` — the `hermes-mobile` Hermes plugin

A Hermes dashboard plugin. Its API lives under `/api/plugins/hermes-mobile/` and is protected by the dashboard's own authentication.

- **Capabilities:** tells the app which optional features this installation supports.
- **Browser handoff:** when a bot's browser reaches a login, SSO, 2FA or captcha, the bot calls the `browser_handoff` tool (added to the browser toolset). The app shows an **Open screen** button.
- **Live stream relay:** streams the bot's browser to the phone and relays mouse, keyboard and touch input back. For the default agent browser it relays the agent-browser viewport; for real-profile Chrome (`--real-browser`) it uses the DevTools screencast. Only browsers Hermes opened are reachable.
- **Keep-alive:** keeps local browsers alive across agent turns so a handoff doesn't lose the page.

### `server/push-relay` — notification relay

A small Node service run with Hermes' bundled Node. It polls the dashboard for new replies, automation results and board tasks, and sends them to registered devices through the Expo push service. Skip it with `--no-push`.

### `server/launcher-macos` — Hermes.app

A launcher app built into `~/Applications/Hermes.app` on macOS. Hermes runs under it, so a single Full Disk Access grant covers everything Hermes starts, and bots' scripts don't trigger permission prompts while you're away.

### `install/` — installers

`install.sh` (macOS, Linux) and `install.ps1` (Windows). They install the plugin, run the dashboard as a boot-time service with a generated password (launchd / systemd user service / logon Scheduled Task), configure networking (see [networking.md](networking.md)), set up the push relay, build Hermes.app on macOS, and open the pairing page. Optional: voice, 1Password service account, real-browser mode. Idempotent; `--uninstall` reverses everything.

### `website/` — public site

Static site served by GitHub Pages. Includes `pair.html`, which receives connection details in the URL fragment (never sent to a server), strips them from the address bar, and renders the `hermes://connect?d=...` deep link as a QR code locally. See [security.md](security.md).

## Pairing flow

1. The installer builds `{"v":1,"url":...,"username":...,"password":...}`, encodes it as unpadded base64url, and opens `https://michaeldimuro.github.io/hermes-mobile/pair.html#<payload>`.
2. The page validates the payload, removes the fragment from history, and shows a QR code for `hermes://connect?d=<payload>`.
3. Scanning the code opens the app, which decodes the payload and connects.

## Hermes internals and compatibility

Hermes has no public API for a few things the plugin needs, so it uses internal names: browser sessions and their keep-alive, the browser command runner, live chat sessions, WebSocket sign-in, the per-turn browser cleanup (skipped for local browsers so logins survive), the core tool list (so `browser_handoff` is always visible) and the interrupt flag. [`server/plugin/compat.py`](../server/plugin/compat.py) lists them and checks, by reading Hermes' source without importing it, that each still exists. When a Hermes update removes one, only the features that depend on it switch off: the plugin logs why, `GET /api/plugins/hermes-mobile/capabilities` reports them under `problems`, the installer prints them, and the app hides what the server can't back. Tested with Hermes Agent 0.21.

# Hermes Mobile

Your [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) bots, in your pocket. Hermes Mobile is an iPhone/Android app that connects to the Hermes running on **your own** Mac, Linux or Windows machine. Nothing is hosted by us; your conversations, files and credentials stay on your computer.

**Website & setup guide: https://michaeldimuro.github.io/hermes-mobile/**

## Get started

On the computer that runs Hermes:

```bash
# macOS & Linux
curl -fsSL https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.ps1 | iex
```

The installer adds the `hermes-mobile` Hermes plugin, runs the Hermes dashboard as a service that starts at boot (with a generated password), makes it reachable from your phone (Tailscale by default, your local network, a [relay you host](docs/relay.md), or your own URL), sets up push notifications, and opens a pairing page. Scan its QR code with your phone's Camera and Hermes Mobile opens connected. Options: `--voice`, `--onepassword`, `--real-browser <bot>`, `--network lan|relay|<url>`, `--pair`, `--uninstall` (Windows: environment variables, see the [guide](https://michaeldimuro.github.io/hermes-mobile/get-started.html)). Re-running upgrades in place and keeps paired phones connected.

## What you get

- **Chat with every bot**: live streaming replies, reasoning and tool calls, approvals and questions from the agent, group chats shared with Hermes desktop, `/` skills and `@` mentions, files and viewers.
- **Voice mode**: a hands-free conversation; replies are spoken sentence by sentence in each bot's own ElevenLabs voice, and everything is still written into the chat.
- **Screen share for sign-ins**: when a bot's browser hits a login, SSO, 2FA or captcha, tap **Open screen**, finish it on the bot's live browser, tap **Done**, and the bot carries on. Google-protected sign-ins work with `--real-browser`.
- **Runs unattended**: 1Password service-account secrets for every bot with no prompts; on macOS a small Hermes.app launcher holds Full Disk Access so nothing waits on a permission pop-up; everything starts at boot.
- Push notifications, Kanban boards, automations, usage, iOS widget and Live Activity, Face ID lock, offline cache.

## Repository

| Path | What it is |
| --- | --- |
| [`app/`](app) | The Expo / React Native app ([build it yourself](docs/self-build.md)) |
| [`server/plugin/`](server/plugin) | `hermes-mobile` Hermes plugin: the app's API (capabilities, browser screen share), the `browser_handoff` tool, browsers kept alive between turns |
| [`server/push-relay/`](server/push-relay) | Push-notification relay (runs on Hermes' bundled Node.js) |
| [`server/launcher-macos/`](server/launcher-macos) | Hermes.app, the macOS launcher that holds Full Disk Access |
| [`server/connector/`](server/connector) | Relay connector: dials out from the Hermes computer to your relay |
| [`relay/`](relay) | Self-hostable relay (Docker + automatic HTTPS): reach Hermes with no VPN and no open ports ([guide](docs/relay.md)) |
| [`install/`](install) | `install.sh` (macOS, Linux) and `install.ps1` (Windows) |
| [`website/`](website) | The website (GitHub Pages) |
| [`docs/`](docs) | [Architecture](docs/architecture.md), [security](docs/security.md), [networking](docs/networking.md), [self-build](docs/self-build.md), [App Store release](docs/app-store.md), [relay](docs/relay.md) |

Tested with Hermes Agent 0.21. The plugin relies on a few Hermes internals (see [architecture](docs/architecture.md)); a Hermes update can require a plugin update.

## Develop

```bash
cd app && npm install
npm run lint && npm run typecheck && npm test   # app checks
npx expo start --dev-client                     # needs a development build: docs/self-build.md
```

Server plugin tests: `uv run --with pytest python -m pytest server/tests`. Install from a checkout: `bash install/install.sh --source .`

## License

MIT, see [LICENSE](LICENSE). Hermes Agent is a project by Nous Research; this app is an independent companion to it.

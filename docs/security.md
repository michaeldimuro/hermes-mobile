# Security

Hermes Mobile is a remote control for software on your own computer. This page explains what that exposes and how.

## Nothing is hosted by us

There's no Hermes Mobile account or server in the middle. The phone talks directly to your Hermes dashboard over one of:

- **Tailscale** (default): a private WireGuard network between your own devices, with HTTPS via `tailscale serve`. The dashboard isn't exposed to the internet.
- **Your local network**: plain HTTP on your Wi-Fi. Only use it on networks you trust.
- **Your own HTTPS URL**: for example a reverse proxy or tunnel you run.

See [networking.md](networking.md). The project website is static and only hosts documentation and the pairing page.

## Sign-in

The app signs in with the dashboard's username and password. The installer generates a random password and stores it in `~/.hermes/.env`; on macOS it is also kept in the Keychain.

## The pairing link

The pairing page receives the URL, username and password in the link's fragment (after `#`), which browsers never send to a server. The page removes it from the address bar and history as soon as it loads, draws the QR code locally, has no analytics and makes no network requests with it. A strict Content-Security-Policy allows scripts only from the site itself and `cdn.jsdelivr.net` (the QR library, pinned with Subresource Integrity).

Anyone who sees the QR code can sign in to your Hermes. Don't share or screenshot it. To rotate the password, re-run the installer and pair again.

## Screen share

The live view shows, and relays mouse, keyboard and touch input to, only browsers that Hermes itself opened. It runs over the same authenticated dashboard connection. It can't see or control the rest of your desktop.

## 1Password (opt-in, `--onepassword`)

The service account is read-only and scoped to the vaults you choose. **Every bot's commands can read those vaults**, so keep only items that are appropriate for bots there. Service accounts can't access the built-in Personal/Private vault.

## Real-browser mode (opt-in, per bot, `--real-browser <bot>`)

Gives that bot a copy of your Chrome profile, including cookies and signed-in sessions. That bot can then act as you on those sites. Enable it only for bots you trust with that.

## Full Disk Access on macOS

Granting Full Disk Access to Hermes.app lets anything Hermes runs read your files without asking. That's the price of unattended operation. If you'd rather approve access case by case, skip it and accept the prompts.

Unattended recovery after a reboot needs automatic login, which requires FileVault to be off. Only do that for a Mac in a place you trust.

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.sh | bash -s -- --uninstall
```

Windows (PowerShell):

```powershell
$env:HERMES_MOBILE_UNINSTALL=1; irm https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.ps1 | iex
```

This removes the plugin, the dashboard service, network setup, the push relay and Hermes.app. On macOS, also remove Hermes from the Full Disk Access list.

## Reporting a vulnerability

Please report privately via [GitHub security advisories](https://github.com/michaeldimuro/hermes-mobile/security) rather than a public issue.

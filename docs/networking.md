# Networking

The phone connects directly to the Hermes dashboard on your computer (`127.0.0.1:9119`). The installer's `--network` option (Windows: `HERMES_MOBILE_NETWORK`) chooses how.

## Tailscale (default, recommended)

Used automatically when Tailscale is installed. The dashboard stays bound to localhost, and the installer publishes it to your tailnet with `tailscale serve`, which provides HTTPS with a valid certificate at `https://<computer>.<tailnet>.ts.net`.

- Works from anywhere: home, mobile data, other Wi-Fi.
- Only devices signed in to your Tailscale account can reach it; nothing is exposed to the internet.
- Install Tailscale on the phone too and sign in to the same account.

```bash
curl -fsSL https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.sh | bash -s -- --network tailscale
```

## LAN

Binds the dashboard to `0.0.0.0` so devices on the same network can reach it at `http://<computer-ip>:9119`, protected by the dashboard password.

- **Plain HTTP**: the password and your chats cross the network unencrypted. Only use this on trusted networks (your own home Wi-Fi).
- Works only while the phone is on the same network.

```bash
curl -fsSL https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.sh | bash -s -- --network lan
```

## Your own URL

Pass any `https://` URL you already route to the dashboard, for example your own reverse proxy (Caddy, nginx) or a Cloudflare named tunnel pointed at `http://127.0.0.1:9119`. The installer puts this URL in the pairing code; you're responsible for TLS and for what else that URL exposes.

```bash
curl -fsSL https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.sh | bash -s -- --network https://hermes.example.com
```

On Windows, set the variable before running the installer:

```powershell
$env:HERMES_MOBILE_NETWORK="https://hermes.example.com"
irm https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.ps1 | iex
```

## Roadmap

A hosted, end-to-end-encrypted relay (no Tailscale or port setup needed, and the relay can't read your traffic) is planned.

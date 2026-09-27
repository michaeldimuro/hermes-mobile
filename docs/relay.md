# Self-hosted relay

The relay lets Hermes Mobile reach a Hermes that isn't on the public internet, **without Tailscale on the phone and without opening ports at home**. A small connector next to Hermes dials *out* to the relay; the app connects to `https://relay.example.com/h/<id>`; the relay forwards each request and WebSocket over the connector's connection to the Hermes dashboard.

```
 phone ──HTTPS──▶ relay (your server) ◀──WSS, outbound── connector ──▶ Hermes dashboard (127.0.0.1:9119)
```

## Run the relay

You need a server that can run Docker, reachable on ports 80 and 443, and a DNS name pointing at it.

```bash
git clone https://github.com/michaeldimuro/hermes-mobile && cd hermes-mobile/relay
cat > .env <<EOF
RELAY_DOMAIN=relay.example.com
RELAY_TOKEN=$(openssl rand -hex 32)
EOF
docker compose up -d
curl https://relay.example.com/healthz     # {"ok":true,"service":"hermes-mobile-relay",...}
```

Caddy (in `docker-compose.yml`) gets and renews the HTTPS certificate automatically. Without Docker: `npm ci && RELAY_TOKEN=... node server.mjs` behind any HTTPS reverse proxy (set `RELAY_TRUST_PROXY=1` when that proxy sets `X-Forwarded-For`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `RELAY_TOKEN` | (required) | Secret every connector must present. At least 16 characters. |
| `PORT` | `8080` | Listen port. |
| `RELAY_TRUST_PROXY` | off | Trust `X-Forwarded-For` for client addresses (on in the Docker setup, behind Caddy). |
| `RELAY_LOGIN_PER_MIN` | `10` | Sign-in attempts per client address per Hermes, per minute. |
| `RELAY_MAX_BODY_MB` | `25` | Largest request body (uploads). |
| `RELAY_REQUEST_TIMEOUT_S` | `120` | How long a request may wait for Hermes. |

## Connect a Hermes to it

On each computer running Hermes:

```bash
curl -fsSL https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.sh \
  | bash -s -- --network relay --relay-url https://relay.example.com --relay-token <RELAY_TOKEN>
```

Windows: set `$env:HERMES_MOBILE_NETWORK="relay"`, `$env:HERMES_MOBILE_RELAY_URL`, `$env:HERMES_MOBILE_RELAY_TOKEN`, then run `install.ps1`. The installer runs the connector as a service (on Hermes' bundled Node.js), keeps a stable host id so paired phones stay connected across re-runs, and shows a pairing QR code for `https://relay.example.com/h/<id>`.

## Security model

- **HTTPS ends at the relay.** Whoever operates the relay could read traffic passing through it, so run it on a server you control. (End-to-end encryption through the relay is on the roadmap.)
- **Hermes' password guards every request**, exactly as over Tailscale. The relay slows password guessing (per client and host) and answers `502` for hosts that aren't connected, never another host's Hermes.
- **Only connectors with `RELAY_TOKEN` can register.** Treat the token like a password; rotating it means re-running the installer on each computer with the new one.
- **The connector refuses to expose an ungated Hermes.** Hermes switches sign-in off when its public address is local, and an ungated Hermes serves its session token on its page. So the connector only connects while `GET /api/status` reports `auth_required: true` (checked at start and every 30 seconds), and the installer rejects local relay addresses and verifies the gate after setup.
- Nothing at home listens on the internet: the connector only makes an outbound connection.

## Protocol

JSON messages over one WebSocket per connector; see [`relay/protocol.mjs`](../relay/protocol.mjs). Tests (`cd relay && npm test`) run the real relay and connector against a stand-in Hermes: requests, bodies, 1 MB streamed responses, WebSockets, token and host isolation, rate limiting, and the ungated-Hermes refusal.

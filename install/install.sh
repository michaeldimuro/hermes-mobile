#!/usr/bin/env bash
# Hermes Mobile installer for macOS and Linux: connects the Hermes Mobile app to the Hermes on this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- [options]
#
# Options:
#   --network tailscale|lan|relay|<url>   how the phone reaches Hermes (default: tailscale if installed, else lan)
#   --relay-url <https-url>               your self-hosted relay (with --network relay; see relay/)
#   --relay-token <secret>                the relay's RELAY_TOKEN (asked for, hidden, when omitted)
#   --port N                              dashboard port (default 9119)
#   --voice                               ElevenLabs voice for every bot (needs ELEVENLABS_API_KEY in ~/.hermes/.env)
#   --onepassword                         headless 1Password for every bot (asks for a service-account token)
#   --real-browser <bot>                  that bot browses with a copy of your real Chrome profile, visibly (repeatable)
#   --no-push                             skip the push-notification relay
#   --pair                                only show the pairing page again
#   --uninstall                           remove what this installer added
#   --yes                                 don't ask before stopping a dashboard that's already running
#   --source <dir>                        install from a local checkout instead of downloading
#   (HERMES_MOBILE_NO_OPEN=1 prints the pairing link instead of opening a browser)
#
# Safe to re-run: it upgrades in place and keeps your existing password, so paired phones stay connected.
set -euo pipefail

REPO="michaeldimuro/hermes-mobile"
REF="${HERMES_MOBILE_REF:-main}"
SITE="https://michaeldimuro.github.io/hermes-mobile"
TESTED_HERMES="0.21"

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
ENV_FILE="$HERMES_HOME/.env"
PORT=9119
NETWORK=""
VOICE=0
ONEPASSWORD=0
REAL_BROWSER=""
PUSH=1
PAIR_ONLY=0
UNINSTALL=0
ASSUME_YES=0
SOURCE=""
RELAY_URL_ARG=""
RELAY_TOKEN_ARG=""

DASH_LABEL="com.hermes.shared-dashboard"
PUSH_LABEL="com.hermes.mobile-push-relay"
CONNECTOR_LABEL="com.hermes.mobile-relay-connector"
LAUNCHER_APP="$HOME/Applications/Hermes.app"
LAUNCHER_EXE="$LAUNCHER_APP/Contents/MacOS/Hermes"
LOG_DIR="$HERMES_HOME/logs"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    ! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# Prompts read from the terminal even when this script arrives on stdin (curl | bash).
ask() { # ask "question" -> 0 for yes
  [ "$ASSUME_YES" = 1 ] && return 0
  [ -r /dev/tty ] || return 1
  local reply
  printf '%s [y/N] ' "$1" > /dev/tty
  read -r reply < /dev/tty || return 1
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --network) NETWORK="${2:?--network needs tailscale, lan or a URL}"; shift ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    --relay-url) RELAY_URL_ARG="${2:?--relay-url needs a URL}"; shift ;;
    --relay-token) RELAY_TOKEN_ARG="${2:?--relay-token needs the secret}"; shift ;;
    --voice) VOICE=1 ;;
    --onepassword) ONEPASSWORD=1 ;;
    --real-browser) REAL_BROWSER="$REAL_BROWSER ${2:?--real-browser needs a bot name}"; shift ;;
    --no-push) PUSH=0 ;;
    --pair) PAIR_ONLY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --source) SOURCE="${2:?--source needs a directory}"; shift ;;
    -h|--help) sed -n '2,21p' "$0" 2>/dev/null || echo "See $SITE/get-started.html"; exit 0 ;;
    *) die "unknown option: $1 (see $SITE/get-started.html)" ;;
  esac
  shift
done

OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *) die "this installer is for macOS and Linux; on Windows use install.ps1 ($SITE/get-started.html)" ;;
esac

# ── Hermes ────────────────────────────────────────────────────────────────────────────────────────
HERMES_BIN=""
for candidate in "$(command -v hermes 2>/dev/null || true)" "$HERMES_HOME/hermes-agent/venv/bin/hermes" "$HOME/.local/bin/hermes"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then HERMES_BIN="$candidate"; break; fi
done
[ -n "$HERMES_BIN" ] || die "Hermes isn't installed (no 'hermes' command). Install Hermes Agent first: https://hermes-agent.nousresearch.com/docs/"
hermes() { "$HERMES_BIN" "$@" 2>/dev/null | grep -v '1Password:' || true; }

env_get() { # env_get FILE KEY -> value, or nothing (never fails: callers run under set -e)
  [ -f "$1" ] || return 0
  { grep -E "^$2=" "$1" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
env_set() { # env_set FILE KEY VALUE (0600, replaces the key)
  local file="$1" key="$2" value="$3" tmp
  mkdir -p "$(dirname "$file")"
  touch "$file"
  tmp="$(mktemp)"
  { grep -v "^$key=" "$file" 2>/dev/null || true; printf '%s=%s\n' "$key" "$value"; } > "$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
}
env_unset() {
  [ -f "$1" ] || return 0
  local tmp; tmp="$(mktemp)"
  grep -v "^$2=" "$1" > "$tmp" || true
  mv "$tmp" "$1"; chmod 600 "$1"
}

# Local addresses make Hermes drop its sign-in gate; never publish one.
is_local_url() {
  case "$1" in
    http://localhost*|https://localhost*|http://127.*|https://127.*|http://\[::1\]*|https://\[::1\]*|http://0.0.0.0*|https://0.0.0.0*) return 0 ;;
    *) return 1 ;;
  esac
}

# random CHARSET LENGTH: head closes the pipe early, so tr dies of SIGPIPE; under pipefail that would
# abort the script, hence the || true.
random() { LC_ALL=C tr -dc "$1" < /dev/urandom 2>/dev/null | head -c "$2" || true; }

# Every Hermes profile home: the default one plus ~/.hermes/profiles/*.
profiles() {
  echo "default:$HERMES_HOME"
  for dir in "$HERMES_HOME"/profiles/*/; do
    [ -f "$dir/config.yaml" ] && echo "$(basename "$dir"):${dir%/}"
  done
  return 0
}
hermes_for() { # hermes_for PROFILE args...
  local profile="$1"; shift
  if [ "$profile" = default ]; then hermes "$@"; else hermes -p "$profile" "$@"; fi
}

node_bin() {
  local found
  found="$(ls -d "$HERMES_HOME"/tools/node-*/bin/node 2>/dev/null | tail -1 || true)"
  if [ -n "$found" ] && [ -x "$found" ]; then echo "$found"; return; fi
  found="$(command -v node 2>/dev/null || true)"
  if [ -n "$found" ] && "$found" -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)' 2>/dev/null; then echo "$found"; fi
}

wait_for_dashboard() {
  local i
  for i in $(seq 1 60); do
    curl -s -m 2 "http://127.0.0.1:$PORT/api/status" 2>/dev/null | grep -q '"auth_required"' && return 0
    sleep 2
  done
  return 1
}

# A small Node service next to Hermes (push relay, relay connector): launchd agent on macOS, systemd user
# unit on Linux; both start at boot and restart if they stop. SVC_ENV holds its KEY=VALUE lines.
SVC_ENV=""
node_service() { # node_service MAC_LABEL LINUX_UNIT DESCRIPTION SCRIPT LOGNAME
  local label="$1" unit="$2" description="$3" script="$4" logname="$5" node env_xml="" env_unit="" pair
  node="$(node_bin)"
  while IFS= read -r pair; do
    [ -n "$pair" ] || continue
    env_xml="$env_xml<key>${pair%%=*}</key><string>${pair#*=}</string>"
    env_unit="${env_unit}Environment=$pair
"
  done <<ENVLINES
$SVC_ENV
ENVLINES
  if [ "$OS" = Darwin ]; then
    local plist="$HOME/Library/LaunchAgents/$label.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$node</string><string>$script</string></array>
  <key>EnvironmentVariables</key><dict>$env_xml</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/$logname.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/$logname.log</string>
</dict></plist>
PLIST
    chmod 600 "$plist"
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null && break; sleep 1; done
  else
    local dir="$HOME/.config/systemd/user"
    mkdir -p "$dir"
    cat > "$dir/$unit" <<UNIT
[Unit]
Description=$description
After=hermes-mobile-dashboard.service

[Service]
ExecStart=$node $script
${env_unit}Restart=always
RestartSec=30
StandardOutput=append:$LOG_DIR/$logname.log
StandardError=append:$LOG_DIR/$logname.log

[Install]
WantedBy=default.target
UNIT
    chmod 600 "$dir/$unit"
    systemctl --user daemon-reload
    systemctl --user enable "$unit" >/dev/null 2>&1
    systemctl --user restart "$unit"
  fi
}
remove_service() { # remove_service MAC_LABEL LINUX_UNIT
  if [ "$OS" = Darwin ]; then
    launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$1.plist"
  else
    systemctl --user disable --now "$2" 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/$2"
  fi
}

# ── Credentials & pairing ─────────────────────────────────────────────────────────────────────────
USERNAME_VALUE="$(env_get "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_USERNAME)"
PASSWORD_VALUE="$(env_get "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_PASSWORD)"
PUBLIC_URL="$(hermes config get dashboard.public_url | tail -1 | tr -d ' ')"
case "$PUBLIC_URL" in http*) ;; *) PUBLIC_URL="" ;; esac

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

show_pairing() {
  [ -n "$PASSWORD_VALUE" ] && [ -n "$PUBLIC_URL" ] || die "Hermes Mobile isn't set up yet; run the installer without --pair first."
  local json payload link
  json="{\"v\":1,\"url\":\"$(json_escape "$PUBLIC_URL")\",\"username\":\"$(json_escape "$USERNAME_VALUE")\",\"password\":\"$(json_escape "$PASSWORD_VALUE")\"}"
  payload="$(printf '%s' "$json" | base64 | tr -d '\n=' | tr '+/' '-_')"
  link="$SITE/pair.html#$payload"
  step "Pair your phone"
  note "Opening your pairing page. Scan its QR code with your phone's Camera to open Hermes Mobile connected."
  note "Or enter these in the app's Connect screen:"
  note "  Address:  $PUBLIC_URL"
  note "  Username: $USERNAME_VALUE"
  note "  Password: $PASSWORD_VALUE"
  note "The link below holds your password; the part after # never leaves this computer's browser. Don't share it."
  note "$link"
  if [ -n "${HERMES_MOBILE_NO_OPEN:-}" ]; then :  # headless / remote: print only
  elif [ "$OS" = Darwin ]; then open "$link" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then xdg-open "$link" >/dev/null 2>&1 || true
  fi
}

if [ "$PAIR_ONLY" = 1 ]; then show_pairing; exit 0; fi

# ── Uninstall ─────────────────────────────────────────────────────────────────────────────────────
uninstall() {
  step "Removing Hermes Mobile"
  remove_service "$CONNECTOR_LABEL" hermes-mobile-connector.service
  remove_service "$PUSH_LABEL" hermes-mobile-push.service
  remove_service "$DASH_LABEL" hermes-mobile-dashboard.service
  if [ "$OS" = Darwin ]; then
    rm -rf "$LAUNCHER_APP"
    note "Removed the services and Hermes.app (also remove Hermes from Full Disk Access)."
  else
    systemctl --user daemon-reload 2>/dev/null || true
    note "Removed the systemd user services."
  fi
  command -v tailscale >/dev/null 2>&1 && tailscale serve --https=443 off >/dev/null 2>&1 || true
  hermes plugins disable hermes-mobile >/dev/null
  rm -rf "$HERMES_HOME/plugins/hermes-mobile" "$HERMES_HOME/mobile-push-relay" "$HERMES_HOME/mobile-relay-connector"
  for key in HERMES_MOBILE_RELAY_URL HERMES_MOBILE_RELAY_TOKEN HERMES_MOBILE_RELAY_HOST_ID; do env_unset "$ENV_FILE" "$key"; done
  env_unset "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_USERNAME
  env_unset "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_PASSWORD
  env_unset "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_SECRET
  hermes config set dashboard.public_url "" >/dev/null
  note "Removed the plugin, relay and dashboard sign-in. Voice, 1Password and browser settings on your bots are kept."
  note "Start Hermes as before with: hermes dashboard"
}
if [ "$UNINSTALL" = 1 ]; then uninstall; exit 0; fi

bold "Hermes Mobile installer"

# Version check: the plugin hooks into a few Hermes internals; tested with $TESTED_HERMES.x.
HERMES_VERSION="$(hermes --version | sed -n 1p | sed -nE 's/.*v([0-9]+\.[0-9]+).*/\1/p')"
note "Hermes $HERMES_VERSION at $HERMES_BIN"
if [ -n "$HERMES_VERSION" ] && [ "$(printf '%s\n%s\n' "$TESTED_HERMES" "$HERMES_VERSION" | sort -V | sed -n 1p)" != "$TESTED_HERMES" ]; then
  warn "Hermes $HERMES_VERSION is older than the tested $TESTED_HERMES; update Hermes if something doesn't work."
fi

# ── Source files ──────────────────────────────────────────────────────────────────────────────────
if [ -z "$SOURCE" ]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
  if [ -n "$here" ] && [ -d "$here/../server/plugin" ]; then SOURCE="$(cd "$here/.." && pwd)"; fi
fi
if [ -z "$SOURCE" ]; then
  step "Downloading Hermes Mobile ($REF)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP"
  SOURCE="$(ls -d "$TMP"/*/ | sed -n 1p)"
  SOURCE="${SOURCE%/}"
fi
[ -d "$SOURCE/server/plugin" ] || die "couldn't find server/plugin in $SOURCE"

# ── 1. Plugin ─────────────────────────────────────────────────────────────────────────────────────
step "Installing the hermes-mobile Hermes plugin"
if [ -d "$HERMES_HOME/plugins/mobile-browser" ]; then # its earlier name
  hermes plugins disable mobile-browser >/dev/null
  rm -rf "$HERMES_HOME/plugins/mobile-browser"
fi
rm -rf "$HERMES_HOME/plugins/hermes-mobile"
mkdir -p "$HERMES_HOME/plugins/hermes-mobile"
cp -R "$SOURCE/server/plugin/." "$HERMES_HOME/plugins/hermes-mobile/"
find "$HERMES_HOME/plugins/hermes-mobile" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
hermes plugins enable hermes-mobile >/dev/null
note "Installed to $HERMES_HOME/plugins/hermes-mobile and enabled."

# ── 2. Sign-in ────────────────────────────────────────────────────────────────────────────────────
step "Dashboard sign-in"
if [ -z "$USERNAME_VALUE" ]; then USERNAME_VALUE="hermes"; env_set "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_USERNAME "$USERNAME_VALUE"; fi
if [ -z "$PASSWORD_VALUE" ]; then
  PASSWORD_VALUE="$(random 'A-Za-z0-9' 24)"
  env_set "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_PASSWORD "$PASSWORD_VALUE"
  note "Generated a password for user '$USERNAME_VALUE'."
else
  note "Keeping the existing password for user '$USERNAME_VALUE' (paired phones stay connected)."
fi
if [ -z "$(env_get "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_SECRET)" ]; then
  env_set "$ENV_FILE" HERMES_DASHBOARD_BASIC_AUTH_SECRET "$(random 'a-f0-9' 64)"
fi
if [ "$OS" = Darwin ]; then
  security add-generic-password -U -a "$USERNAME_VALUE" -s "hermes-shared-backend" -w "$PASSWORD_VALUE" >/dev/null 2>&1 || true
fi

# ── 3. Network ────────────────────────────────────────────────────────────────────────────────────
TAILSCALE="$(command -v tailscale 2>/dev/null || true)"
[ -z "$TAILSCALE" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TAILSCALE=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [ -z "$NETWORK" ]; then
  if [ -n "$TAILSCALE" ] && "$TAILSCALE" status >/dev/null 2>&1; then NETWORK=tailscale; else NETWORK=lan; fi
fi
step "Network access ($NETWORK)"
HOST="127.0.0.1"
case "$NETWORK" in
  tailscale)
    [ -n "$TAILSCALE" ] || die "Tailscale isn't installed. Install it (https://tailscale.com/download) and sign in, or use --network lan."
    DNS="$("$TAILSCALE" status --json 2>/dev/null | sed -nE 's/.*"DNSName": *"([^"]+)".*/\1/p' | sed -n 1p | sed 's/\.$//')"
    [ -n "$DNS" ] || die "Tailscale isn't signed in. Sign in (tailscale up), then re-run."
    PUBLIC_URL="https://$DNS"
    ;;
  lan)
    HOST="0.0.0.0"
    if [ "$OS" = Darwin ]; then IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    else IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; fi
    [ -n "$IP" ] || die "couldn't find this computer's local IP address; use --network <url>."
    PUBLIC_URL="http://$IP:$PORT"
    warn "LAN mode is plain HTTP on your local network; only use it on networks you trust."
    ;;
  relay)
    RELAY_URL="${RELAY_URL_ARG:-$(env_get "$ENV_FILE" HERMES_MOBILE_RELAY_URL)}"
    RELAY_URL="${RELAY_URL%/}"
    case "$RELAY_URL" in https://*|http://*) ;; *) die "--network relay needs --relay-url https://your-relay (see relay/ in the repo)" ;; esac
    is_local_url "$RELAY_URL" && die "the relay must have a public address, not $RELAY_URL: Hermes turns sign-in off when its public address is local."
    RELAY_TOKEN="${RELAY_TOKEN_ARG:-$(env_get "$ENV_FILE" HERMES_MOBILE_RELAY_TOKEN)}"
    if [ -z "$RELAY_TOKEN" ] && [ -r /dev/tty ]; then
      printf "    Relay token (the relay's RELAY_TOKEN, hidden): " > /dev/tty
      read -rs RELAY_TOKEN < /dev/tty || true
      printf '\n' > /dev/tty
    fi
    [ -n "$RELAY_TOKEN" ] || die "--network relay needs --relay-token"
    curl -fsS -m 10 "$RELAY_URL/healthz" 2>/dev/null | grep -q hermes-mobile-relay || warn "Couldn't reach a Hermes Mobile relay at $RELAY_URL; continuing."
    # Keep the host id across re-runs so paired phones keep working.
    RELAY_HOST_ID="$(env_get "$ENV_FILE" HERMES_MOBILE_RELAY_HOST_ID)"
    [ -n "$RELAY_HOST_ID" ] || RELAY_HOST_ID="$(random 'a-z0-9' 20)"
    env_set "$ENV_FILE" HERMES_MOBILE_RELAY_URL "$RELAY_URL"
    env_set "$ENV_FILE" HERMES_MOBILE_RELAY_TOKEN "$RELAY_TOKEN"
    env_set "$ENV_FILE" HERMES_MOBILE_RELAY_HOST_ID "$RELAY_HOST_ID"
    PUBLIC_URL="$RELAY_URL/h/$RELAY_HOST_ID"
    ;;
  http://*|https://*)
    is_local_url "$NETWORK" && die "use an address your phone can reach, not $NETWORK: Hermes turns sign-in off when its public address is local."
    PUBLIC_URL="${NETWORK%/}"
    note "Point your proxy or tunnel at http://127.0.0.1:$PORT."
    ;;
  *) die "--network must be tailscale, lan, relay, or a URL" ;;
esac
hermes config set dashboard.public_url "$PUBLIC_URL" >/dev/null
note "Your phone will connect to $PUBLIC_URL"

# ── 4. Dashboard service ──────────────────────────────────────────────────────────────────────────
step "Running Hermes as a service"
mkdir -p "$LOG_DIR"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! launchctl print "gui/$(id -u)/$DASH_LABEL" >/dev/null 2>&1 \
   && ! systemctl --user is-active --quiet hermes-mobile-dashboard.service 2>/dev/null; then
  warn "Something is already listening on port $PORT (a Hermes dashboard started by hand, or Hermes desktop's own)."
  if ask "    Stop it so the service can take over?"; then
    lsof -ti tcp:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
    sleep 2
  else
    die "port $PORT is busy; stop it or pass --port."
  fi
fi

if [ "$OS" = Darwin ]; then
  # Hermes.app: the dashboard runs as its child, so one Full Disk Access grant covers Hermes, its bots
  # and their scripts (otherwise macOS keeps asking "python3 would like to access...").
  if [ ! -x "$LAUNCHER_EXE" ]; then
    if command -v clang >/dev/null 2>&1; then
      mkdir -p "$LAUNCHER_APP/Contents/MacOS"
      clang -O2 -o "$LAUNCHER_EXE" "$SOURCE/server/launcher-macos/hermes-launcher.c"
      cp "$SOURCE/server/launcher-macos/Info.plist" "$LAUNCHER_APP/Contents/Info.plist"
      codesign --force --sign - --identifier com.hermes.launcher "$LAUNCHER_APP" >/dev/null 2>&1 || true
      NEW_LAUNCHER=1
      note "Built $LAUNCHER_APP"
    else
      warn "No compiler (install Xcode Command Line Tools: xcode-select --install) — skipping Hermes.app; macOS may show permission prompts."
    fi
  fi
  LAUNCHER_ARG=""
  [ -x "$LAUNCHER_EXE" ] && LAUNCHER_ARG="<string>$LAUNCHER_EXE</string>"
  mkdir -p "$HOME/Library/LaunchAgents"
  PLIST="$HOME/Library/LaunchAgents/$DASH_LABEL.plist"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$DASH_LABEL</string>
  <key>ProgramArguments</key><array>
    $LAUNCHER_ARG<string>$HERMES_BIN</string><string>dashboard</string>
    <string>--host</string><string>$HOST</string>
    <string>--port</string><string>$PORT</string>
    <string>--no-open</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/shared-dashboard.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/shared-dashboard.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/$DASH_LABEL" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break; sleep 1; done
  launchctl print "gui/$(id -u)/$DASH_LABEL" >/dev/null 2>&1 || die "couldn't start the dashboard service (see $LOG_DIR/shared-dashboard.log)"
  note "launchd service $DASH_LABEL (starts at login, restarts if it stops)."
else
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/hermes-mobile-dashboard.service" <<UNIT
[Unit]
Description=Hermes dashboard for Hermes Mobile
After=network-online.target

[Service]
ExecStart=$HERMES_BIN dashboard --host $HOST --port $PORT --no-open
Restart=always
RestartSec=10
StandardOutput=append:$LOG_DIR/shared-dashboard.log
StandardError=append:$LOG_DIR/shared-dashboard.log

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable hermes-mobile-dashboard.service >/dev/null 2>&1
  systemctl --user restart hermes-mobile-dashboard.service
  if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
    loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER" 2>/dev/null \
      || warn "Couldn't enable lingering; Hermes starts when you log in. For start-at-boot run: sudo loginctl enable-linger $USER"
  fi
  note "systemd user service hermes-mobile-dashboard (starts at boot, restarts if it stops)."
fi

if [ "$NETWORK" = tailscale ]; then
  "$TAILSCALE" serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null 2>&1 \
    || warn "tailscale serve failed; enable HTTPS for your tailnet (https://tailscale.com/kb/1153) and re-run."
fi
wait_for_dashboard || die "the dashboard didn't come up (see $LOG_DIR/shared-dashboard.log)"
note "Dashboard is running."

# ── 5. Push relay and relay connector ────────────────────────────────────────────────────────────
if [ -n "$(node_bin)" ]; then HAVE_NODE=1; else HAVE_NODE=0; fi
if [ "$PUSH" = 1 ]; then
  step "Push-notification relay"
  if [ "$HAVE_NODE" = 0 ]; then
    warn "No Node.js 22+ found (Hermes normally ships one in ~/.hermes/tools) — skipping push notifications."
  else
    mkdir -p "$HERMES_HOME/mobile-push-relay"
    cp "$SOURCE/server/push-relay/relay.mjs" "$HERMES_HOME/mobile-push-relay/relay.mjs"
    SVC_ENV="HERMES_URL=http://127.0.0.1:$PORT
HERMES_USERNAME=$USERNAME_VALUE
HERMES_PASSWORD=$PASSWORD_VALUE"
    node_service "$PUSH_LABEL" hermes-mobile-push.service "Hermes Mobile push-notification relay" \
      "$HERMES_HOME/mobile-push-relay/relay.mjs" mobile-push-relay
    note "Relay running with $(node_bin). Turn notifications on in the app: Settings → Notifications."
  fi
fi

if [ "$NETWORK" = relay ]; then
  step "Relay connector"
  [ "$HAVE_NODE" = 1 ] || die "the relay connector needs Node.js 22+ (Hermes normally ships one in ~/.hermes/tools)."
  mkdir -p "$HERMES_HOME/mobile-relay-connector"
  cp "$SOURCE/server/connector/connector.mjs" "$HERMES_HOME/mobile-relay-connector/connector.mjs"
  : > "$LOG_DIR/mobile-relay-connector.log"
  SVC_ENV="RELAY_URL=$RELAY_URL
RELAY_TOKEN=$RELAY_TOKEN
RELAY_HOST_ID=$RELAY_HOST_ID
HERMES_URL=http://127.0.0.1:$PORT"
  node_service "$CONNECTOR_LABEL" hermes-mobile-connector.service "Hermes Mobile relay connector" \
    "$HERMES_HOME/mobile-relay-connector/connector.mjs" mobile-relay-connector
  for _ in $(seq 1 15); do grep -q "connected:" "$LOG_DIR/mobile-relay-connector.log" 2>/dev/null && break; sleep 1; done
  if grep -q "connected:" "$LOG_DIR/mobile-relay-connector.log" 2>/dev/null; then note "Connected to $RELAY_URL."
  else warn "The connector hasn't reached the relay yet; see $LOG_DIR/mobile-relay-connector.log"; fi
else
  remove_service "$CONNECTOR_LABEL" hermes-mobile-connector.service
fi

# ── 6. Optional: voice ────────────────────────────────────────────────────────────────────────────
if [ "$VOICE" = 1 ]; then
  step "ElevenLabs voice for every bot"
  KEY="$(env_get "$ENV_FILE" ELEVENLABS_API_KEY)"
  if [ -z "$KEY" ]; then
    warn "No ELEVENLABS_API_KEY in $ENV_FILE. Add it (hermes config set ELEVENLABS_API_KEY <key>) and re-run with --voice."
  else
    profiles | while IFS=: read -r name home; do
      # Hermes keeps secrets per profile and never falls back to the default profile's key.
      [ -n "$(env_get "$home/.env" ELEVENLABS_API_KEY)" ] || env_set "$home/.env" ELEVENLABS_API_KEY "$KEY"
      if grep -qE '^tts:' "$home/config.yaml" 2>/dev/null; then
        note "$name: kept its own TTS setup"
      else
        hermes_for "$name" config set tts.provider elevenlabs >/dev/null
        hermes_for "$name" config set tts.elevenlabs.model_id eleven_flash_v2_5 >/dev/null
        note "$name: ElevenLabs (pick its voice in the app: Bots → the bot → Voice)"
      fi
    done
  fi
fi

# ── 7. Optional: 1Password ────────────────────────────────────────────────────────────────────────
if [ "$ONEPASSWORD" = 1 ]; then
  step "1Password service account for every bot"
  note "Service accounts can't read your built-in Personal/Private vault: give it read-only access to a dedicated vault."
  TOKEN=""
  if [ -r /dev/tty ]; then
    printf '    Paste the service-account token (ops_..., hidden): ' > /dev/tty
    read -rs TOKEN < /dev/tty || true
    printf '\n' > /dev/tty
  fi
  TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
  case "$TOKEN" in
    ops_*)
      profiles | while IFS=: read -r name home; do
        env_set "$home/.env" OP_SERVICE_ACCOUNT_TOKEN "$TOKEN"
        hermes_for "$name" config set secrets.onepassword.enabled true >/dev/null
        # Bots' own commands (op read, op item get) get the token too; without it op falls back to the
        # 1Password desktop app, which prompts on this computer every time.
        current="$(hermes_for "$name" config get terminal.env_passthrough | sed -nE 's/^ *- *//p' | tr -d "'\"")"
        list="$( { printf '%s\n' $current; echo OP_SERVICE_ACCOUNT_TOKEN; } | sort -u | sed '/^$/d' | awk 'BEGIN{printf "["} {printf "%s\"%s\"", (NR>1?", ":""), $0} END{printf "]"}')"
        hermes_for "$name" config set terminal.env_passthrough "$list" >/dev/null
        note "$name: ready"
      done
      if command -v op >/dev/null 2>&1; then
        OP_SERVICE_ACCOUNT_TOKEN="$TOKEN" op vault list >/dev/null 2>&1 && note "Token works." || warn "op couldn't use that token; check it on 1Password.com."
      else
        warn "The 1Password CLI (op) isn't installed; install it: https://developer.1password.com/docs/cli/get-started/"
      fi
      ;;
    *) warn "That isn't a service-account token (they start with ops_); skipped." ;;
  esac
fi

# ── 8. Optional: real browser ─────────────────────────────────────────────────────────────────────
for bot in $REAL_BROWSER; do
  step "Real Chrome profile for $bot"
  hermes_for "$bot" config set browser.use_real_profile true >/dev/null
  hermes_for "$bot" config set browser.headed true >/dev/null
  note "$bot browses with a copy of your Chrome profile in a visible window (sites like Google trust it)."
  note "It gets that profile's cookies and logins. Keep Chrome closed while it browses."
done

# ── 9. Restart and check ──────────────────────────────────────────────────────────────────────────
step "Checking"
if [ "$OS" = Darwin ]; then launchctl kickstart -k "gui/$(id -u)/$DASH_LABEL" >/dev/null 2>&1 || true
else systemctl --user restart hermes-mobile-dashboard.service; fi
wait_for_dashboard || die "the dashboard didn't come back (see $LOG_DIR/shared-dashboard.log)"
# Everything past this computer must meet a sign-in page; an ungated Hermes hands out its session token.
if ! curl -s -m 5 "http://127.0.0.1:$PORT/api/status" | grep -q '"auth_required": *true'; then
  remove_service "$CONNECTOR_LABEL" hermes-mobile-connector.service
  die "Hermes isn't requiring sign-in, so it wasn't exposed. Check HERMES_DASHBOARD_BASIC_AUTH_* in $ENV_FILE and dashboard.public_url."
fi
JAR="$(mktemp)"
LOGIN_BODY="{\"provider\":\"basic\",\"username\":\"$(json_escape "$USERNAME_VALUE")\",\"password\":\"$(json_escape "$PASSWORD_VALUE")\"}"
if curl -s -m 10 -c "$JAR" -H 'Content-Type: application/json' -d "$LOGIN_BODY" "http://127.0.0.1:$PORT/auth/password-login" -o /dev/null -w '%{http_code}' | grep -q '^2' \
   && curl -s -m 10 -b "$JAR" "http://127.0.0.1:$PORT/api/plugins/hermes-mobile/capabilities" | grep -q '"hermes-mobile"'; then
  note "Sign-in and the hermes-mobile plugin work."
else
  warn "Couldn't confirm the plugin through the dashboard; check $LOG_DIR/shared-dashboard.log."
fi
rm -f "$JAR"

if [ "$OS" = Darwin ] && [ "${NEW_LAUNCHER:-0}" = 1 ]; then
  step "One manual step: Full Disk Access"
  note "So bots never stop on macOS permission prompts while you're away:"
  note "System Settings → Privacy & Security → Full Disk Access → + → your home folder → Applications → Hermes."
  if [ -z "${HERMES_MOBILE_NO_OPEN:-}" ]; then
    open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles" >/dev/null 2>&1 || true
    open -R "$LAUNCHER_APP" >/dev/null 2>&1 || true
  fi
fi

show_pairing
printf '\n'
bold "Done. Next: install Hermes Mobile on your phone and scan the QR code. Guide: $SITE/get-started.html"

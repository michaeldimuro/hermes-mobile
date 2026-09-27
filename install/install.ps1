# Hermes Mobile installer for Windows: connects the Hermes Mobile app to the Hermes on this PC.
#
#   irm https://raw.githubusercontent.com/michaeldimuro/hermes-mobile/main/install/install.ps1 | iex
#
# Options (set before running, because `irm | iex` can't take arguments):
#   $env:HERMES_MOBILE_NETWORK = "tailscale" | "lan" | "https://your.url"   (default: tailscale if installed, else lan)
#   $env:HERMES_MOBILE_PORT = "9119"
#   $env:HERMES_MOBILE_VOICE = "1"            ElevenLabs voice for every bot (needs ELEVENLABS_API_KEY in Hermes' .env)
#   $env:HERMES_MOBILE_ONEPASSWORD = "1"      headless 1Password for every bot (asks for a service-account token)
#   $env:HERMES_MOBILE_REAL_BROWSER = "ceo"   bots (comma-separated) that browse with a copy of your real Chrome profile
#   $env:HERMES_MOBILE_PUSH = "0"             skip the push-notification relay
#   $env:HERMES_MOBILE_PAIR = "1"             only show the pairing page again
#   $env:HERMES_MOBILE_UNINSTALL = "1"        remove what this installer added
#   $env:HERMES_MOBILE_SOURCE = "C:\path"     install from a local checkout instead of downloading
#
# Safe to re-run: it upgrades in place and keeps your existing password, so paired phones stay connected.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2

$Repo = "michaeldimuro/hermes-mobile"
$Ref = if ($env:HERMES_MOBILE_REF) { $env:HERMES_MOBILE_REF } else { "main" }
$Site = "https://michaeldimuro.github.io/hermes-mobile"
$HermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA "hermes" }
$EnvFile = Join-Path $HermesHome ".env"
$Port = if ($env:HERMES_MOBILE_PORT) { [int]$env:HERMES_MOBILE_PORT } else { 9119 }
$Network = $env:HERMES_MOBILE_NETWORK
$DashTask = "Hermes Mobile Dashboard"
$PushTask = "Hermes Mobile Push Relay"
$LogDir = Join-Path $HermesHome "logs"

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Note($text) { Write-Host "    $text" }
function Warn($text) { Write-Host "    ! $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "Error: $text" -ForegroundColor Red; throw $text }
function Flag($name) { $v = [Environment]::GetEnvironmentVariable($name); return ($v -eq "1" -or $v -eq "true" -or $v -eq "yes") }

# ── Hermes ────────────────────────────────────────────────────────────────────────────────────────
$HermesCmd = Get-Command hermes -ErrorAction SilentlyContinue
if (-not $HermesCmd) { Fail "Hermes isn't installed (no 'hermes' command). Install Hermes Agent first: https://hermes-agent.nousresearch.com/docs/" }
$HermesBin = $HermesCmd.Source
function Hermes { & $HermesBin @args 2>$null | Where-Object { $_ -notmatch "1Password:" } }
function HermesFor($botName) {
  $rest = $args
  if ($botName -eq "default") { Hermes @rest } else { Hermes -p $botName @rest }
}

function EnvGet($file, $key) {
  if (-not (Test-Path $file)) { return "" }
  $line = Get-Content $file -Encoding UTF8 | Where-Object { $_ -match "^$([regex]::Escape($key))=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  return ($line.Substring($key.Length + 1)).Trim('"', "'")
}
function EnvSet($file, $key, $value) {
  New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
  $lines = @()
  if (Test-Path $file) { $lines = @(Get-Content $file -Encoding UTF8 | Where-Object { $_ -notmatch "^$([regex]::Escape($key))=" }) }
  $lines += "$key=$value"
  [IO.File]::WriteAllLines($file, $lines, (New-Object Text.UTF8Encoding $false))
}
function EnvUnset($file, $key) {
  if (-not (Test-Path $file)) { return }
  $lines = @(Get-Content $file -Encoding UTF8 | Where-Object { $_ -notmatch "^$([regex]::Escape($key))=" })
  [IO.File]::WriteAllLines($file, $lines, (New-Object Text.UTF8Encoding $false))
}

function Profiles {
  $out = @(@{ Name = "default"; Home = $HermesHome })
  $dir = Join-Path $HermesHome "profiles"
  if (Test-Path $dir) {
    Get-ChildItem $dir -Directory | Where-Object { Test-Path (Join-Path $_.FullName "config.yaml") } |
      ForEach-Object { $out += @{ Name = $_.Name; Home = $_.FullName } }
  }
  return $out
}

function RandomText($length, $chars) {
  $bytes = New-Object byte[] $length
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function WaitForDashboard {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/api/status"
      if ($r.Content -match '"auth_required"') { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

# ── Credentials & pairing ─────────────────────────────────────────────────────────────────────────
$User = EnvGet $EnvFile "HERMES_DASHBOARD_BASIC_AUTH_USERNAME"
$Password = EnvGet $EnvFile "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD"
$PublicUrl = (Hermes config get dashboard.public_url | Select-Object -Last 1)
if ($PublicUrl) { $PublicUrl = $PublicUrl.Trim() }
if ($PublicUrl -notmatch "^https?://") { $PublicUrl = "" }

function ShowPairing {
  if (-not $Password -or -not $PublicUrl) { Fail "Hermes Mobile isn't set up yet; run the installer without HERMES_MOBILE_PAIR first." }
  $json = (@{ v = 1; url = $PublicUrl; username = $User; password = $Password } | ConvertTo-Json -Compress)
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  $link = "$Site/pair.html#$payload"
  Step "Pair your phone"
  Note "Opening your pairing page. Scan its QR code with your phone's Camera to open Hermes Mobile connected."
  Note "Or enter these in the app's Connect screen:"
  Note "  Address:  $PublicUrl"
  Note "  Username: $User"
  Note "  Password: $Password"
  Note "The link below holds your password; the part after # never leaves this PC's browser. Don't share it."
  Note $link
  if (-not $env:HERMES_MOBILE_NO_OPEN) { Start-Process $link }
}

if (Flag "HERMES_MOBILE_PAIR") { ShowPairing; return }

# ── Uninstall ─────────────────────────────────────────────────────────────────────────────────────
if (Flag "HERMES_MOBILE_UNINSTALL") {
  Step "Removing Hermes Mobile"
  foreach ($task in @($PushTask, $DashTask)) {
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  }
  $ts = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($ts) { & $ts.Source serve --https=443 off 2>$null | Out-Null }
  Hermes plugins disable hermes-mobile | Out-Null
  Remove-Item -Recurse -Force (Join-Path $HermesHome "plugins\hermes-mobile"), (Join-Path $HermesHome "mobile-push-relay") -ErrorAction SilentlyContinue
  foreach ($k in "HERMES_DASHBOARD_BASIC_AUTH_USERNAME", "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD", "HERMES_DASHBOARD_BASIC_AUTH_SECRET") { EnvUnset $EnvFile $k }
  Hermes config set dashboard.public_url "" | Out-Null
  Note "Removed the scheduled tasks, plugin, relay and dashboard sign-in. Voice, 1Password and browser settings on your bots are kept."
  return
}

Write-Host "Hermes Mobile installer" -ForegroundColor White
Note ("Hermes: " + (Hermes --version | Select-Object -First 1))

# ── Source files ──────────────────────────────────────────────────────────────────────────────────
$Source = $env:HERMES_MOBILE_SOURCE
if (-not $Source -and $PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "..\server\plugin"))) { $Source = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
if (-not $Source) {
  Step "Downloading Hermes Mobile ($Ref)"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("hermes-mobile-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp "src.zip"
  Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip
  Expand-Archive $zip -DestinationPath $tmp
  $Source = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
}
if (-not (Test-Path (Join-Path $Source "server\plugin"))) { Fail "couldn't find server\plugin in $Source" }

# ── 1. Plugin ─────────────────────────────────────────────────────────────────────────────────────
Step "Installing the hermes-mobile Hermes plugin"
$PluginDir = Join-Path $HermesHome "plugins\hermes-mobile"
$OldPlugin = Join-Path $HermesHome "plugins\mobile-browser"
if (Test-Path $OldPlugin) { Hermes plugins disable mobile-browser | Out-Null; Remove-Item -Recurse -Force $OldPlugin }
if (Test-Path $PluginDir) { Remove-Item -Recurse -Force $PluginDir }
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $Source "server\plugin\*") $PluginDir
Hermes plugins enable hermes-mobile | Out-Null
Note "Installed to $PluginDir and enabled."

# ── 2. Sign-in ────────────────────────────────────────────────────────────────────────────────────
Step "Dashboard sign-in"
$Alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
if (-not $User) { $User = "hermes"; EnvSet $EnvFile "HERMES_DASHBOARD_BASIC_AUTH_USERNAME" $User }
if (-not $Password) {
  $Password = RandomText 24 $Alnum
  EnvSet $EnvFile "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD" $Password
  Note "Generated a password for user '$User'."
} else { Note "Keeping the existing password for user '$User' (paired phones stay connected)." }
if (-not (EnvGet $EnvFile "HERMES_DASHBOARD_BASIC_AUTH_SECRET")) { EnvSet $EnvFile "HERMES_DASHBOARD_BASIC_AUTH_SECRET" (RandomText 64 "0123456789abcdef") }

# ── 3. Network ────────────────────────────────────────────────────────────────────────────────────
$Tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $Tailscale -and (Test-Path "C:\Program Files\Tailscale\tailscale.exe")) { $Tailscale = Get-Command "C:\Program Files\Tailscale\tailscale.exe" }
if (-not $Network) {
  $Network = "lan"
  if ($Tailscale) { & $Tailscale.Source status 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $Network = "tailscale" } }
}
Step "Network access ($Network)"
$BindHost = "127.0.0.1"
if ($Network -eq "tailscale") {
  if (-not $Tailscale) { Fail "Tailscale isn't installed. Install it (https://tailscale.com/download) and sign in, or set HERMES_MOBILE_NETWORK=lan." }
  $status = & $Tailscale.Source status --json | ConvertFrom-Json
  $dns = $status.Self.DNSName.TrimEnd(".")
  if (-not $dns) { Fail "Tailscale isn't signed in. Sign in, then re-run." }
  $PublicUrl = "https://$dns"
} elseif ($Network -eq "lan") {
  $BindHost = "0.0.0.0"
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -in "Dhcp", "Manual" -and $_.IPAddress -notmatch "^(127|169\.254)\." } | Select-Object -First 1).IPAddress
  if (-not $ip) { Fail "couldn't find this PC's local IP address; set HERMES_MOBILE_NETWORK to a URL." }
  $PublicUrl = "http://${ip}:$Port"
  Warn "LAN mode is plain HTTP on your local network; only use it on networks you trust."
  New-NetFirewallRule -DisplayName "Hermes Mobile dashboard" -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Private -Action Allow -ErrorAction SilentlyContinue | Out-Null
} elseif ($Network -match "^https?://") {
  $PublicUrl = $Network.TrimEnd("/")
  Note "Point your proxy or tunnel at http://127.0.0.1:$Port."
} else { Fail "HERMES_MOBILE_NETWORK must be tailscale, lan, or a URL" }
Hermes config set dashboard.public_url $PublicUrl | Out-Null
Note "Your phone will connect to $PublicUrl"

# ── 4. Dashboard service (a logon task; restarts if it stops) ─────────────────────────────────────
Step "Running Hermes as a background task"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
$ours = Get-ScheduledTask -TaskName $DashTask -ErrorAction SilentlyContinue
if ($busy -and -not $ours) {
  Warn "Something is already listening on port $Port (a Hermes dashboard started by hand, or Hermes desktop's own)."
  $answer = Read-Host "    Stop it so the task can take over? [y/N]"
  if ($answer -notmatch "^(y|yes)$") { Fail "port $Port is busy; stop it or set HERMES_MOBILE_PORT." }
  $busy | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
function RegisterTask($name, $exe, $arguments, $environment) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  # powershell -WindowStyle Hidden keeps a console window from popping up at logon.
  $script = ""
  foreach ($k in $environment.Keys) { $script += "`$env:$k='$($environment[$k] -replace "'", "''")'; " }
  $script += "& '$exe' $arguments *>> '$(Join-Path $LogDir ($name -replace ' ', '-')).log'"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $encoded"
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "Hermes Mobile" | Out-Null
  Start-ScheduledTask -TaskName $name
}
RegisterTask $DashTask $HermesBin "dashboard --host $BindHost --port $Port --no-open" @{}
if ($Network -eq "tailscale") {
  & $Tailscale.Source serve --bg --https=443 "http://127.0.0.1:$Port" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Warn "tailscale serve failed; enable HTTPS for your tailnet (https://tailscale.com/kb/1153) and re-run." }
}
if (-not (WaitForDashboard)) { Fail "the dashboard didn't come up (see $LogDir)" }
Note "Scheduled task '$DashTask' (starts when you sign in to Windows)."

# ── 5. Push relay ─────────────────────────────────────────────────────────────────────────────────
if ($env:HERMES_MOBILE_PUSH -ne "0") {
  Step "Push-notification relay"
  $node = Get-ChildItem (Join-Path $HermesHome "tools") -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -Last 1
  $nodePath = if ($node) { $node.FullName } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
  if (-not $nodePath) { Warn "No Node.js 22+ found — skipping push notifications." }
  else {
    $relayDir = Join-Path $HermesHome "mobile-push-relay"
    New-Item -ItemType Directory -Force -Path $relayDir | Out-Null
    Copy-Item -Force (Join-Path $Source "server\push-relay\relay.mjs") $relayDir
    RegisterTask $PushTask $nodePath "'$(Join-Path $relayDir 'relay.mjs')'" @{ HERMES_URL = "http://127.0.0.1:$Port"; HERMES_USERNAME = $User; HERMES_PASSWORD = $Password }
    Note "Relay running with $nodePath. Turn notifications on in the app: Settings → Notifications."
  }
}

# ── 6. Optional: voice ────────────────────────────────────────────────────────────────────────────
if (Flag "HERMES_MOBILE_VOICE") {
  Step "ElevenLabs voice for every bot"
  $key = EnvGet $EnvFile "ELEVENLABS_API_KEY"
  if (-not $key) { Warn "No ELEVENLABS_API_KEY in $EnvFile. Add it and re-run with HERMES_MOBILE_VOICE=1." }
  else {
    foreach ($p in Profiles) {
      if (-not (EnvGet (Join-Path $p.Home ".env") "ELEVENLABS_API_KEY")) { EnvSet (Join-Path $p.Home ".env") "ELEVENLABS_API_KEY" $key }
      if (Select-String -Path (Join-Path $p.Home "config.yaml") -Pattern "^tts:" -Quiet) { Note "$($p.Name): kept its own TTS setup"; continue }
      HermesFor $p.Name config set tts.provider elevenlabs | Out-Null
      HermesFor $p.Name config set tts.elevenlabs.model_id eleven_flash_v2_5 | Out-Null
      Note "$($p.Name): ElevenLabs"
    }
  }
}

# ── 7. Optional: 1Password ────────────────────────────────────────────────────────────────────────
if (Flag "HERMES_MOBILE_ONEPASSWORD") {
  Step "1Password service account for every bot"
  Note "Service accounts can't read your built-in Personal/Private vault: give it read-only access to a dedicated vault."
  $secure = Read-Host "    Paste the service-account token (ops_..., hidden)" -AsSecureString
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
  if ($token -notmatch "^ops_") { Warn "That isn't a service-account token (they start with ops_); skipped." }
  else {
    foreach ($p in Profiles) {
      EnvSet (Join-Path $p.Home ".env") "OP_SERVICE_ACCOUNT_TOKEN" $token
      HermesFor $p.Name config set secrets.onepassword.enabled true | Out-Null
      $current = @(HermesFor $p.Name config get terminal.env_passthrough | ForEach-Object { ($_ -replace "^\s*-\s*", "").Trim("'", '"', " ") } | Where-Object { $_ -and $_ -notmatch "[\[\]:]" })
      $list = @($current + "OP_SERVICE_ACCOUNT_TOKEN" | Sort-Object -Unique)
      HermesFor $p.Name config set terminal.env_passthrough ("[" + (($list | ForEach-Object { '"' + $_ + '"' }) -join ", ") + "]") | Out-Null
      Note "$($p.Name): ready"
    }
  }
}

# ── 8. Optional: real browser ─────────────────────────────────────────────────────────────────────
if ($env:HERMES_MOBILE_REAL_BROWSER) {
  foreach ($bot in ($env:HERMES_MOBILE_REAL_BROWSER -split "[, ]+" | Where-Object { $_ })) {
    Step "Real Chrome profile for $bot"
    HermesFor $bot config set browser.use_real_profile true | Out-Null
    HermesFor $bot config set browser.headed true | Out-Null
    Note "$bot browses with a copy of your Chrome profile in a visible window. It gets that profile's cookies. Keep Chrome closed while it browses."
  }
}

# ── 9. Restart and check ──────────────────────────────────────────────────────────────────────────
Step "Checking"
Stop-ScheduledTask -TaskName $DashTask -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName $DashTask
if (-not (WaitForDashboard)) { Fail "the dashboard didn't come back (see $LogDir)" }
try {
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $body = @{ provider = "basic"; username = $User; password = $Password } | ConvertTo-Json -Compress
  Invoke-WebRequest -UseBasicParsing -WebSession $session -Method Post -ContentType "application/json" -Body $body "http://127.0.0.1:$Port/auth/password-login" | Out-Null
  $caps = Invoke-WebRequest -UseBasicParsing -WebSession $session "http://127.0.0.1:$Port/api/plugins/hermes-mobile/capabilities"
  if ($caps.Content -match '"hermes-mobile"') { Note "Sign-in and the hermes-mobile plugin work." } else { throw "no plugin" }
} catch { Warn "Couldn't confirm the plugin through the dashboard; check the logs in $LogDir." }

ShowPairing
Write-Host "`nDone. Next: install Hermes Mobile on your phone and scan the QR code. Guide: $Site/get-started.html" -ForegroundColor White

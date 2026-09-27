# Publishing to the App Store (iOS)

The official build is published by the **Linq, Inc.** Apple Developer team (8YDKKLWGXU) with bundle id `com.mndimuro.hermesmobile`. Forks publishing their own copy: see [self-build.md](self-build.md).

## 1. Build (once per release)

App Store builds need App Store provisioning profiles for the app and its two extensions (Share, Widget). EAS creates them the first time, which needs an interactive Apple sign-in:

```bash
cd app
npx eas-cli@latest build --profile production --platform ios
```

Sign in with an Apple ID on the Linq, Inc. team (Admin or App Manager) when asked, and let EAS generate the profiles. Later releases can run non-interactively (`--non-interactive`).

## 2. Create the App Store Connect record

In [App Store Connect](https://appstoreconnect.apple.com) → Apps → **+** → New App: platform iOS, name **Hermes Mobile** (pick an alternative if taken), bundle id `com.mndimuro.hermesmobile`, SKU `hermes-mobile`, primary language English (U.S.).

## 3. Submit to TestFlight

```bash
npx eas-cli@latest submit --platform ios --latest
```

EAS asks for the App Store Connect app and an App Store Connect API key (it can create one). Put the resulting `ascAppId` in `app/eas.json` under `submit.production.ios` so later submissions don't ask. The build appears in TestFlight after Apple's processing (usually under an hour); add internal testers there.

## 4. Store listing

| Field | Value |
| --- | --- |
| Name | Hermes Mobile |
| Subtitle | Your Hermes agents, anywhere |
| Category | Productivity (secondary: Developer Tools) |
| Privacy policy URL | https://michaeldimuro.github.io/hermes-mobile/privacy.html |
| Support URL | https://michaeldimuro.github.io/hermes-mobile/troubleshooting.html |
| Marketing URL | https://michaeldimuro.github.io/hermes-mobile/ |
| Keywords | hermes,ai agent,assistant,self-hosted,automation,chat,voice,bots,kanban,nous |
| Age rating | 17+ is the safe choice: the app displays unrestricted AI-generated content and web pages from the user's own agents. |

**Description**

> Hermes Mobile is the companion app for Hermes Agent, the open-source agent framework you run on your own Mac, Linux or Windows computer. Chat with every one of your bots, anywhere.
>
> • Live, streaming conversations with every bot, including their reasoning and tool calls
> • Approve commands and answer your agents' questions from your phone
> • Voice mode: talk hands-free and hear replies in each bot's own voice
> • Screen share for sign-ins: when a bot hits a login, 2FA or captcha, finish it on the bot's live browser and it carries on
> • Group chats, skills, mentions, files, images and PDFs
> • Push notifications, Kanban boards, automations and usage
> • Home Screen widget, Live Activity, Face ID lock, offline cache
>
> Hermes Mobile connects directly to your own Hermes: no account, no analytics, and nothing hosted by us. Set up your computer in one command at michaeldimuro.github.io/hermes-mobile.

**Screenshots** (required): 6.9" iPhone (1320 × 2868) at minimum; 6.5" (1284 × 2778) is also accepted. Take them on a Pro Max-class iPhone (Side + Volume Up) of: the inbox, a chat with a streamed reply, voice mode, the screen-share viewer, and the bot editor. Use a demo setup, not your real conversations.

## 5. App Privacy ("nutrition label")

Answer **Data Not Collected**: the developer collects nothing. Everything goes to the user's own server (see [privacy.html](../website/privacy.html)). Push notification delivery uses the push token only to deliver notifications the user turned on, through Expo and Apple.

## 6. Review notes — a demo server is required

Apple rejects apps that need a sign-in reviewers can't complete (guideline 2.1). Reviewers can't install Hermes, so give them a working, **separate demo Hermes**, never your real one:

1. Run a second Hermes home for the demo on the Mac: `HERMES_HOME=~/.hermes-demo hermes setup` with one friendly bot (a cheap model with a spending cap).
2. Expose only that instance publicly with HTTPS and a password (e.g. a relay host id for it, or [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) on its port).
3. In App Review Information, provide the address, username and password, plus notes:

> Hermes Mobile is a client for Hermes Agent, open-source software users run on their own computer (like a remote control for a home server). To review: open the app, tap "Use a username & password instead" if needed, enter the address, username and password above, and tap Connect. Chat with the "Demo" bot. Voice mode is the waveform button in the message box. The app has no account system of its own; the credentials belong to a demo Hermes we run for review.

Keep the demo online until the app is approved, and for each update's review.

## 7. Release

After TestFlight testing: App Store Connect → the version → select the build → Submit for Review. Then update the website's "Install the app" section with the App Store link.

# Build the app yourself

Until Hermes Mobile is on TestFlight and the App Store, build it with your own free [Expo](https://expo.dev) account. Builds run in the cloud with EAS, so you don't need Xcode or Android Studio. An iPhone build needs an Apple Developer account to install on a device.

## 1. Install dependencies

```bash
git clone https://github.com/michaeldimuro/hermes-mobile.git
cd hermes-mobile/app
npm install
```

## 2. Use your own identifiers

`app/app.config.ts` reads these environment variables, so you don't need to edit any files:

| Variable | Example | Purpose |
| --- | --- | --- |
| `HERMES_MOBILE_BUNDLE_ID` | `com.yourname.hermesmobile` | iOS bundle identifier / Android package name. Must be unique to you. |
| `HERMES_MOBILE_EXPO_OWNER` | `yourname` | Your Expo account or organization. |
| `HERMES_MOBILE_EAS_PROJECT_ID` | `xxxxxxxx-xxxx-...` | Your EAS project ID (printed by `eas init`). |

```bash
export HERMES_MOBILE_BUNDLE_ID=com.yourname.hermesmobile
export HERMES_MOBILE_EXPO_OWNER=yourname
```

## 3. Create the EAS project

```bash
npx eas-cli@latest login
npx eas-cli@latest init
export HERMES_MOBILE_EAS_PROJECT_ID=<the project ID it printed>
```

## 4. Development build

```bash
npx eas-cli@latest build --profile development --platform ios      # or: --platform android
```

Install the build on your phone from the link EAS gives you, then start the dev server:

```bash
npx expo start
```

## 5. Production build (optional)

```bash
npx eas-cli@latest build --profile production --platform ios       # or android
npx eas-cli@latest submit --platform ios                           # TestFlight / Play Console
```

## Notes

- JavaScript changes reload instantly in a development build. Changes to native configuration (app config, plugins, permissions, adding a library with native code) require a new build.
- Keep the same environment variables set for every build, or the app will be treated as a different app.
- Then pair the app with your computer: see the [setup guide](https://michaeldimuro.github.io/hermes-mobile/get-started.html).

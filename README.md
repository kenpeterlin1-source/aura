# AuraStream

Adaptive sleep audio: generated soundscapes + a slow beat tone, adapting to the sleeper's heart rate and sleep stage.
Product plan, decisions and test logs: `ideas/aurastream.md` in the private `personal` repo.

## What's here
| Path | What |
|---|---|
| `index.html`, `aurastream-marketing_1.html`, `aurastream-app.html` | Original website + design mock-up (GitHub Pages) |
| `mobile/` | The app (Expo / React Native, Android + iPhone + web) |
| `watch/` | Zepp OS watch app for Amazfit (skeleton, API 3.0) |
| `watch-tools/` | Local install of Zepp's `zeus` CLI |
| `builds/` | Local APKs (not in git) |

## Resume here (2026-09-28)
- **Phone app 0.2.0**: 4 protocols, soundscapes (pink, brown, ocean, rain, stream, wind), sleep timer, wake ramp,
  live sleep-stage estimate from Bluetooth heart rate (Amazfit "Heart rate broadcast") + phone motion. Audio doesn't react to
  the stage yet. Test build 0.1.0 is a GitHub pre-release; 0.2.0 is built locally for install via adb.
- **Tonight's test**: install 0.2.0, battery log (watch/phone % at bed and wake), minimal watch settings.
- **Next**: Zepp OS watch app (Ken: developer account at console.zepp.com, developer mode in Zepp, then `zeus preview` QR);
  Health Connect morning report; compare estimate vs Zepp stages; then let the stage drive the audio.

## Build
```
cd mobile && npm install
npx expo start --web                      # browser
npx expo prebuild --platform android      # then in android/: add local.properties sdk.dir, and
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```
Watch: from `watch/`, run `../watch-tools/node_modules/.bin/zeus build` (or `preview`). If watch-tools was reinstalled,
re-link: `ln -sfn @zeppos/zeus-cli/private-modules/zeppos-app-utils watch-tools/node_modules/zeppos-app-utils`.

# Boltyard — iPhone app

Boltyard wrapped as a native iPhone app with [Capacitor](https://capacitorjs.com). It runs fullscreen and offline, keeps the screen on, and is locked to portrait.

## What's in here

| Folder | What it is |
|---|---|
| `game/` | The game's source: `src/`, `tools/`, and `SPEC.md` (the design contract). `node game/tools/build.js --app` builds the offline page. |
| `www/index.html` | The built offline page that ships inside the app. CI rebuilds it on every push. |
| `ios/` | The Xcode project. `GameViewController` (in `AppDelegate.swift`) hides the status bar, defers edge swipes and stops the web view from scrolling. `SceneDelegate.swift` keeps the screen awake. |
| `.github/workflows/ios.yml` | Builds an **unsigned** `Boltyard.ipa` on a GitHub cloud Mac. |

## Home Screen web app (no install tool needed)

**https://maxymaster.github.io/boltyard-app/** is the same game as an offline web app. On iPhone, open it in Safari, tap **Share → Add to Home Screen**, then open the icon once while online. After that it works offline and never expires. Every push that touches `game/` republishes it (`.github/workflows/pages.yml`), and the icon picks up the new version the next time it's opened online.

Its save lives only inside the Home Screen app. **Settings → Copy save code / Restore from code** moves progress between the web app, the iPhone app and claude.ai, or backs it up.

Build it locally with `node game/tools/build.js --pwa`, which writes `game/dist-web/`.

## Getting a new build onto your iPhone

1. Push to `main`, or run it by hand: **Actions → Build iPhone app → Run workflow**. A build takes about 10 minutes.
2. Open the finished run and download the **Boltyard-ipa-build-N** artifact. Unzip it to get `Boltyard.ipa`.
3. Plug your iPhone into the PC, open **Sideloadly**, and drag `Boltyard.ipa` in. Enter your Apple ID and click **Start**.
4. The first time only, on the iPhone:
   - Go to **Settings → General → VPN & Device Management**, tap your Apple ID and choose **Trust**.
   - Make sure **Settings → Privacy & Security → Developer Mode** is on.

## The free-account rules

- **7-day limit.** An app signed with a free Apple ID stops opening after 7 days. Re-install the same `.ipa` with Sideloadly to reset the 7 days; your save is kept.
- **Updates keep your save** if you install over the existing app with the same Apple ID. Deleting the app deletes the save.
- **3 sideloaded apps** at once per phone, and **10 new app IDs per week**. Updating the same app doesn't use new IDs.

## Changing the game

Edit `game/src/…`, then run `node game/tools/build.js` (web page) or `npm run build:web` (app page). Run the test suites in `game/tools/` before pushing; `SPEC.md` describes them. The web build (`game/dist/index.html`) is what's published as the claude.ai artifact.

Fonts: Chakra Petch and Saira Stencil One (SIL Open Font License), bundled in `game/tools/fonts/`.

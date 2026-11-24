# Building the Quarc Draw desktop app

The desktop app is a [Tauri 2](https://tauri.app) window that carries **its own copy of the page**, so Quarc Draw opens and
draws without the Quarc server (like the Windows Quarc Weather app). The server (`https://quarcnet0.tail84500c.ts.net:4009`)
is only used to sign in and to sync: its address is baked into the page at build time (`VITE_API_URL`). The shell adds the
installer, a native "Save as" dialog (Mac / Linux; WebView2 on Windows has its own) and the Quarc Store sign-in commands.

## Prerequisites (one-time setup)

1. **Rust** — https://rustup.rs (restart your terminal afterwards)
2. **Node.js** — https://nodejs.org (v20 or newer)
3. **WebView2** — already installed on Windows 10/11

## Icons

`logo.png` (1024 px) is an export of the master `QuarcNet/logos/draw.svg`. After changing it:

```
cd desktop
npx tauri icon logo.png -o src-tauri/icons
```

(then delete the `android/` and `ios/` folders it adds inside `src-tauri/icons`).

## Build the installer

The page is built first and copied into `desktop/dist/` (the folder only holds a placeholder in git):

```
cd frontend
npm ci
VITE_API_URL=https://quarcnet0.tail84500c.ts.net:4009 npm run build     # PowerShell: $env:VITE_API_URL="..."; npm run build
cp -r dist/* ../desktop/dist/

cd ../desktop
npm install
npm run build
```

The installer is written to `src-tauri/target/release/bundle/nsis/Quarc Draw_1.0.0_x64-setup.exe`. Pushing a `vX.Y.Z` tag
does all of this for Windows, macOS and Linux (and builds the Android APK) in GitHub Actions — see
`.github/workflows/desktop-release.yml`. The copied files are ignored by git except `desktop/dist/index.html`, which the copy overwrites: put the placeholder back
after a local build with `git checkout -- desktop/dist/index.html`.

## Things that bite

- The window shows the app's own page (`http://tauri.localhost` on Windows). That page must not register a service worker
  (it would serve the previous version's page after an update) — `frontend/src/main.tsx` skips it there.
- `src-tauri/capabilities/default.json` is for the app's own origin: opening links, the native Save dialog and the three
  `quarc_sso_*` commands (declared in `build.rs`). The commands only hand the Quarc Store login to the Quarc server.
- Window settings live in `tauri.conf.json` (there is no platform override file here; see Quarc Weather for how
  `tauri.windows.conf.json` replaces the window list).
- Test builds that share this app's identifier share its saved data with an installed Quarc Draw. Use a throwaway identifier:
  `TAURI_CONFIG='{"identifier":"com.quarc.testdraw"}' cargo build --features tauri/custom-protocol`.

## Certificate requirement

Users must install and trust the server certificate **before** opening the sync parts of the app, exactly as described in
Quarc Music's `README_Users.md` (Windows section) — the same Tailscale cert covers every Quarc app on this host.

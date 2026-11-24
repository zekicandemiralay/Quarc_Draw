# Quarc Draw — notes for Claude sessions

Layered raster + vector drawing studio (Studio / Notes / Reader workspaces) in the QuarcNet suite. Package `com.quarc.draw`,
GitHub `zekicandemiralay/Quarc_Draw`, web port **4009** on `quarcnet0.tail84500c.ts.net`. See README.md for features and the
exact commands.

## Layout

`frontend/` (Vite + React + TypeScript, Canvas 2D; tests in `frontend/tests`), `backend/` (zero-dependency Node sync server),
`desktop/` (Tauri 2, Windows/macOS/Linux, bundled page), `mobile/` (Capacitor 6 Android), plus docker-compose.yml, deploy.sh,
check.sh, backup.sh, restore.sh and `.github/workflows/{tests,desktop-release}.yml`.

## Decisions worth knowing

- **Local-first.** Drawing never needs an account. The shared Quarc login (quarc-auth cookie `token`, HS256 JWT, same
  `JWT_SECRET` as every app) only turns on sync (`frontend/src/app/account.ts`, `sync/providers.ts` `QuarcServerProvider`,
  `backend/src/index.mjs`). Documents are stored under the account **id** (`users/<sha256(id)>/…`).
- **Sync wire format is a contract:** `GET /api/ping`, `GET /api/docs`, `GET|PUT|DELETE /api/docs/:id` (raw `.qdraw`, headers
  `X-Title`, `X-Modified`, `X-Base-Rev`; answers `X-Rev`, `X-Modified`; stale base rev → 409 `{rev}`), `GET /api/events` (SSE
  `change`). The engine (`sync/engine.ts`) relies on `rev` being opaque and changing on every write.
- **Desktop apps carry their own page** (like Quarc Weather on Windows): `desktop/dist` is a placeholder in git, CI builds the
  frontend with `VITE_API_URL` and copies it in. No service worker in the native apps (`main.tsx` skips it on
  `tauri.localhost` / `https://localhost` / when `__TAURI__` or Capacitor exists) — a worker there once left Quarc Weather blank.
- **Quarc Store single sign-on** (Android plugin, Windows commands) is the standard kit: `frontend/src/lib/storeSso.js` and
  `desktop/src-tauri/src/quarc_sso*.rs` are copies of `Quarc_Store/sso-kit` — refresh them with the kit, don't fork them. The
  Windows page is `http://tauri.localhost`, which `window_may_use` in the kit accepts.
- **No `window.prompt/confirm`:** some webviews block them. Use `confirmThen` / `askText` / `openDialog('prompt', …)` from
  `app/bus.ts`.
- **Saving files:** everything goes through `saveBlob` / `downloadBlob` in `core/util.ts` (Android share sheet, Tauri Save dialog,
  browser download).
- One undecodable remote document must not stop the sync round (`sync/engine.ts` skips it and logs it); sign-in, network and
  server errors still end the round.

## Tests

`cd backend && npm test` (12), `cd frontend && npm run typecheck && npm test` (36) and `node tests/e2e/run.mjs [group]` after
`npm run build` (79 steps, needs Edge/Chrome; the backend is started by the suite with the development login `--dev-auth`,
password `dev`; `E2E_DEBUG=1` shows its output). The sync group is timing-sensitive: do not run it while Docker/Gradle builds
are hogging the machine. Desktop: `cd desktop/src-tauri && cargo test`.

## Release

Tag `vX.Y.Z` → Windows/macOS/Linux installers + signed APK `Quarc-Draw-Android.apk`; versionCode = MAJOR*10000+MINOR*100+PATCH.
Signing key `mobile/quarc-draw.keystore` (alias `quarc-draw`, password in `mobile/keystore-password.txt`, both git-ignored; GitHub
secrets `KEYSTORE_BASE64` / `KEYSTORE_PASSWORD`). Never regenerate it: an installed app can only be updated with the same key.
GitHub's macOS runners are sometimes unavailable (job "cancelled … not acquired by Runner"): re-run the failed job.

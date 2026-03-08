# PochaCoding

## Monorepo Layout

- `apps/web`: Vite + React web editor.
- `apps/desktop`: Electron shell (macOS-first).
- `convex`: Convex backend/actions for cloud sync.

## Common Commands

- `pnpm dev:web`: run web app.
- `pnpm dev:desktop`: run Electron + web dev server.
- `pnpm dev:all`: run Convex dev + web/desktop pipeline.
- `pnpm build`: build all workspace packages.
- `pnpm typecheck`: type-check all workspace packages.
- `pnpm lint`: lint all workspace packages.

## Convex Env

- `apps/web` now resolves env from the repo root (`envDir` points to `../../`).
- Set `VITE_CONVEX_URL` for the active environment.
- `VITE_CONVEX_SITE_URL` is optional and only needed if you want to override the default `.site` URL derived from `VITE_CONVEX_URL`.
- Clerk keys can also be mode-specific:
  - `VITE_CLERK_PUBLISHABLE_KEY_DEV` for development.
  - `VITE_CLERK_PUBLISHABLE_KEY_PROD` for production/desktop builds.
- Desktop runtime uses the DEV Clerk key by default in local dev. To force PROD key during local desktop runs, set `VITE_DESKTOP_USE_PROD_CLERK_KEY=1`.
- Convex uses a single Clerk issuer domain:
  - `CLERK_JWT_ISSUER_DOMAIN` (required)
- Desktop runtime can force Clerk redirects to HTTPS via `VITE_DESKTOP_AUTH_REDIRECT_URL` (default: `https://accounts.confusionlab.com/`) to avoid `file://` redirect scheme errors.
- Desktop runtime can also force explicit hosted auth paths:
  - `VITE_DESKTOP_AUTH_SIGN_IN_URL` (default: `https://accounts.confusionlab.com/sign-in`)
  - `VITE_DESKTOP_AUTH_SIGN_UP_URL` (default: `https://accounts.confusionlab.com/sign-up`)
- Optional fallback for Clerk: `VITE_CLERK_PUBLISHABLE_KEY`.

## Desktop Packaging

- macOS unsigned directory package: `pnpm --filter @pochacoding/desktop pack:mac`
- macOS unsigned `dmg` + `zip`: `pnpm --filter @pochacoding/desktop dist:mac`
- In development (`pnpm dev:desktop`), Electron renderer loads `http://localhost:5173` (or override via `POCHACODING_DESKTOP_WEB_URL`).
- In packaged runtime, Electron loads the hosted app URL `https://code.confusionlab.com` by default (override via `POCHACODING_DESKTOP_PROD_WEB_URL`). It falls back to bundled `web-dist` if the hosted URL fails to load.

## Convex Cloud Sync (Current Behavior)

- This is currently a **single-user app**. Convex project sync is deployment-level and not user-scoped/auth-scoped yet.
- Local project edits are saved to IndexedDB automatically.
- Cloud sync is optimized for bandwidth:
  - Sync runs when leaving/closing the editor view (component unmount flow).
  - A `sendBeacon` fallback sync runs on hard unload (refresh/tab close).
  - Cloud sync does **not** run on every edit or when a tab is merely backgrounded.

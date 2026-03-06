# PochaCoding

## Monorepo Layout

- `apps/web`: Vite + React web editor.
- `apps/desktop`: Electron shell (macOS-first).
- `packages/assistant-core`: Shared assistant contracts and semantic-op validator.
- `convex`: Convex backend/actions for cloud sync + LLM turn routing.

## Common Commands

- `pnpm dev:web`: run web app.
- `pnpm dev:desktop`: run Electron + web dev server.
- `pnpm dev:all`: run Convex dev + web/desktop pipeline.
- `pnpm build`: build all workspace packages.
- `pnpm typecheck`: type-check all workspace packages.
- `pnpm lint`: lint all workspace packages.
- `pnpm platform:plan`: preview unified platform config changes.
- `pnpm platform:apply`: apply unified platform config to local/Convex/Vercel/Clerk.

## Unified Platform Config

- Single source of truth: `platform/unified.config.json` (gitignored).
- Template: `platform/unified.config.example.json`.
- Includes:
  - local `.env.local` values
  - Convex env vars (dev/prod)
  - Vercel env vars (development/preview/production)
  - Clerk instance + redirect URLs + domains + JWT templates
  - `manualRequired` checklist for unavoidable manual/DNS steps

## Convex Env Separation (Dev vs Prod)

- `apps/web` now resolves env from the repo root (`envDir` points to `../../`).
- Use mode-specific env vars to avoid accidentally using prod backend in local dev:
  - `VITE_CONVEX_URL_DEV` / `VITE_CONVEX_SITE_URL_DEV` for development.
  - `VITE_CONVEX_URL_PROD` / `VITE_CONVEX_SITE_URL_PROD` for production builds.
- Clerk keys can also be mode-specific:
  - `VITE_CLERK_PUBLISHABLE_KEY_DEV` for development.
  - `VITE_CLERK_PUBLISHABLE_KEY_PROD` for production/desktop builds.
- Desktop runtime uses the DEV Clerk key by default in local dev. To force PROD key during local desktop runs, set `VITE_DESKTOP_USE_PROD_CLERK_KEY=1`.
- Convex can trust multiple Clerk issuer domains:
  - `CLERK_JWT_ISSUER_DOMAIN` (required)
  - `CLERK_JWT_ISSUER_DOMAIN_SECONDARY` (optional)
- Desktop runtime can force Clerk redirects to HTTPS via `VITE_DESKTOP_AUTH_REDIRECT_URL` (default: `https://accounts.confusionlab.com/`) to avoid `file://` redirect scheme errors.
- Desktop runtime can also force explicit hosted auth paths:
  - `VITE_DESKTOP_AUTH_SIGN_IN_URL` (default: `https://accounts.confusionlab.com/sign-in`)
  - `VITE_DESKTOP_AUTH_SIGN_UP_URL` (default: `https://accounts.confusionlab.com/sign-up`)
- Optional fallback: `VITE_CONVEX_URL` / `VITE_CONVEX_SITE_URL` for development-only fallback.
  - Production builds require `VITE_CONVEX_URL_PROD` (and `VITE_CONVEX_SITE_URL_PROD` when explicitly needed).
  - Optional fallback for Clerk: `VITE_CLERK_PUBLISHABLE_KEY`.

## Desktop Packaging

- macOS unsigned directory package: `pnpm --filter @pochacoding/desktop pack:mac`
- macOS unsigned `dmg` + `zip`: `pnpm --filter @pochacoding/desktop dist:mac`
- In development (`pnpm dev:desktop`), Electron renderer loads `http://localhost:5173` (or override via `POCHACODING_DESKTOP_WEB_URL`).
- In packaged runtime, Electron loads the hosted app URL `https://code.confusionlab.com` by default (override via `POCHACODING_DESKTOP_PROD_WEB_URL`). It falls back to bundled `web-dist` if the hosted URL fails to load.

## Blockly LLM Assistant (OpenAI Responses)

- The Blockly editor includes an assistant panel for natural-language block edits.
- Assistant calls are made from a Convex action (server-side), not from browser code.
- Web and desktop both use the same managed OpenAI Responses-based runner in `packages/assistant-core`.
- Configure Convex env vars:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL` or `OPENAI_MANAGED_MODEL` (optional, defaults to `gpt-5`)
  - `OPENAI_APP_NAME` or `OPENAI_MANAGED_APP_NAME` (optional title header)
- Flow:
  1. Enter an instruction in the assistant panel.
  2. Convex calls the shared assistant-core runner.
  3. Client validates the returned semantic/project edits against the current project.
  4. Valid edits are applied automatically.
  5. Use rollback to undo the latest apply transaction.

## Convex Cloud Sync (Current Behavior)

- This is currently a **single-user app**. Convex project sync is deployment-level and not user-scoped/auth-scoped yet.
- Local project edits are saved to IndexedDB automatically.
- Cloud sync is optimized for bandwidth:
  - Sync runs when leaving/closing the editor view (component unmount flow).
  - A `sendBeacon` fallback sync runs on hard unload (refresh/tab close).
  - Cloud sync does **not** run on every edit or when a tab is merely backgrounded.

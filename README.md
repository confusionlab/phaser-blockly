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

## Convex Env Separation (Dev vs Prod)

- `apps/web` now resolves env from the repo root (`envDir` points to `../../`).
- Use mode-specific env vars to avoid accidentally using prod backend in local dev:
  - `VITE_CONVEX_URL_DEV` / `VITE_CONVEX_SITE_URL_DEV` for development.
  - `VITE_CONVEX_URL_PROD` / `VITE_CONVEX_SITE_URL_PROD` for production builds.
- Clerk keys can also be mode-specific:
  - `VITE_CLERK_PUBLISHABLE_KEY_DEV` for development.
  - `VITE_CLERK_PUBLISHABLE_KEY_PROD` for production/desktop builds.
- Optional fallback: `VITE_CONVEX_URL` / `VITE_CONVEX_SITE_URL` if mode-specific values are missing.
  - Optional fallback for Clerk: `VITE_CLERK_PUBLISHABLE_KEY`.

## Desktop Packaging

- macOS unsigned directory package: `pnpm --filter @pochacoding/desktop pack:mac`
- macOS unsigned `dmg` + `zip`: `pnpm --filter @pochacoding/desktop dist:mac`

## Blockly LLM Assistant (OpenRouter)

- The Blockly editor includes an assistant panel for natural-language block edits.
- Provider calls are made from a Convex action (server-side), not from browser code.
- Configure Convex env vars:
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_MODEL` (optional, defaults to `openai/gpt-5.3-codex`)
  - `OPENROUTER_REFERER` / `OPENROUTER_APP_NAME` (optional headers)
  - `OPENAI_OAUTH_MODEL` (optional for `codex_oauth`, defaults to `gpt-5`)
  - `OPENAI_OAUTH_APP_NAME` (optional title header)
- Flow:
  1. Enter an instruction in the assistant panel.
  2. Convex action calls the selected provider and validates semantic-op JSON schema.
  3. Client builds candidate Blockly XML deterministically, diffs, and validates.
  4. Apply if validation passes (with component propagation confirmation when needed).
  5. Use rollback to undo the latest apply transaction.

## Convex Cloud Sync (Current Behavior)

- This is currently a **single-user app**. Convex project sync is deployment-level and not user-scoped/auth-scoped yet.
- Local project edits are saved to IndexedDB automatically.
- Cloud sync is optimized for bandwidth:
  - Sync runs when leaving/closing the editor view (component unmount flow).
  - A `sendBeacon` fallback sync runs on hard unload (refresh/tab close).
  - Cloud sync does **not** run on every edit or when a tab is merely backgrounded.

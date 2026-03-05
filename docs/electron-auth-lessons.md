# Electron + Auth Lessons Learned

This document captures what failed, why it failed, and the final architecture decisions for Electron + Clerk + Convex.

## Scope

- Desktop shell: Electron (`apps/desktop`)
- Frontend auth: Clerk (`@clerk/clerk-react`)
- Backend auth + data: Convex
- Deployment: Vercel web app + packaged macOS DMG

## Core Failures We Hit

1. Packaged desktop auth repeatedly failed (`401/422`, `authorization_invalid`, redirect scheme issues).
2. Convex queries threw unauthenticated errors during startup.
3. Home/project list UX showed blocking sync behavior and long wait states.
4. Env drift caused dev/prod cross-wiring (wrong Clerk/Convex target by runtime).

## Root Causes

## 1) `file://` renderer origin and Clerk web auth are a fragile pairing

- Packaged Electron originally loaded bundled `file://.../index.html`.
- Clerk browser flows are designed around stable web origins and origin/session constraints.
- This produced unstable behavior (`authorization_invalid`, prohibited redirect scheme, browser auth edge cases).

Concrete symptom signatures:

- `The provided redirect url has a prohibited URL scheme`
- `POST .../v1/client/sign_ins ... 422 Unprocessable Content`
- `authorization_invalid`

## 2) Vite env loading behavior was misunderstood in desktop production builds

- Vite reads env files at build time (not app runtime).
- With `envDir` at repo root, `.env.local` was feeding desktop web builds unless overridden by mode-specific files.
- Dev desktop auth URLs (`http://localhost:5173/...`) were getting baked into production bundles.

Concrete symptom signatures:

- Packaged app unexpectedly calling dev Clerk or dev Convex.
- Prod app behavior changing after local `.env.local` edits.

## 3) Cloud query gating was incomplete

- UI invoked cloud project list calls while auth state was unresolved.
- Server list queries threw errors on unauthenticated calls.

## 4) Home/project dialog still performed expensive or blocking sync paths

- Dialog mode performed full cloud->local sync and blocked UI.
- Page mode still had hidden full-list query paths.

Concrete symptom signatures:

- Home looked "stuck on syncing from cloud" while only project metadata was needed.

## Final Architecture Decisions

1. Packaged Electron loads hosted HTTPS app by default:
   - `https://code.confusionlab.com`
   - Override: `POCHACODING_DESKTOP_PROD_WEB_URL`
2. `file://` auth fallback behavior is treated as legacy/last resort only.
3. Desktop auth URL forcing is only applied when renderer is actually on `file://`.
4. Home/page mode does lightweight cloud metadata flow, not full project hydration.
5. Client and server both guard unauthenticated list/sync edges.

## Clerk-Specific Lessons

1. Dev Clerk instance browser auth can break due to stale local browser/session state; reset desktop app profile data when this happens.
2. Prod Clerk publishable keys require matching production domain/origin policy; they are not interchangeable with local dev origins.
3. Do not mix account portal/component path settings with app origin settings; app URLs should be configured in app env/code, while Clerk dashboard settings must match the correct instance (dev vs prod).
4. `localhost` and `127.0.0.1` are different origins; if local testing needs both, configure and test both explicitly.

## Non-Negotiable Guardrails

1. Never assume desktop packaged auth should behave like local `file://` web.
2. Always separate dev/prod env values for Clerk and Convex.
3. Gate cloud reads on auth readiness in client.
4. Make server list endpoints tolerant (`[]`) where startup UX needs resilience.
5. Avoid blocking overlays tied to long cloud sync paths on initial navigation.
6. Keep desktop dev auth config and desktop prod auth config in separate env files and CI contexts.

## Implementation Checklist (Before Shipping)

1. Verify desktop packaged entry URL:
   - packaged app should load hosted HTTPS app.
2. Verify Clerk key + domain pairing:
   - prod build uses prod publishable key
   - app domain is allowed for that Clerk instance.
3. Verify Convex target:
   - prod desktop and prod web point to prod Convex URL.
4. Verify auth-gated cloud queries:
   - no unauthenticated `projects.listFull`/`projects.list` startup crashes.
5. Build and test:
   - `pnpm --filter @pochacoding/desktop build`
   - `pnpm --filter @pochacoding/desktop dist:mac`
6. Smoke test:
   - open DMG app
   - sign in
   - home project list loads
   - open project from cloud succeeds.

## Debug Playbook (Fast Triage)

1. If auth fails in packaged app:
   - confirm current loaded URL (hosted HTTPS vs file://).
   - confirm built web bundle env values (what key/url was compiled in), not just current shell env.
2. If Clerk request fails:
   - capture exact URL + method + response body.
   - capture request headers: `Origin`, `Referer`, `Authorization`.
   - classify by status code:
     - `401` on dev instance: local dev-browser authentication/session issue.
     - `422 authorization_invalid`: origin/domain/publishable-key mismatch.
     - `400` with production key domain message: wrong host for prod key.
3. If Convex errors on startup:
   - check whether auth-gated query skip is active.
   - verify server list endpoints do not throw unauthenticated.
4. If cloud list appears stuck:
   - check for hidden full-list query use.
   - ensure page mode is metadata-only.

## Files Most Relevant To These Fixes

- `apps/desktop/src/main/index.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/hooks/useCloudSync.ts`
- `apps/web/src/components/dialogs/ProjectDialog.tsx`
- `convex/projects.ts`

## Commands We Used Repeatedly

```bash
# Type checks
pnpm --filter @pochacoding/web typecheck
pnpm --filter @pochacoding/desktop typecheck

# Build packaged desktop artifacts
pnpm --filter @pochacoding/desktop build
pnpm --filter @pochacoding/desktop dist:mac

# Fresh desktop dev run (clears stale profile/session)
pnpm run dev:desktop:fresh
```

## Practical Policy Going Forward

- Treat auth as an environment architecture concern, not a per-error patching task.
- For desktop packaged runtime, prefer stable hosted web origin behavior over local file-origin auth complexity.

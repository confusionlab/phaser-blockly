# Platform Config As Code

Use `platform/unified.config.json` as the single source of truth for:

- local `.env.local` values
- Convex deployment env vars
- Vercel project env vars
- Clerk instance/domain/redirect/JWT-template settings
- manual-only tasks that still require dashboard or DNS actions

## Files

- `platform/unified.config.example.json`: tracked template.
- `platform/unified.config.json`: your working config (gitignored).
- `scripts/platform-sync.mjs`: planner/applier script.

## Commands

```bash
pnpm platform:plan
pnpm platform:apply
```

Optional flags:

```bash
node scripts/platform-sync.mjs plan --target dev
node scripts/platform-sync.mjs apply --target prod
node scripts/platform-sync.mjs apply --services convex,vercel
node scripts/platform-sync.mjs plan --config platform/unified.config.json
```

## Important Behavior

- `plan` prints what will be changed and pending manual tasks.
- `apply` executes changes.
- Any `manualRequired` item with `blocking: true` and `done: false` will stop `apply`.
- Secrets can live in `values` and be referenced via `${VAR_NAME}` placeholders.

## Current Manual-Only Areas (Typical)

Keep these in `manualRequired` so an LLM can ask you only for unavoidable steps:

- DNS ownership and CNAME/TXT verification for Clerk/Vercel domains
- One-time provider account linking/auth setup for CLIs
- Any provider setting not exposed in public API/CLI yet

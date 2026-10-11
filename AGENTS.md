# Agent Instructions

<!-- effect-solutions:start -->

## Effect Best Practices

**Before implementing Effect features**, run `effect-solutions list` and read the relevant guide.

Topics include: services and layers, data modeling, error handling, configuration, testing, HTTP clients, CLIs, observability, and project structure.

**Effect Source Reference:** `~/.local/share/effect-solutions/effect`
Search here for real implementations when docs aren't enough.

<!-- effect-solutions:end -->

## Platform Settings and Product Docs

Vanda and Caetano know and change the platform through one registry, and explain it from one set of docs. Keep both current in the same change as the feature:

- **Settings.** Anything the owner can see or change in Perfil is declared once in `apps/vanda/src/convex/settings/catalog.ts`, with its read and write in `settings/registry.ts`. UI mutations call `writeSetting`; the agents use the generic `settings_get` / `settings_set`. Do not add per-setting agent tools.
- **What agents may change.** Payments, plan changes and connections (Instagram, OpenAI, WhatsApp) stay `access: "read"` with a `change` explanation that points the owner to the UI.
- **Docs.** Product docs are `apps/vanda/product-docs/*.md`, served at `/docs` in the app and read by the agents through `product_help` and `/docs` in the workspace. When user-visible behavior changes, update the relevant page and run `pnpm docs:build` in `apps/vanda`. The settings reference page is generated from the registry; do not write it by hand.
- **Usage.** Every real cost an owner causes is charged through `usage.chargeUsage` and shown in Perfil by category (`usageCategories.ts`). When you add a paid call, follow `docs/usage-metering.md` (it also lists what is deliberately not charged, like WhatsApp messages).
- **Guard.** `src/convex/settings/drift.test.ts` fails when Perfil calls a backend function no setting claims, or when a setting's docs page does not mention where the UI shows it.

## Data Migrations and Deploys

- A push to `main` validates the revision (lint, typecheck, tests, build) and then deploys it to production. There is no staging.
- Develop against your own Convex dev deployment (`npx convex dev`, see `docs/development.md`). Never deploy local code to another person's deployment or with a shared key.
- Data migrations live in `apps/vanda/src/convex/migrations.ts`: write an idempotent page mutation and append it to `MIGRATIONS`. Each deploy runs `migrations:runAll`, which runs every migration not yet recorded in `migrationRuns` for that deployment. Do not add per-migration CI steps.

## Version Control (Jujutsu)

All version-control operations in this repository must use Jujutsu (`jj`), not Git.

### Commit Format

```
<context>: <message>
```

Examples: `renderer: optimize text cache`, `editor: fix theme transition`

Keep messages lowercase, no periods.

### Workflow

```bash
jj status                    # check changes
jj describe -m "ctx: msg"    # set commit message
jj new                       # create new commit
jj log                       # view history
```

### Convex production access

Local commands use your personal dev deployment from `apps/vanda/.env.local` (`CONVEX_DEPLOYMENT=dev:…`); do not set `CONVEX_DEPLOY_KEY` locally.

For read-only production diagnostics, run Convex commands with:

```
    CONVEX_DEPLOY_KEY="$CONVEX_PROD_DEPLOY_KEY" pnpm exec convex logs --prod
```

Never deploy, mutate production state, or reveal secret values unless explicitly requested.

### Rules

- **Every completed TODO = one commit**
- **Never commit code that doesn't compile** - always run `cargo check` first
- **Never push to upstream**
- **Ask before rebasing**

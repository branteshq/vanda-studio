# Vanda Studio

Monorepo for Vanda Studio.

- `apps/landing`: Astro static landing site for `vandastudio.app`.
- `apps/vanda`: TanStack Start app for `app.vandastudio.app`.
- `packages/ui`: shared UI primitives.

## Development

```bash
corepack pnpm install
corepack pnpm run dev:landing
corepack pnpm run dev:vanda
```

Landing runs on [http://localhost:3001](http://localhost:3001).
The app runs on [http://localhost:3000](http://localhost:3000).

## Deployment

Use two Vercel projects from the same repository:

- Landing project root directory: `apps/landing`, domain: `vandastudio.app`.
- App project root directory: `apps/vanda`, domain: `app.vandastudio.app`.

The app project should keep the existing Clerk, Convex, Autumn, OpenRouter, and Instagram environment variables.

### Release workflow

`main` is the only long-lived branch. Feature branches are tested locally and can be
deployed to the shared integration slot with the **Deploy staging** GitHub Actions
workflow. Enter a branch, tag, or commit SHA when starting the workflow.

- `staging.vandastudio.app` runs the selected revision against the development Convex
  deployment and is reserved for test Instagram accounts.
- `app.vandastudio.app` runs `main` against the production Convex deployment.
- Every push to `main` runs the full validation suite and **Deploy production**. The
  release deploys a changed E2B sandbox template first, then Convex, creates a staged
  Vercel production deployment, and promotes it only after the build and smoke test
  succeed.

Vercel Git deployments are disabled for `apps/vanda`; the workflows own app deployment
ordering. The landing project remains independent.

Required GitHub environment secrets:

- `staging`: `CONVEX_DEV_DEPLOY_KEY`, `VERCEL_TOKEN`
- `production`: `CONVEX_PROD_DEPLOY_KEY`, `VERCEL_TOKEN`, `E2B_API_KEY`

Required GitHub environment variables in both environments:

- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `CONVEX_DEV_URL` (staging only)

## Environment

Set local app variables in the repo root `.env.local`. `apps/vanda/vite.config.ts` points Vite at the repo root env directory.

- `VITE_CONVEX_URL` or `PUBLIC_CONVEX_URL`: Convex deployment URL.
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: Clerk auth.
- `VITE_APP_ORIGIN`: Public app origin. Production uses `https://app.vandastudio.app`.

Convex-side secrets should also be configured in the Convex deployment when needed.

## Instagram (via Upload-Post)

Instagram is reached through the publisher port backed by [Upload-Post](https://www.upload-post.com):
one org API key (`UPLOADPOST_API_KEY` on the Convex deployment), one Upload-Post
"profile" per Vanda account (username = the Convex account id). Customers link their
Instagram on a white-label connect page minted per profile (`publisherConnect.startConnect`);
their OAuth tokens live inside Upload-Post and never touch our database. Publishing,
post analytics, and (later) comments/DMs all ride the same API — no Meta app, no app
review, no webhook plumbing on our side.

## Checks

```bash
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
```

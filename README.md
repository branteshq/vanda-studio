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

## Environment

Set local app variables in the repo root `.env.local`. `apps/vanda/vite.config.ts` points Vite at the repo root env directory.

- `VITE_CONVEX_URL` or `PUBLIC_CONVEX_URL`: Convex deployment URL.
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: Clerk auth.
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`: Instagram app credentials.
- `INSTAGRAM_TOKEN_ENCRYPTION_KEY`: Secret used to encrypt stored Instagram tokens.
- `VITE_APP_ORIGIN`: Public app origin. Production uses `https://app.vandastudio.app`.
- `VITE_INSTAGRAM_REDIRECT_URI`: Optional exact OAuth redirect URI to send to Meta.

Convex-side secrets should also be configured in the Convex deployment when needed.

## Instagram OAuth

Meta validates `redirect_uri` by exact match against the Instagram app's configured OAuth redirect URIs. The app defaults to:

```text
<current-origin>/api/integrations/instagram/callback
```

Production uses the app subdomain:

```text
https://app.vandastudio.app/api/integrations/instagram/callback
```

For local OAuth testing, use a stable public HTTPS URL that is listed in Meta, then set:

```bash
VITE_INSTAGRAM_REDIRECT_URI=https://your-stable-dev-url.example.com/api/integrations/instagram/callback
```

Random tunnel URLs work only until the hostname changes. Prefer a named Cloudflare tunnel or a stable preview/dev URL.

## Checks

```bash
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
```

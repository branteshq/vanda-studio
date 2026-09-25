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
  release deploys Convex, creates a staged
  Vercel production deployment, and promotes it only after the build and smoke test
  succeed.

Vercel Git deployments are disabled for `apps/vanda`; the workflows own app deployment
ordering. The landing project remains independent.

Required GitHub environment secrets:

- `staging`: `CONVEX_DEV_DEPLOY_KEY`, `VERCEL_TOKEN`
- `production`: `CONVEX_PROD_DEPLOY_KEY`, `VERCEL_TOKEN`

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

## Web research (Parallel)

`web_search` and `read_web_page` are shared by Vanda and Caetano through
`tool_search`. Parallel is the sole provider, independent of the chat model or
ChatGPT subscription. Set `PARALLEL_API_KEY` on each Convex deployment (never in
client/Vite variables). No customer key, MCP server, or additional service is needed.

Search uses `/v1/search`, advanced mode, up to three related queries and five
results, with optional domain and publication-date filters. Reading uses
`/v1/extract`: an objective selects excerpts; no objective or `fullContent: true`
requests full extracted Markdown. `fresh: true` requires content no older than
10 minutes and disables fallback to older cached content; it is not a guarantee
of an instantaneous crawl. The agent must cite source URLs and treat pages as
untrusted data, never instructions or authorization.

Inline previews are limited to 1,600 characters per source. Received evidence is
preserved in read-only, account-scoped `/web` documents, split below the document
size limit and retrievable with `read` (line `offset`/`limit`). It is not added to
automatic brand memory. Responses exceeding 500 KB fail rather than silently
truncating evidence. Requests have a 45-second deadline and no automatic retries.
Only public HTTP(S) URLs without credentials, IP literals, or custom ports are
accepted; target fetching and its DNS/redirect isolation happen at Parallel, not
inside Convex. Queries and target URLs are disclosed to Parallel.

Web admission is capped at eight attempts per turn and 100 per owner over a
rolling 24 hours across accounts. Pending requests reserve web budget atomically;
failed attempts still count toward these caps. Abandoned reservations age out of
admission after 24 hours. The shared usage meter records separate
`web_parallel_search` / `web_parallel_read` events, including for ChatGPT-connected
owners. Costs use published list-price estimates ($0.005/search, $0.001/read,
pinned in `src/convex/web.ts`), not invoice reconciliation. HTTP-success responses
are metered even if malformed or the turn was cancelled; non-2xx/network failures
are not metered, though a lost response can leave upstream billing uncertain.

Tests run locally without changing a Convex deployment. For an opt-in live
search/extraction smoke test, provide `PARALLEL_API_KEY` securely to the test process:

```bash
RUN_WEB_LIVE=1 pnpm --filter @vanda-studio/vanda exec vitest run src/convex/web.boundary.test.ts -t 'live Parallel'
```

## Checks

```bash
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
```

### User-facing errors

`apps/vanda/src/errors.ts` owns public error codes and Portuguese copy. Throw
`publicError("USAGE_LIMIT")` (or another catalog code) for an expected Convex
failure. In Effect pipelines, map tagged failures at the action boundary with
`Effect.catchTag`; keep diagnostic details in server logs, not public payloads.

UI code must use `errorMessage(error)`, `ErrorNotice`, or `showErrorToast(error)`.
Never render exception messages, stack traces, provider bodies, or persisted raw
error strings. Unknown errors get safe generic copy. Keep chat/form errors inline;
use Sonner for action notifications, without also showing the same failure inline.
Retries are user-initiated, not automatic replays of mutations.

Visit `/error-preview` on the development server to exercise the real inline and
toast states, including an unknown exception. The route returns 404 in production.
Vanda's minute-by-minute expiry sweep settles turns older than 15 minutes, including
orphaned activity records from before timeout handling existed.

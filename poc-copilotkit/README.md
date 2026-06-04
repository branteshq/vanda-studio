# Vanda CopilotKit POC

This is a throwaway Next.js sidecar POC for testing whether Vanda should become an agentic social media operator. It does not rewrite the SvelteKit app and does not change the Convex schema.

## What This Proves

- A CopilotKit chat/sidebar can sit beside a Vanda-themed social dashboard.
- Natural language prompts can dispatch read-only tools for projects, Instagram posts, account stats, and recent performance.
- The app can use existing authenticated Convex queries as the signed-in Clerk user.
- The same UI and tools fall back to explicit static demo data when live Convex access is unavailable.

## Run

```bash
cd poc-copilotkit
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

The POC automatically loads the parent repo `.env.local` so the existing Vanda `OPENROUTER_API_KEY` can be reused without copying secrets. You can also create `.env.local` in this directory to override values:

```bash
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
COPILOTKIT_MODEL=openai/gpt-4o-mini
NEXT_PUBLIC_CONVEX_URL=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
CONVEX_AUTH_TOKEN=...
DEMO_PROJECT_ID=...
NEXT_PUBLIC_DEMO_PROJECT_ID=...
```

`OPENROUTER_API_KEY` is the expected model key for this POC. The runtime uses OpenRouter through the AI SDK's OpenAI-compatible client. `OPENAI_API_KEY` can still be used as a fallback if no OpenRouter key is present.

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are required for Clerk sign-in. The POC automatically maps the root Vanda `PUBLIC_CLERK_PUBLISHABLE_KEY` to `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, so the normal root `.env.local` should be enough for local use.

`NEXT_PUBLIC_CONVEX_URL` is required for live Convex mode. The root Vanda app uses `PUBLIC_CONVEX_URL`; this POC accepts either `NEXT_PUBLIC_CONVEX_URL` or `PUBLIC_CONVEX_URL`.

`CONVEX_AUTH_TOKEN` is optional and only exists as a development fallback. The preferred live path is Clerk sign-in -> Clerk JWT template `convex` -> existing authenticated Convex queries.

`DEMO_PROJECT_ID` is optional and selects a project when live Convex returns multiple projects.

## Clerk and Convex Auth

The POC uses `@clerk/nextjs` with `ClerkProvider` and Clerk middleware. Server routes call:

```ts
getAuth(req).getToken({ template: "convex" })
```

That mirrors the production Svelte app's Convex/Clerk bridge and matches `src/convex/auth.config.ts`, where the Clerk provider uses `applicationID: "convex"`.

The signed-in user's Convex-compatible Clerk JWT is passed into:

- `GET /api/vanda` for the dashboard preview
- `POST /api/copilotkit` for request-scoped CopilotKit tools

## Live Convex Mode

The POC uses existing read-only Convex functions:

- `api.projects.listSummaries`
- `api.socialPosts.listByProject`

No Convex schema changes are required. Because those queries are auth-gated, live mode requires a signed-in Clerk user with a working `convex` JWT template. If that is unavailable, the POC deliberately switches to demo fallback mode and reports the reason.

## Demo Fallback Mode

If the user is signed out, the Convex URL is missing, Clerk token acquisition fails, live Convex returns no projects/posts, or a live query fails, the page and tools return static demo data and clearly label the response as `demo fallback`.

## Known Limitations

- Read-only only: no publishing, scheduling, comments, replies, or mutations.
- Requires the Clerk JWT template named `convex` to exist in the Clerk application.
- Uses existing synced Convex data only; it does not call Instagram Graph directly.
- The model/tool behavior is intentionally minimal and slop-friendly.
- Styling is adequate for validation, not a production design system.

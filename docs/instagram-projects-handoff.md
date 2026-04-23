# Instagram Projects Handoff

Last updated: 2026-04-23

## Product Context

Vanda Studio is a social-media-as-a-service app. The new direction is to stop treating projects as empty manual folders and make them Instagram-first brand workspaces.

The core product idea:

- A project represents one brand/workspace connected to Instagram.
- Vanda should import Instagram account/post data through the official Instagram API, not Apify scraping.
- Vanda should understand the brand from real Instagram content.
- Vanda should show account growth, follower/engagement status, scheduled posts, recommendations, and post-level analysis.
- Vanda should eventually publish approved calendar posts to Instagram and feed those post metrics back into future recommendations.

Browserbase was considered but rejected for this integration because it does not solve the reliability/permissions/compliance problem for publishing, metrics, or long-term account management. The official Instagram API is now the chosen path.

## Meta / Instagram Setup Context

The Meta app is configured around Instagram API with Instagram Login.

Important setup notes learned:

- Use the Instagram app ID/secret shown under the Instagram API setup, not necessarily the generic Facebook app credentials if using Instagram Login.
- Required env vars:
  - `INSTAGRAM_APP_ID` or fallback `META_APP_ID`
  - `INSTAGRAM_APP_SECRET` or fallback `META_APP_SECRET`
  - `INSTAGRAM_TOKEN_ENCRYPTION_KEY`
- Production Convex env vars should match the same Instagram app credentials used by the deployed redirect URL.
- Local testing requires a public HTTPS tunnel, such as Cloudflare Tunnel, because Instagram redirect URIs must be HTTPS and exact.
- Vite needs the Cloudflare quick tunnel host in `server.allowedHosts`.
- The redirect URI must exactly match what is configured in Meta:
  - Production example: `https://vandastudio.app/api/integrations/instagram/callback`
  - Tunnel example: `https://<random>.trycloudflare.com/api/integrations/instagram/callback`
- `localhost` redirect did not work for Instagram OAuth in this setup.

## Completed Backend Work

### Instagram OAuth

Files:

- `src/convex/instagramGraphActions.ts`
- `src/convex/instagramGraph.ts`
- `src/routes/(app)/integrations/instagram/connect/+page.svelte`
- `src/routes/(app)/api/integrations/instagram/callback/+page.svelte`

Capabilities:

- Builds Instagram OAuth URL.
- Supports project-scoped OAuth via `projectId` encoded in state.
- Completes OAuth and stores encrypted long-lived token.
- Uses Instagram scopes:
  - `instagram_business_basic`
  - `instagram_business_content_publish`
- Stores social connection with provider `instagram_graph`.
- Callback waits for Clerk auth/session before completing.
- Errors from Meta are surfaced more clearly.

### Project-Attached Connections

The Instagram connection can be attached to a project. Existing project cards and settings can connect/reconnect Instagram through:

```text
/integrations/instagram/connect?projectId=<projectId>
```

### Replaced Apify Sync With Official Instagram Import

Files:

- `src/convex/instagramGraphActions.ts`
- `src/convex/socialPosts.ts`
- `src/convex/schema.ts`
- `src/lib/components/projects/ProjectSettingsForm.svelte`

Capabilities:

- `instagramGraphActions.importProjectPosts` imports:
  - profile/account fields
  - recent media
  - captions
  - media URLs
  - permalink
  - timestamps
  - like/comment counts when available
  - children for carousel where available
- Imported content is stored in `social_posts`.
- Account metrics are snapshotted in `account_metric_snapshots`.
- Post metrics are snapshotted in `post_metric_snapshots`.
- The legacy `instagram_posts` digest path is still mirrored for compatibility.
- Project profile image can be downloaded/stored.

Important tables added:

- `social_posts`
- `account_metric_snapshots`
- `post_metric_snapshots`

### Project Summary Query

File:

- `src/convex/projects.ts`

Query:

```ts
api.projects.listSummaries
```

Now returns per project:

- `postCount`
- `mediaCount`
- `socialPostCount`
- `scheduledCount`
- `publishedCount`
- `metrics.followersCount`
- `metrics.followersDelta`
- `metrics.postsCount`
- `metrics.avgEngagement`
- `latestSocialPosts`
- `brandIntelligence`
- `instagramConnection`

Used by the Projects index command center.

### Brand Intelligence Generation

File:

- `src/convex/ai/socialIntelligence.ts`

Action:

```ts
api.ai.socialIntelligence.regenerateBrandIntelligence
```

Input:

- `projectId`
- optional `limit`

Output stored on the project:

- `summary`
- `contentPillars`
- `audienceSignals`
- `visualDirection`
- `recommendationNotes`
- `sourcePostCount`
- `generatedAt`

Important caveat:

- If there are zero imported `social_posts`, this action throws:
  - `Sincronize posts do Instagram antes de gerar inteligência de marca.`
- The setup UI now handles zero imported posts by skipping this action.

### Post Intelligence

File:

- `src/convex/ai/socialIntelligence.ts`
- `src/convex/socialPosts.ts`

Action:

```ts
api.ai.socialIntelligence.analyzePost
```

Writes `social_posts.intelligence`:

- `topic`
- `hook`
- `format`
- `visualSignals`
- `performanceNotes`
- `recommendationWeight`
- `analyzedAt`

Frontend for this is not built yet.

### Publishing Pipeline

Files:

- `src/convex/instagramGraphActions.ts`
- `src/convex/scheduledPosts.ts`
- `src/convex/crons.ts`
- `src/convex/socialPosts.ts`

Capabilities:

- Cron every 5 minutes checks for due Instagram scheduled posts.
- Marks due posts as `publishing`.
- Creates Instagram media container with image URL and caption.
- Publishes container.
- Marks generated post/calendar event as published.
- Creates a published row in `social_posts`.
- Failed publishing becomes `publish_failed`.

Important caveats:

- Currently assumes image publishing. Video/carousel publishing needs more work.
- The generated Instagram permalink currently uses a simple fallback from media ID and may need a post-publish Graph fetch for the canonical permalink.
- The frontend calendar publishing UX is not yet done.

### Recommendations Feedback

File:

- `src/convex/ai/postIdeas.ts`

Post idea generation now reads:

```ts
internal.socialPosts.listRecommendationContextInternal
```

It includes imported/published social posts, metrics, and post intelligence in the idea-generation prompt.

## Completed Frontend Work

### Projects Index Command Center

File:

- `src/routes/(app)/projects/+page.svelte`

The Projects index was rebuilt to match the dark command-center concept.

Current features:

- Smaller compact `Projetos` header.
- Search.
- Filters:
  - all
  - connected
  - attention
- Summary stat cards:
  - total projects
  - connected count
  - reconnect/attention count
- Project cards show:
  - avatar/logo
  - name
  - Instagram handle or disconnected state
  - connected/disconnected/error status
  - last sync text
  - follower growth
  - average engagement
  - scheduled/draft count
  - recommendation count
  - next action hint
- Actions:
  - open project
  - sync project
  - sync all
  - connect/reconnect Instagram
  - create post shortcut
  - delete modal
- Uses `api.projects.listSummaries`.

Known rough spots:

- Sparklines are generated deterministically in the frontend, not real time-series data yet.
- “Next post” label is mostly a placeholder because the query does not yet return actual next scheduled post details.
- Recommendation count uses `brandIntelligence.recommendationNotes.length`.

### New Project Flow

File:

- `src/routes/(app)/projects/new/+page.svelte`

The `Novo projeto` flow was refactored.

Step 1 now asks:

- `Já tenho uma marca`
- `Quero criar do zero`

New behavior:

- `Já tenho uma marca` creates a draft project named `Projeto do Instagram`.
- It immediately redirects to Instagram OAuth with `projectId`.
- Manual setup still exists under `Quero criar do zero`.

Important implementation decision:

- Instead of “OAuth first then create project,” the MVP creates a temporary draft project before OAuth. This avoids more complex state handling and reuses the existing project-attached OAuth path.

### Instagram Callback

File:

- `src/routes/(app)/api/integrations/instagram/callback/+page.svelte`

Change:

- If OAuth completes with a project, the CTA now goes to:

```text
/projects/:projectId/setup
```

instead of directly returning to the project.

### Instagram Project Setup Screen

File:

- `src/routes/(app)/projects/[projectId]/setup/+page.svelte`

This page runs the post-OAuth setup:

1. Import posts and metrics with `api.instagramGraphActions.importProjectPosts`.
2. If at least one post is imported, generate brand intelligence with `api.ai.socialIntelligence.regenerateBrandIntelligence`.
3. If zero posts are imported, skip brand intelligence and complete setup.
4. Rename the draft project from `Projeto do Instagram` to the Instagram handle when possible.
5. Mark onboarding as complete.

The UI was revised after feedback:

- Removed the green success treatment.
- Replaced the grid/checklist feel with a pink/neutral timeline.
- Shows import count.
- Shows skipped brand intelligence state when no posts were imported.
- Allows retry or opening project.

Known behavior:

- If an account has zero importable posts, setup completes with a message that strategy will be generated when content exists.
- This avoids the previous failure:
  - `Sincronize posts do Instagram antes de gerar inteligência de marca.`

## Current User Feedback / Design Direction

The user wants the UI to closely follow the supplied dark/pink concept designs:

- Dark workspace.
- Pink as primary action/accent.
- Restrained neutral cards and borders.
- Serif headings are okay, but page headers should not be comically large.
- Avoid green-heavy success states.
- Avoid overly boxed “grid checklist” setup UI.
- Dense command-center UI is preferred over marketing-style pages.
- Projects should feel like live brand workspaces, not static folders.

## Important Existing Warnings

`npm run check` passes with zero errors but still reports unrelated existing warnings:

- `src/lib/components/CommandPalette.svelte`
  - `inputEl` is updated but not declared with `$state(...)`.
- `src/routes/(app)/calendar/+page.svelte`
  - two icon-only close buttons missing aria labels.

These were not introduced by this work.

## Recent Commits

Using Jujutsu (`jj`), not git.

Recent commits:

- `instagram: use instagram login oauth scopes`
- `instagram: support instagram oauth credentials`
- `dev: allow cloudflare tunnel host`
- `instagram: wait for auth on callback`
- `instagram: surface meta api errors`
- `instagram: attach connection to project`
- `instagram: import social posts and metrics`
- `instagram: add project intelligence and publishing`
- `projects: build instagram command center`
- `projects: refactor new project onboarding`
- `projects: polish instagram setup`

Current working copy was clean after the last commit.

## Next Recommended Work

### 1. Improve Projects Index Data Fidelity

Backend should expose real next scheduled post info in `api.projects.listSummaries`.

Suggested fields:

- `nextScheduledPost`
  - `postId`
  - `caption/title preview`
  - `scheduledFor`
  - `platform`
  - `status`

Then replace placeholder text in project cards.

### 2. Project Detail Shell

Build the persistent project header and tabs:

- `Visão geral`
- `Instagram` or `Posts`
- `Estratégia`
- `Calendário`
- `Configurações`

This is the foundation for the remaining concept screens.

### 3. Strategy Tab

Use `project.brandIntelligence` to render:

- summary
- content pillars
- audience signals
- visual direction
- recommendation notes
- source post count
- generated at
- “Regenerar do Instagram” button

Add a good empty state if no imported posts exist.

### 4. Posts / Instagram Tab

Use `api.socialPosts.listByProject`.

Build:

- grid/table of imported posts
- metrics display
- right-side selected post panel
- “Analisar post” action using `api.ai.socialIntelligence.analyzePost`

### 5. Calendar Publishing UX

Build frontend around publishing states:

- `scheduled`
- `publishing`
- `posted`
- `publish_failed`

Actions:

- publish now
- retry failed publish
- reschedule
- show error details

### 6. Better Setup State

The setup page is currently frontend-driven. Eventually add durable backend setup status fields so refreshes and partial failures are more explicit.

Potential fields on project:

- `setupStatus`
- `setupStep`
- `setupLastError`
- `setupCompletedAt`

### 7. Metric Snapshots Over Time

The project cards currently use current vs previous account snapshot for follower delta, and average post snapshot engagement. For proper charts, add summary queries returning a compact time series:

- followers over time
- engagement over time
- post cadence
- top posts

## Useful Commands

```bash
npm run check
npx convex codegen
jj status
jj diff --stat
jj describe -m "context: message"
jj new
```

Remember:

- This repo uses `jj`, not git.
- Never push upstream.
- Completed TODOs should be committed.
- Commit messages are lowercase in format `<context>: <message>`.

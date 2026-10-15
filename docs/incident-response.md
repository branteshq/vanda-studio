# Incident response and rollback

Production is the only environment: `https://app.vandastudio.app`. There is no staging, so every fix and every rollback is tested against real users. Read this page before you touch production.

## What ships, in what order

Every push to `main` runs `.github/workflows/deploy-production.yml`, in the `vanda-production` concurrency group (queued, never cancelled in progress):

| Step | What it changes                                          | If it fails here                                                                                   |
| ---- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | CI: lint, typecheck, test, build                         | Nothing is deployed. Production is still the previous revision.                                    |
| 2    | `convex deploy --prod`: functions, indexes, schema       | Nothing is live yet, unless the push itself partly succeeded. Check the Convex deploy log.        |
| 3    | `migrations:runAll`: data migrations, once per deployment | **New backend, old frontend.** Vercel has not moved.                                              |
| 4    | `vercel build --prod` and `vercel deploy --prebuilt`     | **New backend, old frontend.** A failed build on the macOS runner leaves the new backend live.     |

Two consequences:

- **Vercel rollback does not touch Convex.** Functions, schema and `migrationRuns` stay as deployed. Rolling the frontend back to a version that calls a function the new backend removed or renamed breaks the app.
- **Migrations are forward-only.** `runAll` records each migration in `migrationRuns` for that deployment and skips it on every later deploy. Nothing reverses a migration. Reverting the commit does not undo the data it wrote.

The rule that keeps rollback safe: **a backend change must work with the previous frontend, and the previous backend code must accept data the new code wrote.** Add fields as optional first, migrate, then make them required in a later release.

Vercel git deploys are disabled (`apps/vanda/vercel.json`), so the only production deploys are the CI job and manual Vercel actions below. Vercel function region is `iad1`.

## Severity

| Level | Meaning                                                                                  | Response                                                    |
| ----- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| SEV1  | App down, sign-in broken for everyone, or data loss or corruption suspected              | Start now. Roll back first, investigate second. Tell the owner immediately. |
| SEV2  | A core flow broken for many owners (chat, publishing, WhatsApp replies, billing)         | Mitigate within the hour. Roll back if the cause is a recent deploy. |
| SEV3  | One feature degraded, a workaround exists, or only a few owners affected                 | Fix in the normal flow. Post an update if owners are asking. |

## First 15 minutes

1. **Declare it.** Say in the incident channel what is broken, who is looking at it, and the severity. Owner: `TODO(owner-name)`.
2. **Check whether a deploy caused it.** The last deploy is the first suspect.

   ```sh
   gh run list --branch main --limit 5
   vercel ls vanda-studio --scope notdaviarantes-projects --environment production --limit 5
   ```

3. **Check the providers' status pages** (below). If a provider is down, skip to the outage runbook.
4. **Read the errors.** Frontend first, then backend. Commands are in "Where the logs live".
5. **Decide the path** with the decision tree. Write the decision and the time in the incident channel.
6. **Freeze deploys if you are mitigating.** Do not push to `main` during an incident unless the push is the fix. Queued CI runs still deploy in order, so cancel a queued run you do not want with `gh run cancel <run-id>` (read `gh run cancel --help` first).

## Decision tree

```
Is the outage tied to a recent deploy (check gh run list / vercel ls)?
├── No  → Is a provider down (status pages below)?
│        ├── Yes → External provider outage: wait, communicate, degrade.
│        └── No  → Investigate logs. Treat as SEV2 until you know more.
└── Yes → What did the deploy change?
         ├── Only frontend (apps/vanda/src/routes, components, client code)
         │      → Frontend-only bug: Vercel instant rollback.
         ├── Backend, schema or migrations (src/convex/**)
         │      → Backend or migration bug: revert the commit and push.
         └── Both, or unclear
                → Roll back the frontend first (fast, safe to undo),
                  then decide on the backend. A frontend rollback against a
                  new backend is only safe if the backend change was additive.
```

If a migration has already run and wrote bad data, neither rollback fixes the data. Go to "Data damage" below.

## Runbook A: frontend-only bug, Vercel rollback

Use when the new Vercel deployment is the problem and the backend change (if any) is additive.

1. Find the last good production deployment. It is the most recent `READY` deployment before the bad one.

   ```sh
   vercel ls vanda-studio --scope notdaviarantes-projects --environment production --status READY --limit 10
   ```

   Copy its URL (`https://vanda-studio-<hash>-notdaviarantes-projects.vercel.app` or similar). Confirm the commit it was built from in the dashboard before you use it.

2. Read the rollback syntax for your CLI version. These are read-only:

   ```sh
   vercel rollback --help
   vercel promote --help
   ```

3. Roll back. Either:

   ```sh
   vercel rollback <deployment-url> --scope notdaviarantes-projects
   ```

   or, in the dashboard, open the project → Deployments → the good deployment → **Instant Rollback**.

4. Check the rollback finished:

   ```sh
   vercel rollback status vanda-studio --scope notdaviarantes-projects
   ```

5. Run the checks in "Verification after rollback".

**The rollback is temporary.** The next push to `main` deploys again and puts the bad code back. Either fix forward and push, or revert the commit (Runbook B) before the next push. To undo a rollback once the fix is live, re-promote the newer deployment with `vercel promote <deployment-url>` (read `vercel promote --help` first).

## Runbook B: backend or migration bug, revert and push

Use when the bad commit changed `apps/vanda/src/convex/**` (functions, schema, migrations). This redeploys Convex and Vercel together from the reverted `main`.

1. Find the bad commit and confirm it is the one that broke things:

   ```sh
   jj log -r 'main::@' --limit 10
   ```

2. Check that the revert will deploy. Read `jj help revert` for the flags in your jj version, and review the diff before pushing. Keep the revert in a new change on top of `main`:

   ```sh
   jj git fetch
   jj new main
   jj revert -r <bad-commit>        # verify flags with: jj help revert
   jj describe -m "revert: <context> <what it undid>"
   jj bookmark set main -r @-       # the revert commit sits under the new empty @
   jj git push --bookmark main
   ```

   Commit messages follow `<context>: <message>`, lowercase, no period (AGENTS.md).

3. Watch the run. It goes through CI, Convex deploy, migrations, then Vercel:

   ```sh
   gh run watch --exit-status       # pick the run from: gh run list --branch main
   ```

4. Confirm the revert actually reached production. Convex first (see "Where the logs live"), then the app.

**When the revert will not deploy.** The older schema may reject documents the new code wrote, for example a required field that was added and populated. Convex refuses the deploy in that case. Do not force it. Fix forward with a small change that keeps the data valid, and push it.

**When the revert is not enough.** If the bad code ran a migration, the revert leaves that data in place. Decide with the owner whether the data needs a repair. Repairs are a new migration in `apps/vanda/src/convex/migrations.ts`: idempotent, paged, appended to `MIGRATIONS`. Never hand-edit production rows with ad-hoc mutations.

## Runbook C: external provider outage

Use when the status pages show an incident and the errors point at a provider. Rolling back does not help, because the code is fine.

Providers the code calls, by area (names from `apps/vanda/src/convex` and `package.json`):

| Area                                 | Provider                       | Status page                           |
| ------------------------------------ | ------------------------------ | ------------------------------------- |
| Sign-in                              | Clerk                          | https://status.clerk.com              |
| Chat, images, analysis, transcription fallback | OpenRouter           | https://status.openrouter.ai          |
| ChatGPT plan (Vanda and Caetano turns, images) | OpenAI                | https://status.openai.com             |
| Web research                         | Parallel                       | TODO(status-url)                      |
| Instagram research and market radar  | Apify                          | TODO(status-url)                      |
| Instagram publishing                 | Upload-Post                    | TODO(status-url)                      |
| WhatsApp (Caetano)                   | Kapso, and Meta's WhatsApp platform | Kapso: TODO(status-url); Meta: https://metastatus.com |
| Billing                              | Autumn                         | TODO(status-url)                      |
| Hosting                              | Vercel                         | https://www.vercel-status.com         |
| Database and functions               | Convex                         | https://status.convex.dev             |

Steps:

1. Confirm the provider is the cause. Look for its name or hostname in `convex logs --prod` errors. Do not assume.
2. Do not roll back. Do not push a change that "works around" the outage unless the workaround is already planned.
3. Tell owners what is affected and that you are waiting (see "Communication"). Keep the message to what they will see.
4. Replies to WhatsApp owners outside the 24-hour window wait in the outbox until the owner writes again (`docs/caetano-whatsapp.md`). Check for a backlog after recovery.
5. When the provider recovers, watch for a backlog and retries, and check that stuck items were not lost.

## Verification after rollback

Run all of these before you call the incident mitigated.

```sh
# The app answers
curl -sI https://app.vandastudio.app | head -n 1       # expect HTTP 200 or a redirect to the app

# No new errors on the serving deployment (replace the URL)
vercel logs --deployment <deployment-url> --environment production --query "level:error" --since 30m

# Backend errors on production
CONVEX_DEPLOY_KEY="$CONVEX_PROD_DEPLOY_KEY" pnpm exec convex logs --prod --history 200

# Migrations recorded as expected
CONVEX_DEPLOY_KEY="$CONVEX_PROD_DEPLOY_KEY" pnpm exec convex data migrationRuns --prod   # confirm flags: pnpm exec convex data --help
```

Then, by hand, in a real owner account: sign in, open the dashboard, send one chat message, and open the Perfil page. For WhatsApp, send one message from a linked phone and confirm a reply.

Record the deployment URL, the time, and who verified it.

## Where the logs live

There is no log drain and no tracing yet. The CLIs below only show what each platform still holds, and the retention limits are not written down in this repository. Copy the lines you need into the incident notes while they are fresh.

- **Vercel runtime logs** (functions, middleware): `vercel logs --environment production --query "level:error" --since 1h` (team-owned projects only). Filter by `--deployment <url>` to see one version. Retention depends on the Vercel plan; check the dashboard.
- **Vercel CDN requests:** the `requests` data source of `vercel logs` (see `vercel logs --help`).
- **Convex function logs:** `CONVEX_DEPLOY_KEY="$CONVEX_PROD_DEPLOY_KEY" pnpm exec convex logs --prod`. The CLI streams live output and replays only recent history (`--history [n]`). Start it before you reproduce the problem.
- **Convex data:** the dashboard shows tables and `_storage`. Read-only CLI access is `convex data <table>`.
- **CI and deploys:** `gh run list --branch main`, then `gh run view <run-id> --log-failed`.

Never paste keys or key values into logs, notes or chat. `CONVEX_PROD_DEPLOY_KEY` is read from the environment, never printed.

## Data damage

If a bad migration or function wrote wrong data, stop further deploys to `main` until you know the scope.

1. Write down what was wrong, which table, and the time range. Do not guess.
2. Take a Convex export before any repair, stored outside the repository (`pnpm exec convex export --help` for the path and flags). Export files contain owner data: never commit them, never share them in chat.
3. Repair with a new idempotent migration, reviewed and tested against the dev deployment first.
4. Tell affected owners, if any, with `TODO(owner-comms-policy)`.

Restoring from an export is a manual, owner-approved operation. Do not do it without the owner's decision.

## Communication and escalation

These names and channels are placeholders. Fill them in before the first incident.

| Role                                   | Who                             | How to reach them                 |
| -------------------------------------- | ------------------------------- | --------------------------------- |
| Incident owner (runs the response)     | `TODO(owner-name)`              | `TODO(contact-channel)`           |
| Decision maker (rollback, data, comms) | `TODO(decision-maker-name)`     | `TODO(contact-channel)`           |
| Vercel and Convex account access       | `TODO(account-owner-name)`      | `TODO(contact-channel)`           |
| Provider support (Clerk, Kapso, Meta)  | `TODO(support-owner-name)`      | `TODO(support-contact)`           |

- **Incident channel:** `TODO(incident-channel)`. Post the start, each decision, and the all-clear.
- **Update cadence while open:** `TODO(update-cadence)` for SEV1, `TODO(update-cadence)` for SEV2.
- **Owner messages:** `TODO(owner-comms-template-location)`. Say what is affected, what they can do meanwhile, and when the next update comes. Do not promise a time you cannot keep.
- **Escalate** to the decision maker for any SEV1, any data repair, or any provider outage longer than `TODO(escalation-threshold)`.

## Post-incident notes

Write these within `TODO(postmortem-deadline)` of the all-clear, in `docs/` as `incident-YYYY-MM-DD-short-name.md`. Keep them blameless and short.

```md
# Incident YYYY-MM-DD: <short name>

- Severity:
- Duration: <first symptom> to <verified recovery>
- Owner(s):
- Owners affected:

## Impact
What broke, for whom, and what they could not do.

## Timeline (BRT, from the incident channel)
- HH:MM detected by ...
- HH:MM decision: ...
- HH:MM deployment URL / commit: ...
- HH:MM verified by ...

## Cause
The mechanism, not the blame. Which step of the pipeline (see "What ships, in what order") let it through.

## Detection
How we found out, and how long it took.

## Recovery
What we did (rollback, revert, fix forward, repair) and why that path.

## What went well / what did not

## Follow-ups
- [ ] Action, owner, due date
```

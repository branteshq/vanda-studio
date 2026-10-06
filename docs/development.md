# Development setup

Each developer works against their own Convex dev deployment. Nobody deploys local code to another person's deployment, and only CI deploys production (push to `main` → validate → production). There is no staging.

## First time

1. **Convex access.** Accept the invite to the `daviarantes13` team in Convex. Without team membership you cannot get a dev deployment in the `vanda-studio` project.
2. **No shared keys locally.** Remove any `CONVEX_DEPLOY_KEY` from your shell profile, `.env`, `.env.local` and direnv files. Locally, `CONVEX_DEPLOY_KEY` overrides your own deployment and sends your code somewhere else.
3. **Create your dev deployment.** Run this in `apps/vanda`:

   ```sh
   npx convex dev --configure existing --team daviarantes13 --project vanda-studio
   ```

   Convex creates your personal dev deployment and writes `CONVEX_DEPLOYMENT=dev:<name>` and `VITE_CONVEX_URL` into `apps/vanda/.env.local`. From then on, `pnpm dev` (in `apps/vanda`) pushes to your deployment only.

4. **Environment variables.** New dev deployments copy the project's default environment variables (Convex dashboard → Project settings → Environment variables). If one is missing, set it on your own deployment with `npx convex env set NAME value`. Ask for values; never copy them from production.

   | Needed for                     | Variables                                                                                                                                                      |
   | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Sign-in (Clerk dev instance)   | `CLERK_JWT_ISSUER_DOMAIN`                                                                                                                                      |
   | Chat, images, analysis         | `OPENROUTER_API_KEY`, `OPENAI_TOKEN_ENCRYPTION_KEY`                                                                                                            |
   | App links                      | `PUBLIC_APP_URL` (`http://localhost:3000`)                                                                                                                     |
   | Billing                        | `AUTUMN_SECRET_KEY` (test key)                                                                                                                                 |
   | Instagram publishing           | `UPLOADPOST_API_KEY`                                                                                                                                           |
   | Market radar                   | `APIFY_API_TOKEN`                                                                                                                                              |
   | Web research                   | `PARALLEL_API_KEY`                                                                                                                                             |
   | WhatsApp (optional, see below) | `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WHATSAPP_NUMBER`, `KAPSO_WEBHOOK_SECRET`, `KAPSO_APP_URL`, `KAPSO_UPDATE_TEMPLATE`, `KAPSO_TEMPLATE_LANGUAGE` |

5. **Data.** A new deployment starts empty: sign in and onboard a test business. To start from someone's dev data, they run `npx convex export --path dev.zip` on their deployment and you run `npx convex import --replace-all dev.zip` on yours.

## WhatsApp

The Kapso sandbox webhook points at one deployment at a time. When you work on Caetano, point it at yours from `apps/vanda`: set `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` and `KAPSO_WEBHOOK_URL=https://<your-deployment>.convex.site/webhooks/kapso`, run `node scripts/setup-kapso-sandbox.mjs` (a dry run), then run it again with `KAPSO_SANDBOX_CONFIRMED=true` and `--apply`. Say so in the team chat, since it takes the sandbox away from whoever had it.

## Schema changes

Your deployment only accepts a schema its data matches, and production checks the same thing on deploy. A field or table that exists only in your branch stays on your deployment until it is merged. If you rename or remove something with existing data, add a migration to `apps/vanda/src/convex/migrations.ts` (see `AGENTS.md`).

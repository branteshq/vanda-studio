# Caetano on WhatsApp

Kapso transports messages. Caetano is the existing Convex Agent, with one canonical thread per Vanda user, and WhatsApp is its only client: the web app no longer has a Caetano page. Vanda keeps the web chat (`/conversa`); both agents share the same tools. No Kapso agent or workflow is required.

## Scope

Implemented: text, photos and voice notes in; text, images and posts out; secure account linking, BSUID/phone recipients, signed v2 webhooks, buffered bursts, durable ingestion, per-message deduplication, canonical chat queue, direct execution through the shared Vanda/Caetano tools, `parar`, read/typing receipt, outbound chunking, delivery status, bounded rate-limit retries, user-confirmed resends, publication notices, and 24-hour window handling with an optional update template.

- **Inbound media.** Photos (up to 4 per turn, 10 MB each) are downloaded through Kapso's media endpoint, stored as uploaded images of the active business and attached to the turn. Voice notes use Kapso's transcript when the project has automatic audio transcription enabled; otherwise `whatsappMedia.prepareTurn` downloads the audio and transcribes it with `google/gemini-2.5-flash` through OpenRouter. A photo, caption and voice note sent together become one turn. Video, documents and stickers get a short "send text, photo or audio" notice.
- **Outbound media.** After the reply text, each post the turn presented goes out as its images followed by `Legenda:` and the caption, then loose images, capped at 10 images per turn (the rest are pointed to the gallery). JPEG/PNG up to 5 MB go as WhatsApp images; other formats as documents.
- **Publication notices.** When a scheduled post publishes or fails, the owner's linked WhatsApp gets a short notice with the permalink or error, and the receipt is saved in Caetano's thread so a reply has context. This covers posts created anywhere, not only through Caetano.
- **Service window.** Replies outside the 24-hour window wait in the outbox until the owner writes again. Publication notices use the approved update template instead, when `KAPSO_UPDATE_TEMPLATE` is set; without it they wait like replies.
- **Messages sent in pieces.** Messages that arrive within Kapso's buffer window become one turn. Messages that arrive while a turn is running are folded into it: after each generation pass, `claimFollowups` marks them `merged` and Caetano runs another pass that sees them, then delivers one answer covering everything (at most 3 extra passes). Only messages after the reply start a new turn. The read receipt targets the newest message of a burst.
- **Scope.** WhatsApp turns carry `WHATSAPP_CHANNEL_PROMPT` (`caetanoAgent.ts`), which keeps Caetano to marketing for the owner's businesses and Vanda Studio help, and declines unrelated requests. This is the product's answer to clause 4.7 of Meta's WhatsApp Business terms (AI providers); confirm the classification with Kapso before a broad launch.

Caetano's normal allowance applies to turns; linking, stopping, notices and delivery do not invoke a model. Fallback transcription is a small OpenRouter call that is not attributed to the user's allowance. No credentials or downloaded media are passed to Python.

## Setup

1. Create a Kapso project and an API key under Integrations → API keys.
2. WhatsApp → Sandbox → Add Test Number. Enter the personal number used for testing.
3. From that phone, send Kapso's six-character activation code to the displayed sandbox number. The code expires after 15 minutes. This step proves control of the test phone and cannot be done by this repository.
4. Find Sandbox WhatsApp under WhatsApp → Configurations. Record its phone number ID and the digits-only sandbox destination number. These are different values.
5. Set these secrets on the **development** Convex deployment, using the dashboard or a secure environment workflow. Do not commit them:
   - `KAPSO_API_KEY`: project API key
   - `KAPSO_PHONE_NUMBER_ID`: Sandbox WhatsApp configuration's number ID
   - `KAPSO_WHATSAPP_NUMBER`: digits-only number used by `wa.me`
   - `KAPSO_WEBHOOK_SECRET`: random 32-byte hex secret, the same one registered with Kapso
   - Optional `KAPSO_APP_URL`: public frontend URL for this same environment, used for gallery links. Do not point development messages at the production frontend.
   - Optional `KAPSO_UPDATE_TEMPLATE` and `KAPSO_TEMPLATE_LANGUAGE` (default `pt_BR`): the approved update template for notices outside the service window. See below.

6. Deploy development functions with `pnpm exec convex dev --once` from `apps/vanda`.
7. Register a **number-scoped Kapso v2 webhook**, not a project webhook or raw Meta webhook. Destination: `https://<development-deployment>.convex.site/webhooks/kapso`. Use the `.site` URL, not `.cloud`.
8. Subscribe to received, sent, delivered, read and failed message events. Enable received-message buffering with a 5-second window and maximum 20 messages. Disable any other agent/flow replying to this number.
9. In the Kapso project settings, turn on automatic audio transcription. Without it, voice notes still work through the OpenRouter fallback, at a small extra cost and latency.

Optional registration script, with the four secret/config variables exported locally:

```sh
# Additional local setup variables, not Convex variables:
export KAPSO_WEBHOOK_URL=https://YOUR-DEV-DEPLOYMENT.convex.site/webhooks/kapso
export KAPSO_SANDBOX_CONFIRMED=true
node apps/vanda/scripts/setup-kapso-sandbox.mjs          # dry run
node apps/vanda/scripts/setup-kapso-sandbox.mjs --apply # run once
```

The script creates a webhook; it does not provision a number, activate a phone or purchase a plan. Manage subsequent changes in Kapso rather than creating duplicate webhooks.

### Update template

Notices outside the 24-hour window need a Meta-approved template. The sandbox does not support templates. On a production number, submit Caetano's UTILITY template (body: "Caetano aqui, com uma atualização do Vanda Studio: {{1}} …") with the business account ID from Kapso:

```sh
export KAPSO_API_KEY=...
export KAPSO_WABA_ID=...   # WhatsApp Business Account ID of the production number
node apps/vanda/scripts/setup-kapso-template.mjs          # dry run, prints the template
node apps/vanda/scripts/setup-kapso-template.mjs --apply  # submits it for review
```

After Meta approves it, set `KAPSO_UPDATE_TEMPLATE=caetano_atualizacao` on the Convex deployment. Template messages are billed by Meta per message.

## Production configuration

Production was configured on September 14, 2026:

- Number: `+1 204-900-5501`, phone number ID `1380777355112341`.
- Frontend: `https://app.vandastudio.app`, also configured as `KAPSO_APP_URL`.
- Backend: `accomplished-kookabura-20`.
- Number-scoped webhook: `5dc360a1-f409-49b5-ba25-d79889e11c92`.
- Endpoint: `https://accomplished-kookabura-20.convex.site/webhooks/kapso`.
- Active v2 payloads, received/sent/delivered/read/failed events, inbound buffering (configured at 3 seconds; the recommended window is now 5).
- Production has its own signing secret. The development sandbox webhook remains unchanged.

Backend and frontend were deployed directly with owner authorization, without pushing upstream. The frontend was staged and returned HTTP 200 before promotion. Unsigned ingress returned 401 and a signed empty batch returned 200. A real production round trip followed: the owner's phone was linked through the production Perfil on September 14, and 7 text replies between September 15 and 24 all reached `read`.

Production onboarding does not require sandbox activation. Link the production account separately, even if the same phone was linked in development. Media and the update template described above are not yet deployed or exercised in production. Rotate the previously chat-exposed Kapso API key before a broader launch, and confirm Meta AI-provider eligibility and pricing with Kapso.

## Link the Vanda account

In the authenticated web app, open Perfil → Conta → Caetano no WhatsApp (the sidebar's Caetano entry leads there until the phone is linked, and opens the WhatsApp chat afterwards). Generate a link, open it and send the prefilled `vanda conectar …` message. This is a separate code from Kapso's activation code. Sending it also opens the messaging window. In live testing, Kapso rejected a send immediately after sandbox activation with HTTP 422, saying the 24-hour window was closed. The adapter holds those replies until a fresh incoming message.

The application stores only a SHA-256 token hash, valid for 10 minutes and consumed once. Tokens never enter the agent conversation. An already-active sender cannot be reassigned to another account. Reassignment after disconnect creates a new connection row so old queued responses cannot reach the new owner. The user can revoke the connection in Perfil; an HTTP send already in flight may still arrive.

## Smoke test checklist

- Link an activated sandbox phone. Confirm the web card becomes connected and offers "Abrir conversa no WhatsApp".
- Send `Oi` and get a reply.
- Send three short messages quickly. Confirm one buffered turn.
- Send a photo with a caption and a voice note together. Confirm one turn that uses both, and that the photo appears in the gallery as an upload.
- Ask for an image without publishing. Confirm the reply text arrives first, then the image.
- Ask Caetano for the active brand name, without creating or publishing anything. Confirm it answers directly without starting a Vanda thread.
- Ask something unrelated to marketing (for example, a school assignment). Confirm a short, polite decline.
- Send `parar`. Confirm queued and active work stop and no late response is sent. Completed publications cannot be undone by stop.
- Replay the same webhook and an individual message from a batch. Confirm no extra turn.
- Reject a missing/incorrect signature and a foreign `phone_number_id`.
- Disconnect. Confirm subsequent messages cannot access the user.
- Check delivery states under Perfil. For unknown delivery, inspect WhatsApp before explicitly resending.

Never use publish/schedule operations as a sandbox smoke test unless the owner explicitly requests them: Vanda's account tools still act on real connected accounts.

## Reliability and operations

HTTP verifies the exact signed body before parsing, caps payloads, and commits a scheduled mutation before acknowledging. Message receipts deduplicate both whole deliveries and batched-to-individual retries. Kapso's unsigned event header is not sufficient authentication on its own; body signatures and inbound direction/number checks are enforced.

Outbound requests use `biz_opaque_callback_data` to correlate status webhooks that race the API response. Delivery states never regress from read to delivered/sent. Explicit 429 rejection retries up to four attempts. Network timeouts/5xx become `unknown`, not blind automatic retries: Meta may already have accepted the send. Retrying only resends stored text; it never repeats the agent or its tools.

There are no global polling crons. Work uses durable Convex scheduled mutations/actions, a watchdog for each active turn, and a timeout for each send. Monitor Convex scheduled-function failures and Kapso's webhook delivery dashboard. Kapso can pause a failing webhook after sustained failures; fix the cause and re-enable it there.

Receipt/history retention requires a separate retention policy. Since October 1, 2026, Meta bills service messages per message as well as templates; confirm Meta's AI-provider classification and pricing with Kapso. Use separate production credentials and explicit opt-in.

## Sources

- https://docs.kapso.ai/docs/how-to/whatsapp/use-sandbox-for-testing
- https://docs.kapso.ai/docs/platform/webhooks/message-events
- https://docs.kapso.ai/docs/platform/webhooks/security
- https://docs.kapso.ai/docs/platform/webhooks/advanced
- https://docs.kapso.ai/docs/whatsapp/send-messages/text
- https://docs.kapso.ai/api/meta/whatsapp/media/get-media-url
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages

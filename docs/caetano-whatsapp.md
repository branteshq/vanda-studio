# Caetano on WhatsApp

Kapso transports messages. Caetano remains the existing Convex Agent, with one canonical thread per Vanda user. Web and WhatsApp share a serialized inbox. No Kapso agent or workflow is required.

## Scope

Implemented: text, secure account linking, BSUID/phone recipients, signed v2 webhooks, buffered bursts, durable ingestion, per-message deduplication, canonical chat queue, Vanda delegation, `parar`, read/typing receipt, outbound chunking, delivery status, bounded rate-limit retries, user-confirmed resends, and 24-hour window handling.

The sandbox does not support templates. A response outside the service window stays in the web history and waits in the outbox until the user messages again. Web-only turns never enqueue WhatsApp replies. Caetano's normal allowance applies; linking, stopping and delivery do not invoke a model.

Images, voice transcription, document ingestion, generated-image delivery and production templates are not implemented in this text sandbox. Non-text inbound messages receive an explicit text-only notice. No credentials or downloaded media are passed to Python.

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
   - Optional `KAPSO_APP_URL`: public frontend URL for this same environment, used for resource links. Do not point development messages at the production frontend.

6. Deploy development functions with `pnpm exec convex dev --once` from `apps/vanda`.
7. Register a **number-scoped Kapso v2 webhook**, not a project webhook or raw Meta webhook. Destination: `https://<development-deployment>.convex.site/webhooks/kapso`. Use the `.site` URL, not `.cloud`.
8. Subscribe to received, sent, delivered, read and failed message events. Enable received-message buffering with a 3-second window and maximum 20 messages. Disable any other agent/flow replying to this number.

Optional registration script, with the four secret/config variables exported locally:

```sh
# Additional local setup variables, not Convex variables:
export KAPSO_WEBHOOK_URL=https://YOUR-DEV-DEPLOYMENT.convex.site/webhooks/kapso
export KAPSO_SANDBOX_CONFIRMED=true
node apps/vanda/scripts/setup-kapso-sandbox.mjs          # dry run
node apps/vanda/scripts/setup-kapso-sandbox.mjs --apply # run once
```

The script creates a webhook; it does not provision a number, activate a phone or purchase a plan. Manage subsequent changes in Kapso rather than creating duplicate webhooks.

## Production configuration

Production was configured on September 14, 2026:

- Number: `+1 204-900-5501`, phone number ID `1380777355112341`.
- Frontend: `https://app.vandastudio.app`, also configured as `KAPSO_APP_URL`.
- Backend: `accomplished-kookabura-20`.
- Number-scoped webhook: `5dc360a1-f409-49b5-ba25-d79889e11c92`.
- Endpoint: `https://accomplished-kookabura-20.convex.site/webhooks/kapso`.
- Active v2 payloads, received/sent/delivered/read/failed events, 3-second inbound buffering.
- Production has its own signing secret. The development sandbox webhook remains unchanged.

Backend and frontend were deployed directly with owner authorization, without pushing upstream. The frontend was staged and returned HTTP 200 before promotion. Unsigned ingress returned 401 and a signed empty batch returned 200. These checks do not establish a real production phone-to-agent round trip; that requires linking through the production Perfil and receiving a reply.

Production onboarding does not require sandbox activation. Link the production account separately, even if the same phone was linked in development. Only text is supported; production templates are not implemented. Rotate the previously chat-exposed Kapso API key before a broader launch, and confirm Meta AI-provider eligibility and pricing with Kapso.

## Link the Vanda account

In the authenticated web app, open Perfil → Conta → Caetano no WhatsApp. Generate a link, open it and send the prefilled `vanda conectar …` message. This is a separate code from Kapso's activation code. Sending it also opens the messaging window. In live testing, Kapso rejected a send immediately after sandbox activation with HTTP 422, saying the 24-hour window was closed. The adapter holds those replies until a fresh incoming message.

The application stores only a SHA-256 token hash, valid for 10 minutes and consumed once. Tokens never enter the agent conversation. An already-active sender cannot be reassigned to another account. Reassignment after disconnect creates a new connection row so old queued responses cannot reach the new owner. The user can revoke the connection in Perfil; an HTTP send already in flight may still arrive.

## Smoke test checklist

- Link an activated sandbox phone. Confirm the web card becomes connected.
- Send `Oi` and see the same prompt and response in `/caetano`.
- Send three short messages quickly. Confirm one buffered turn.
- Ask Caetano to ask Vanda for the active brand name, without creating or publishing anything.
- Send a web-only prompt. Confirm no WhatsApp delivery is created.
- Submit from web and WhatsApp while a turn is active. Confirm serialized execution.
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

Receipt/history retention and production message templates require a separate retention/launch policy. Before production, confirm Meta's AI-provider classification and pricing with Kapso, including any October 2026 changes. Use separate production credentials and explicit opt-in.

## Sources

- https://docs.kapso.ai/docs/how-to/whatsapp/use-sandbox-for-testing
- https://docs.kapso.ai/docs/platform/webhooks/message-events
- https://docs.kapso.ai/docs/platform/webhooks/security
- https://docs.kapso.ai/docs/platform/webhooks/advanced
- https://docs.kapso.ai/docs/whatsapp/send-messages/text

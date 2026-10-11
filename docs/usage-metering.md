# Usage metering

Every real cost an owner causes is charged to one balance per owner (shared across their businesses), in micro-USD, through `usage.chargeUsage` (`apps/vanda/src/convex/usage.ts`). The plan's allowance is its price in BRL × `PLAN_COST_SHARE`, converted at `BRL_PER_USD`. The owner never sees money: Perfil shows the percentage used, what it went to (categories in `usageCategories.ts`) and what is still available in concrete terms ("~140 pesquisas de perfil"). Vanda and Caetano read the same breakdown through `settings_get billing.plan`.

## What is charged

| Work                                                    | Kind                       | Category  | Notes                                                       |
| ------------------------------------------------------- | -------------------------- | --------- | ----------------------------------------------------------- |
| Vanda and Caetano turns                                 | `chat`, `caetano_chat`     | Conversas | $0 on the ChatGPT plan (runs on the owner's subscription)   |
| Conversation titles, history compaction                 | `title`, `context_summary` | Conversas | $0 on the ChatGPT plan                                      |
| WhatsApp voice-note transcription (OpenRouter fallback) | `transcription`            | Conversas | OpenRouter's reported cost, or `TRANSCRIPTION_FALLBACK_USD` |
| Image generation (paint)                                | `paint`                    | Imagens   | $0 on the ChatGPT plan                                      |
| Instagram research (Apify)                              | `instagram_apify`          | Instagram | per result, `instagram/costs.ts`                            |
| Market radar                                            | `scan`, `full_loop`        | Radar     | flat Apify estimates in `marketNode.ts`                     |
| Analysis steps (radar, onboarding brand profile)        | `pipeline`                 | Radar     | per-model estimates in `pipeline/liveTelemetry.ts`          |
| Web search and page reads (Parallel)                    | `web_parallel_*`           | Web       | `web.ts`; also capped at `WEB_DAILY_LIMIT` per 24h          |

Autopilot (posts automáticos) has no meter of its own: its diagnosis, plans and posts are Caetano turns, so they are charged like the rows above.

## What is deliberately not charged

| Cost                                                        | Why                                                                                                                                                                                                                                                                                         | To charge it later                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WhatsApp messages (Meta's per-message fee via Kapso)**    | Decided to leave out for now (Oct 2026). Normal service messages in Brazil are about $0.0098 each, first 1,000 per number per month free; $0.0625 if Meta classifies Caetano as an AI provider (clause 4.7 of the WhatsApp Business terms). Confirm the real rate on a Kapso invoice first. | Charge in `whatsapp.ts` when Kapso confirms delivery (`sent`), kind `whatsapp_message`, rate in one constant; add a "Mensagens no WhatsApp" category in `usageCategories.ts`. |
| Kapso platform fee                                          | Fixed $25/month (100k messages included): overhead, not per owner.                                                                                                                                                                                                                          | —                                                                                                                                                                             |
| Kapso's automatic transcription                             | Included in Kapso's fee.                                                                                                                                                                                                                                                                    | —                                                                                                                                                                             |
| Instagram reads through the connected account (Upload-Post) | Covered by the Upload-Post subscription, not per call.                                                                                                                                                                                                                                      | —                                                                                                                                                                             |

## Adding a new cost

1. Charge it with `chargeUsage` (in a mutation) or `internal.usage.charge` (from an action), with a descriptive `kind`.
2. Make sure `categoryOfKind` puts that kind in the right category (unknown kinds count as Conversas).
3. Check the balance before spending (`internal.usage.budget`, throw `USAGE_LIMIT` when not ok) unless the work is already paid for.
4. Add the row to the table above, and mention it in `apps/vanda/product-docs/planos-e-uso.md` if the owner would notice it.

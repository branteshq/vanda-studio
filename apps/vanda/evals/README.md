# Fictional-brand evaluations

`fixtures.ts` contains synthetic inputs for evaluating Vanda with four independently invented Brazilian small businesses. They are test fixtures, not customer data, production configuration, or claimed evaluation results. The file exports `brands` (brand context) and `cases` (prompts plus observable expectations); it deliberately contains no model-provider or publishing code.

## Running

The opt-in harness is `src/convex/agentQuality.live.test.ts`. Ordinary tests skip it. It runs the real Vanda/Caetano actions, tools, subscription transport, and (when called) image generation and E2B Python. Each case gets an isolated `convex-test` database. No deployment or Convex credentials are needed. Scheduling execution is replaced by a local mock; external requests are restricted to ChatGPT and E2B. These are live provider calls and consume subscription/sandbox resources.

From the repository root:

```sh
VANDA_LIVE_EVAL=1 \
VANDA_EVAL_AUTH_FILE=/absolute/private/chatgpt-auth.json \
pnpm --filter @vanda-studio/vanda test:run src/convex/agentQuality.live.test.ts
```

The private JSON must contain `tokens.access_token`, `tokens.refresh_token`, and `tokens.account_id` from an authorized, current ChatGPT connection. Keep it outside the checkout, permission 0600; never commit or attach it. Refresh expired credentials using the normal OAuth flow. The harness encrypts a temporary copy in its disposable database and never writes credentials to result files.

- Default: 15 development cases, GPT-5.6 Terra, GPT Image 2.5 Flare. `VANDA_EVAL_MODEL` can select another subscription-compatible GPT orchestrator.
- `VANDA_EVAL_CASES=caju-combo-draft,pimba-kit-revision` selects cases explicitly. The four `holdout: true` cases require explicit selection. These mark the original split; they were first reviewed on September 18 and are now regression cases, not untouched holdouts. Add new unseen cases before claiming generalization.
- `VANDA_EVAL_FULL_ART=1` appends the experimental complete-art instruction used for the original hybrid-versus-full-generation comparison. Leave unset when evaluating current production instructions, which now allow full generation by default.
- `VANDA_EVAL_OUTPUT` changes the output parent; default is `.amp/in/artifacts/agent-quality/<timestamp>/<case>/`.

There are four fictional brands and 19 cases, including delegated Caetano draft/revision cases and live-state product help. Historical preferences are seeded in a **different thread**, not handed to the model as current conversation context. Revision cases attach deterministic reference PNGs rendered by `references.ts`; they are synthetic diagrams, not real packaging/product photos. Delegated revision fixtures name their reference explicitly rather than relying on matching case IDs. The harness records the same attachment manifest as production ingress before delegation (without scheduling a second agent run), and checks that the original image resource is present. The purple pen deliberately matches its original background color, so a global color replacement destroys the product and should fail review.

The failure case injects a real rejected paint execution; the user prompt does not tell the agent the answer. The rescheduling case starts with a local scheduled post; its September 2026 dates are fixture-specific and must be advanced together when replayed after that date. The mock checks the target post and updates its local schedule without invoking a publisher.

Each result records the input, brand, exact system prompt, fixture hash, model, transport, elapsed time, tool trace, final response, post/image state, and provider statuses. PNGs contain the actual outputs. Local mock-storage URLs are inlined as the same image bytes for provider requests. This tests the backend agent loop, **not browser rendering, real delivery, billing, or deployed Convex search ranking**.

`patches/convex-test@0.0.53.patch` makes the simulator skip non-string full-text search fields, as Convex does for absent indexed values. Without it, searching after an agent tool call crashes on its missing optional `text`. A boundary regression covers this. The patch does not make local tokenization or ranking equivalent to production.

Automated assertions check provider errors, real draft creation, carousel count, revision output existence, exact decoded pixels in fixture-defined protected regions, actual Caetano `inspect_image` execution after delegation, rejected `paint` execution, conservative failure disclosure, exact historical CTAs, and scheduling intent/time. The failure-disclosure check is deliberately only a contradictory-claim guard: a text heuristic cannot prove semantic truth, completeness, or user understanding. These are not taste judgments. A passing test can still contain bad artwork or misleading prose outside those narrow checks. Ordinary offline tests include deliberate false positives (success after failed paint, inspection claims without tool execution, and changed protected pixels) to ensure the guards fail closed. Review every expectation and the actual files. Experiment decisions and remaining limitations are recorded in `docs/agent-quality.md` at the repository root.

## Reviewing

For a formal preference comparison, blind reviewers should see anonymized outputs in randomized order and assign one label. Initial implementation trials were reviewed by Amp, not blinded human judges; they establish observed defects and provisional choices, not validated customer preferences.

- **Ready**: usable as delivered; all material instructions and brand facts are preserved.
- **Needs changes**: direction is useful, but a limited edit is required before use.
- **Unacceptable**: unsafe, misleading, off-brand, unusable, or contrary to an explicit instruction.

Record objective failures separately from the blind label. Examples include a wrong price or color, an invented claim, changing protected product details, treating a date in a creative brief as a scheduling command, claiming a failed tool succeeded, or invoking anything other than the supplied mock publisher. This separation prevents subjective polish from hiding factual or safety failures.

Tag every run as either a **first attempt** or **revision**. First attempts test interpretation and brand application; revisions test whether requested changes are isolated while protected details remain stable. Keep results from these groups separate. Repeat cases across runs to check consistency, but retain each repeat as an individual observation rather than selecting the best output. Report the model/configuration, fixture version, run count, blind-label counts, and objective-failure counts; do not present these fixtures themselves as measured performance.

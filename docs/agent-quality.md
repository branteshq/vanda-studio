# Vanda agent quality: findings and next steps

Working notes from the September 18, 2026 discussion with Davi. This is a living
document for continued investigation and implementation, not a finished design.

## Portrait transport correction — September 25, 2026

OpenRouter's Sunburst and Flare endpoint metadata excludes `aspect_ratio: "4:5"`,
and the dentist run received that exact HTTP 400 rejection. However, two direct
live probes with `size: "1024x1280"`, no `aspect_ratio`, `quality: "low"`, and
`n: 1` both returned HTTP 200 and decoded to exactly 1024×1280. Each cost
$0.005275 ($0.01055 total). These were dimension probes, not quality evaluations.
The OpenRouter adapter now uses explicit pixels for 4:5 on these two models;
other models and ratios retain their existing parameter handling.

The shared paint tool, image actions and subscription size mapping also accept
3:4. The carousel skill keeps 4:5 as default and explains how to change the actual
tool argument if a provider requires a portrait alternative.

The affected owner's OAuth connection was ignored because `planId` was absent.
Connected users without a plan now route through ChatGPT; explicit non-Conectado
plans retain their prior routing. Regression tests cover both missing-plan states,
explicit plans, provider serialization, agent validation and 3:4 image storage.
These changes require backend deployment to affect existing dev accounts.

## Shared capabilities — September 25, 2026

Image creation now uses `paint` exclusively, guided by the bundled
`creating-carousel-images` skill. The 141 Python layouts, template and portrait
prompt packages, reusable-template workspace/UI, `run_code`, E2B runner and build
dependencies are removed. Both agents load the new skill for creative work.
Research tools still read Instagram data, but no longer offer Python batch analysis.
Legacy images, execution records and conversation traces remain readable; no
customer data was deleted. Earlier template comparisons below are historical only.

Verification after removal: 356 offline tests passed, 15 opt-in live cases skipped;
app typecheck passed. A separate ChatGPT-subscription run of
`orvalho-product-draft,pimba-caetano-draft` passed both cases with normal production
instructions (no benchmark-method override), Terra orchestration and Flare at high
quality. Both agents read the new skill. Four final images, four paint calls, zero
code executions and draft-only posts were observed. The three-slide carousel took
114 seconds and the single post 46 seconds. Visual inspection found coherent,
readable artwork and correct prices; small footers and a background seam remain
quality limitations. These are smoke checks, not a new blinded model comparison.
The rendered business settings view shows the new skill and no Templates tab.

Vanda and Caetano now use one tool catalog, discovery configuration, and execution
prompt. Only persona and channel instructions differ. Caetano executes marketing
directly in its existing web/WhatsApp conversation; `ask_vanda`, its delegation
action, and duplicate image-inspection/presentation tools were removed. Both use
`paint`/`read` for inspection, retain draft-first publication rules, and can access
product/account tools. Web Caetano remains available.

Account-scoped conversations stay pinned. Owner-scoped Caetano turns snapshot the
selected business; `select_account` explicitly updates that turn's scope and brand
context. Long-running tools carry the exact originating activity for cancellation
and usage attribution. Existing delegated conversations and legacy stored fields
remain readable; no migration or deletion of customer history is required.

The notes below describe earlier implementations and evaluation results, including
the now-removed delegation design. They are historical evidence, not the current
tool contract. New evaluations use `pimba-caetano-draft` and
`pimba-caetano-revision` and check direct execution and pixel-returning tools.

## Confirmed scope and implementation status

- Brand context must always be included. Previous conversations and media should
  be discoverable rather than requiring the user to repeat information.
- "Make a post" means create a draft. Do not automatically schedule or publish;
  require an explicit user request. Standing publication permission is not part of
  the current scope.
- Vanda and Caetano must both be able and instructed to review their own work,
  inspect images, and correct concrete problems. Do not add a separate reviewer
  agent. Start with at most two correction rounds and evaluate that limit.
- Work with GPT models through Davi's connected ChatGPT subscription for the initial
  live comparisons. This does not require removing other existing model support or
  changing unrelated users' preferences. Live trials now use GPT-5.6 Terra and GPT
  Image 2.5 Flare; no cross-model winner has been established.

The first local implementation supplies brand facts, the visual kit, brand notes,
and durable memory at the start of both agents' turns. Account selection returns
updated brand context. Caetano's handoff preserves the original current message
and attachment IDs/pixels using stored message and attachment references, with
ownership checks. Older conversations and media are now discoverable;
the new attachment record applies to messages submitted after this change.

Vanda's paint result now carries image pixels for inspection. Caetano has an
ownership-checked `inspect_image` tool and can request specific corrections in the
same Vanda conversation. Python-generated images remain inspectable through Vanda's
existing `read` tool. Both agents are instructed to self-review and deliver drafts
unless the user explicitly asks to schedule or publish.

The scheduling restriction is currently agent guidance and tool descriptions, not
a new server-side approval mechanism. Existing post creation still creates drafts;
the scheduling operation remains separately callable. Automated tests cover context
and media transfer, account isolation, image tool outputs, and draft creation, not
real-model compliance or aesthetic quality. The opt-in live evaluations exercise
real model behavior separately; their assertions are not aesthetic judgments.

Tool discovery, maintained product help, conversation-content search, media discovery,
and a fictional-brand evaluation harness are implemented locally. Four fictional
brands and 19 cases cover creation, revision, recall, help, failures, delegation, and
scheduling intent. Trials and provisional findings are recorded below. Nothing in
these implementations deploys or changes shared data.

### Tool discovery implementation

The working tools remain directly visible; specialized tools are discovered through
`tool_search`. The initial split is:

| Agent   | Always visible                                                                        | Discoverable                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vanda   | `tool_search`, `list`, `read`, `write`, `paint`, `run_code`, `create_post`, `present` | The six Instagram research/analytics tools, `schedule_post`, `cancel_schedule`, `delete_post`, `product_help`, `search_conversations`, `read_conversation`, `search_media`                         |
| Caetano | `tool_search`, `ask_vanda`, `inspect_image`, `present`, `account_status`              | `list_accounts`, `select_account`, `usage_status`, `model_preferences`, `set_model_preferences`, `list_vanda_threads`, `product_help`, `search_conversations`, `read_conversation`, `search_media` |

Each agent receives a short capability map and instructions to search before declaring
a task unsupported. Brand context remains automatically included, outside discovery.
The maps now include product help and previous-work retrieval.

Search is local keyword matching over names, existing descriptions, and Portuguese/
English aliases, ignoring case and accents. An exact tool name returns only that
tool; other searches return up to four matches. `*` lists the agent's entire deferred
catalog. No match suggests reformulating or browsing rather than inventing a tool.
This is not semantic search; live trials may expose missing vocabulary or poor ranking.

Results include names, descriptions, and read/write effects. AI SDK `prepareStep`
exposes the selected original tools and their input schemas on the next step, retaining
them for the rest of that invocation. Discovery comes only from the current invocation's
completed search results, not old messages or shared mutable state. The next turn starts
with the core tools again. There is no JavaScript invocation wrapper or new model call.

The original executions, validation, account checks, resource recording, and image output
conversion stay intact. Finding a tool does not confirm that a connection is available,
grant permissions, or authorize publication. The SDK rejects calls to inactive tools,
but discovery is not a replacement for the application's authorization checks.

Automated checks exercise the initial role-specific schemas, search-to-execution loop,
accumulation and next-turn reset, invalid/undiscovered calls, and real Convex account
selection with owned and foreign accounts. Model responses are scripted in these tests;
we have not yet tested whether live GPT chooses good searches or measured latency/token
savings. Product-help retrieval and previous-work retrieval are the next capability work.

## What we want

Vanda should feel like it just works. The customer should not have to repeat brand
facts, explain the product to its own agent, choose the right model for every task,
or supervise each tool call.

That means the agent understands the request, finds the capabilities it needs,
does the work, checks the result, and explains what actually happened. Unsupported
requests and failures should be handled honestly, with a useful next step.

We cannot promise excellent results for every conceivable request. We can make
supported tasks consistently good and failures recoverable.

## What we know and what we have not proved

The founder reported a large quality difference between a post generated through
another chat experience and one requested through Caetano with reportedly the same
inputs. The screenshot shows one artifact, not both original conversations,
generation requests, and outputs. It does not establish which model, prompt, or
production method caused the difference.

We inspected the current source and public Amp documentation. We did not inspect
production Convex data, run paid model comparisons, reproduce the founder's case,
or change the application during this investigation.

The founder's observation that Opus 5 performs best is worth testing. The claim
that there is no model gap also needs testing. Neither is established yet.

There are no users yet and not enough real customer examples to depend on.
Mining Convex is optional supporting work, not a prerequisite for evaluation.

## Findings before the first implementation

The observations below record the initial investigation. The implementation status
above supersedes them where a gap has since been addressed.

### Caetano and direct Vanda chat do not pass the same information

Direct Vanda chat supplies user text, attachment pixels, and attachment image IDs.
Caetano receives attachment pixels, but its `ask_vanda` tool passes a model-written
text request, an optional account, and an optional destination thread. The original
attachments and surrounding Caetano conversation are not automatically copied.

The delegated request enters a separate Vanda conversation. By default, that
conversation is reused for the account, so its history may differ from a direct
chat. Instructions tell Caetano to preserve the request, but the application does
not guarantee that its paraphrase retains everything.

Vanda may recover missing information by finding assets or reading its workspace.
That does not make the two paths equivalent. This is a confirmed context mismatch,
not proof that it caused the founder's specific result.

Relevant code:

- [chat.ts](../apps/vanda/src/convex/chat.ts): `sendMessage` includes image pixels
  and `vanda_attachment_context` with IDs.
- [caetano.ts](../apps/vanda/src/convex/caetano.ts): `submitMessage` supplies image
  content to Caetano without the same image-ID text context.
- [caetanoAgent.ts](../apps/vanda/src/convex/caetanoAgent.ts): `askVanda` accepts the
  delegated request as text.
- [caetanoData.ts](../apps/vanda/src/convex/caetanoData.ts): `prepareVandaTurn`
  selects the persistent destination and saves a text-only message.
- [caetanoNode.ts](../apps/vanda/src/convex/caetanoNode.ts): `askVanda` runs the
  delegated turn and returns its resources.

Proposed change: preserve the original request, attachments, and relevant prior
constraints mechanically. Keep Caetano's interpretation as additional context,
not the only version of the request. Do not blindly copy all conversation history.

### The prompt strongly prescribes how images are made

Vanda routes generative changes through `paint` and text, logos, cropping, and exact
brand-color composition through `run_code`. The prompt says generated text makes
mistakes while text composed by code does not.

Code can render exact supplied text and assets, but model-written code can still
choose poor typography, clip content, use awkward spacing, or render incorrect
copy. Deterministic rendering does not guarantee good design.

A comparison with whole-image generation may therefore compare production methods,
not just orchestrator models. Test these alternatives rather than assuming a winner:

| Method                                   | Potential benefit                  | Risk                                      |
| ---------------------------------------- | ---------------------------------- | ----------------------------------------- |
| Generate the complete composition        | Cohesive visual design             | Incorrect text, logos, or product details |
| Generate artwork, then compose with code | Control over copy and brand assets | Generic or disconnected layout            |
| Use approved reusable templates          | Predictable consistency            | Repetition and limited flexibility        |

Sources: [vanda.ts](../apps/vanda/src/convex/vanda.ts), especially `INSTRUCTIONS`,
`paint`, and `runCode`; [run-code-design.md](run-code-design.md) explains the design
intent but is not itself evidence that every described behavior is implemented.

### Displaying an image is not the same as inspecting it

`paint` returns metadata and an image resource for the UI. Vanda must separately
call `read` to receive the image pixels. The produced-carousel instructions ask it
to inspect the art, but the generation tool does not automatically provide that
visual feedback.

The helper `reviewGeneratedAsset` exists but had no callers in the inspected source.
Its criteria reject text and logos because it reviews visual assets, not complete
marketing posts. Enabling it unchanged would not solve final-post review.

Chosen direction: return image pixels to the creating agent, have it check the
actual artifact against the request and brand, and allow a bounded correction.
Both Vanda and Caetano should self-review; a separate reviewer is out of the current
scope. Seeing pixels alone does not guarantee sound judgment.

Sources: [vanda.ts](../apps/vanda/src/convex/vanda.ts), `paint` and `readFile`;
[images.ts](../apps/vanda/src/convex/images.ts);
[imageGeneration.ts](../apps/vanda/src/convex/pipeline/imageGeneration.ts).

### Essential brand information depends on retrieval

The conversational system prompt describes the workspace and adds a live clock.
The agent is instructed to read brand facts, the visual kit, and durable preferences.
Those facts are not all automatically included with each new task.

Confirmed requirement from Davi's review: brand context must always be included.
The user must never have to re-explain who they are or what their business is.
Supply the known business identity, brand facts, visual identity, restrictions, and
explicit preferences automatically rather than depending on the agent to search
for them. Missing facts must not be invented.

Thread history and media should ideally be discoverable when relevant, rather than
loading the entire archive into every turn. This does not remove the requirement
to preserve the current request and its attachments when delegating to Vanda.

The pipeline already has `renderBrandContext`; that is a useful existing pattern,
but does not mean the conversational path automatically uses it.

Sources: [vanda.ts](../apps/vanda/src/convex/vanda.ts), `systemPrompt`;
[chat.ts](../apps/vanda/src/convex/chat.ts), `generateResponse`;
[brandContext.ts](../apps/vanda/src/convex/pipeline/brandContext.ts);
[brand workspace mount](../apps/vanda/src/convex/workspace/mounts/brand.ts).

### Some instructions need product decisions

- The original prompt favored scheduling soon when immediate publication was
  ambiguous. Davi decided that creating a post must mean creating a draft, with
  scheduling or publication requiring explicit user input. The first implementation
  removes those automatic-scheduling instructions.
- The always-on `unslop` skill contains general writing restrictions, including
  neutral descriptions. They may help assistant replies but conflict with some
  brands' advertising. Separate the assistant's voice from the customer's brand
  voice and evaluate the effect rather than assuming the skill is harmful.
- The installed skill catalog includes market research and `unslop`; it does not
  supply a dedicated post-design skill in the inspected version.

Sources: [vanda.ts](../apps/vanda/src/convex/vanda.ts);
[generated skill catalog](../apps/vanda/src/convex/skills/generated.ts);
[skill prompt assembly](../apps/vanda/src/convex/skills/catalog.ts).

### Caetano has live-state tools but lacks a product guide

Caetano can inspect accounts, connection and onboarding flags, usage, model
preferences, and previous Vanda conversations. No product-documentation retrieval
was found in its toolset. Vanda's own workspace access does not substitute for a
maintained guide to using the product.

Proposed change: combine a small, versioned product guide with live-state tools.
Cover setup, plans, supported features, channel limitations, and recovery steps.
For a publishing problem, inspect the account and failed operation, find the
matching recovery instructions, and explain the actual next step. Never claim a
connection or publication succeeded without checking.

The WhatsApp path currently accepts text only, unlike Caetano's web attachments.
Channel differences must be part of product knowledge and evaluation.

Sources: [caetanoAgent.ts](../apps/vanda/src/convex/caetanoAgent.ts);
[caetanoData.ts](../apps/vanda/src/convex/caetanoData.ts), `accountStatus`;
[WhatsApp protocol](../apps/vanda/src/convex/whatsapp/protocol.ts);
[whatsappData.ts](../apps/vanda/src/convex/whatsappData.ts).

### The selected model is not the whole execution setup

At inspection time, Vanda defaults to Opus 5 on OpenRouter and GPT-5.6 Terra on the
connected ChatGPT subscription route. Caetano has its own preference and defaults
to GPT-5.6 Terra. Image generation has a separate model selection and transport.

Record the models and settings actually resolved at execution time. A picker label
or the same user prompt does not establish an equivalent comparison.

Sources: [agentModels.ts](../apps/vanda/src/convex/agentModels.ts);
[imageModels.ts](../apps/vanda/src/convex/imageModels.ts);
[chat.ts](../apps/vanda/src/convex/chat.ts);
[images.ts](../apps/vanda/src/convex/images.ts).

## What we learned from Amp

### Product awareness comes from information and capabilities

The agent in this conversation has an explicit `create_thread` tool. Other platform
operations are discoverable functions, such as finding threads, inspecting settings,
and messaging another thread. Documentation and current environment information
explain how to use those capabilities.

This does not prove Puck's exact internal architecture or imply the model inherently
knows every product detail. The transferable approach is: provide accurate product
instructions, inspect live state, perform authorized actions, and verify outcomes.

The session exposed these 24 directly callable tools:

```text
apply_patch              code_exec               create_thread
download_thread_changes download_thread_file    finder
librarian                load_plugin             oracle
painter                  read_thread             read_web_page
reload_mcp               reload_plugins          reload_skills
shell_command            shell_command_kill      shell_command_status
skill                    Task                    tool_search
upload_thread_file       view_media              web_search
```

It also exposed `multi_tool_use.parallel`. Davi's local `amp tools list` showed a
14-tool subset. We verified the discrepancy but did not determine its cause.

The discoverable `amp` module advertised these 25 functions:

```text
find_thread                     public_artifact_url
thread_file_url                 thread_portal_login_url
get_current_user_identity       get_settings
update_setting                  slack_write
slack_read                      x_read
x_reply                         send_email
get_schedule                    set_schedule
update_schedule                 clear_schedule
list_agent_modes                list_runners
list_workspace_members          find_shared_plugins_and_skills
update_thread                   get_thread_status
send_thread_message             ship_thread_changes
wait_for_threads
```

The registry also advertised Linear (79 functions), Sentry (9), Axiom (31), PostHog
(1), Notion (45), and Grain (36): 226 discoverable functions including Amp. These
are a session snapshot, not a universal or permanent Amp inventory. We did not
inspect every schema or verify authorization for every operation.

### Discovery is a direction we want for Vanda

Davi explicitly wants capability discovery in Vanda. The agent should not need all
function definitions in every turn to know that useful capabilities might exist.

The basic flow is:

```text
Request -> identify needed capability -> tool_search
        -> load matching definition -> execute -> inspect outcome
```

Keep common tools directly available. Discover less common functions when needed.
Give the agent a short capability map and instruct it to search before concluding
that a request is unsupported. A bare search tool without that guidance may go unused.

Search results should include purpose, required inputs, and whether an operation
reads information or changes state. Distinguish unsupported operations from missing
connections, missing permissions, and temporary failures.

Discovery saves upfront context but adds a step; loaded definitions and results
still consume context. Finding a function never grants permission to execute it.
Enforce ownership and authorization in the application on every call.

The first implementation uses the split documented above: existing tools retain
their implementations, local search selects them, and the SDK exposes their typed
definitions. Product-help and deeper previous-work retrieval can join the catalog
when implemented. Copying Amp's JavaScript `code_exec` layer is not required.

### Prompts matter, but there is no proven magic prompt

Amp's public 2025 model-evaluation notes emphasize real usage, qualitative examples,
regression tests, and tuning tools and feedback loops for different models. Its
"Raising an Agent" discussion also cautions against attributing everything to a
clever system prompt.

These sources do not reveal Amp's complete current internal evaluation system.
They do not establish that Amp avoids numerical measurements.

For Vanda, prefer a shared behavioral contract, task-specific guidance, and small
model-specific adjustments justified by repeated failures. Avoid immediately
maintaining entirely different prompts for every model.

## Evaluate taste without waiting for users

The agreed starting point is fictional but realistic businesses and requests,
judged by taste. Real customer data can improve the collection later.

Give each fictional business coherent facts, products, visual identity, reference
assets, and restrictions. Include different kinds of businesses so the default is
not optimized only for Vanda Studio's style.

Representative situations:

| Request                                            | What we want to learn                                         |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Make a post about this product                     | Is the output usable and faithful without needless questions? |
| Give the same request directly and through Caetano | Do intent, attachments, and constraints survive?              |
| Change only the background                         | Are the product and unrelated details preserved?              |
| This looks generic; improve it                     | Does the revision actually improve the design?                |
| Use the style we picked earlier                    | Does the agent use the relevant prior decision?               |
| Why can't I publish?                               | Is the explanation accurate and actionable?                   |
| Move tomorrow's post to Friday                     | Does the correct post move without a duplicate?               |
| A tool fails halfway through                       | Does the agent recover or explain the actual blocker?         |

Davi and the founder define what good feels like. Review outputs side by side,
hide model and prompt identities, randomize order, and allow ties and "both bad."
Ask which they would actually use, whether manual repair is needed, and why.

Simple labels are enough: ready to use, needs changes, unacceptable. A reason such
as "the headline is readable and the layout feels less generic" is more useful
than an invented numerical taste score. Judge artwork separately from the quality
of the conversation so good narration cannot hide bad output.

Keep hard failures separate: incorrect product or account, invented price,
unsupported claim, broken attachment transfer, duplicate scheduling, or false
claims of success. A beautiful output cannot compensate for these.

Preserve the inputs, attachments, brand snapshot, relevant history, resolved models,
transport and settings, prompt version, tool calls, final artifacts, final state,
cost, latency, and reviewer explanation. Do not record credentials in fixtures or
traces. Use synthetic or explicitly permitted reference material.

Repeat important comparisons to detect lucky results. Start each trial from clean
test state; previous memory writes or generated assets must not leak into later
trials. Use disposable state for publishing tests, never real account publication.
Keep some examples outside prompt development to check generalization. Evaluate
the first-attempt experience, not just the best output selected from many attempts.

An LLM judge can later help identify problems, but should be checked against human
preferences before its judgments become trusted. Do not rely on the generating
model declaring its own work good.

The existing `inputQuality.eval.test.ts` checks deterministic input qualification.
It is useful but does not evaluate end-to-end creative quality or helpfulness.

Store approved and rejected examples with reasons. Keep preferences specific to
the business. Do not turn a one-off revision into a permanent brand rule without
justification. Visual preference also does not establish improved marketing results;
business performance will require evidence after launch.

## Recommended order of work

1. Create fictional brands and realistic requests. Generate a baseline and review
   the results together. Reconstruct the founder's comparison if its inputs become
   available, but do not block on it or on Convex data.
2. Fix context preservation between Caetano and Vanda and always include brand
   context. Make previous thread history and media discoverable when needed.
3. Add minimal discovery over existing capabilities, with an authorized execution
   path and clear descriptions. Include product help as it becomes available.
4. Give Caetano a maintained product guide alongside live-state inspection.
5. Close the image generation, inspection, and correction loop. Compare complete
   image generation, hybrid composition, and templates.
6. Compare prompts and orchestrator models on the stable examples. Change one
   uncertain thing at a time, repeat important cases, and retain regressions.

Implemented locally: context preservation, always-on brand information, draft-only
guidance, self-review capabilities, and minimal tool discovery. Both agents can now
discover product_help, search_conversations, read_conversation, and search_media.
Product help covers six maintained topics and points to real UI routes; it does
not substitute for live account state. Historical messages are scoped to the
active account (or Caetano's owner), and archived threads are excluded. Retrieval
uses keywords, not embeddings. Messages and media are paginated; resource manifests
are limited to the latest 100 and report truncation. Scheduling guidance remains a
prompt policy, not a server-side approval gate.

Verification for this slice: typecheck passes; 301 tests across 51 files pass,
including discovery, ownership boundaries, history pagination, and media matches
beyond an empty page. These checks do not establish creative quality. Subsequent
live fictional-brand comparisons are recorded below. No deployment or production writes made.

## Review decisions and questions to investigate

Brand context, draft-only creation, self-review by both agents, and GPT-only initial
comparisons are settled. Previous thread history and media should ideally be
discoverable. The remaining implementation choices are work for investigation and
experiments, not choices Davi needs to make upfront.

- **Which tools are visible immediately?** The initial split is implemented above:
  creation, inspection, delivery, and role-essential tools stay visible. Specialized
  integrations and account operations are discovered. Adjust based on live trials.
- **How does the agent call a tool after finding it?** It calls the original typed
  tool directly on the next step. Account ownership and permissions are still
  checked by the original implementation. No extra code-execution layer was added;
  Vanda's existing Python tool remains directly available.
- **When may Vanda schedule or publish?** Only when the user explicitly requests
  it. "Make a post" always creates a draft, even if the creative brief mentions a
  date. Approval of the artwork alone is not permission to publish.
- **How should Vanda make the artwork?** "Production method" means generating
  the whole post with an image model, generating a background and adding text/logo
  with Python, or using an approved template. Initial trials favor complete-image
  generation for new artwork and code for precision edits/templates. This is the
  provisional default, not proof that one method always wins.
- **Who checks the finished image, and when should it try again?** The working
  agent does it. Both Vanda and Caetano should inspect their results and correct
  concrete defects. No separate reviewer or reviewer subagent. We still need to
  evaluate when another attempt helps and whether the initial two-round limit is
  appropriate.
- **Which model and prompt work best?** We have to find out through the fictional
  tasks and taste-based comparisons above, including consistency, cost, and wait
  time. Limit initial live work to GPT models using Davi's connected subscription.
  Do not choose a winner from assumptions or one impressive output.

As work proceeds, add the experiment, what changed, the observed result, and the
decision here. Keep hypotheses distinct from measured or directly observed facts.

## Live GPT trials: integration findings

The initial subscription trials exposed two failures that mocked model tests missed:

- The installed OpenAI SDK confused our ordinary `tool_search` function with its
  native tool-search operation during history replay. The next request failed with
  HTTP 400 (missing `arguments`). Updated `@ai-sdk/openai` to 3.0.114, which contains
  the upstream fix. The connection-help trial now completes using `account_status`,
  `tool_search`, and `product_help`.
- Image tool outputs used the newer `file` representation, but this SDK's Responses
  adapter silently discarded it. Paint/inspect/read now return `image-url`. A wire
  regression test checks for `input_image` in the outgoing provider request. This
  enables inspection; it does not prove the agent judged an image correctly.

Typecheck and all 303 offline tests pass after these fixes. Early harness runs also
had missing activity rows and incorrect mock-storage handling; those are setup
failures, not evidence about model taste or reliable first-attempt performance.

## Fictional-brand trials and provisional decisions

Fixtures and replay instructions live in `apps/vanda/evals/`. Café Caju is a warm
neighborhood café, Orvalho Botânica a restrained skincare brand, Prumo Reparos a
practical repair business, and Pimba Papelaria a colorful stationery shop. Inputs
include distinct voices, exact prices, colors, protected details, and unsupported
requests. They are invented businesses, not customer evidence.

Trials call the real agents, ChatGPT text/image transport, and E2B Python against
disposable local databases. Instagram publishing is mocked and unrelated external
requests are blocked. No production deployment, customer changes, or live publishing
occurred. Artifacts under `.amp/in/artifacts/agent-quality/` retain exact prompts,
fixture hashes, tool traces, timings, final state, and actual PNGs. Credentials are
not included. Amp reviewed the outputs; these are not blinded human taste results.

| Experiment / batch (2026-09-18 UTC) | Observation                                                                                                                                                                                                                                              | Decision                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Hybrid baseline, 19:47              | Prumo text overlapped an icon despite self-review. Café artwork was usable but generic. Python did not guarantee good layout.                                                                                                                            | Remove the claim that code-rendered text cannot fail; inspect every final slide.                                                 |
| Complete-art comparison, 19:54      | Café had clearer branding and hierarchy; Prumo was readable without the compulsory composition step. Only two cases, not a statistical comparison.                                                                                                       | Generate complete new artwork first; retain code for exact edits and templates.                                                  |
| Development set, 19:59              | Fourteen cases exposed invented skincare application instructions, another layout defect, shipping overpromises, and ambiguous claims about where drafts were saved.                                                                                     | Ground directions as well as prices in brand facts; distinguish Vanda drafts from Instagram; do not offer unavailable lookups.   |
| Targeted follow-up, 20:10           | Four cases passed structural checks. Inspected Orvalho slides avoided invented application times. Pimba used a local background edit. Shipping help admitted the unavailable lookup.                                                                     | Retain these changes provisionally.                                                                                              |
| Initial holdout + repeats, 20:13    | Six weak structural checks passed, but manual inspection found failed recall in both historical-preference cases and weak contrast in a protected-text background revision.                                                                              | Strengthen recall assertions. Once inspected, these cases become regressions, not fresh holdouts.                                |
| Recall investigation, 20:18–20:30   | The test simulator crashed on tool messages without text. After fixing that, Prumo recovered its earlier CTA; Pimba still stopped after finding only the current request. Alternate-query guidance recovered the exact Pimba preference in the next run. | Patch only the simulator's optional-field handling; teach bounded query reformulation and reading the actual older conversation. |

The 19:59 scheduling failure was a harness assertion counting rejected attempts as
successful reschedules; successful actions and attempts are now recorded separately.
The simulator patch skips non-string search fields, matching Convex's omission of
unindexed values. Neither finding establishes a production search failure. Local
search tokenization/ranking still cannot validate deployed Convex retrieval quality.

Taste labels remain **ready**, **needs changes**, and **unacceptable**, with reasons.
For example, the initial Prumo overlap needs changes; invented skincare directions
are unacceptable; the 20:10 Orvalho follow-up was provisionally ready. Passing
an automated test does not establish any of those labels or consistency across repeats. Image revisions use
synthetic diagrams, so success does not prove preservation of real photography.

### Full regression run and remaining gaps

The 20:30:55 batch ran all 18 cases: **18 behavioral checks passed** in 643 seconds.
This includes both historical CTAs, draft creation without scheduling attempts,
explicit rescheduling through the mock, and generation failure reporting. Product
help consulted actual local account state and correctly pointed to Perfil › Conexões.
Caetano delegated creation and then called `inspect_image`. No claim here covers
real Instagram delivery, browser rendering, or a deployed database.

Review of the saved outputs, separate from the automated checks:

- **Ready:** both new Café Caju posts, Prumo's service and recalled-format carousels,
  Pimba's planner and delegated Kit Rabisco artwork. Prices, visible products, and
  branding were correct; final Prumo slides no longer overlapped text and icons.
- **Ready for the requested edit:** Orvalho and Pimba background revisions. A pixel
  comparison found zero changes to Orvalho's 153,880 non-background pixels and to
  129,780 protected Pimba pixels, including the purple pen that matched its old
  background. Background samples matched the requested hex colors.
- **Needs changes:** Orvalho copy still adds unconfirmed details: “after cleansing”
  in the carousel and “light texture” in the otherwise correct refusal of medical
  claims. It rejected the requested medical promises, but the replacement copy is
  not fully grounded. A passing assertion does not hide this finding.
- **Needs changes:** Café's background-only edit preserves white text at the cost
  of contrast. A targeted 20:34:20 rerun with explicit constraint-conflict guidance
  passed and warned the owner that the title was hard to read, without recoloring
  protected text. The artwork still needs an owner-approved text adjustment. A
  pixel comparison also found 200 changed non-background pixels, so this is not a claim of
  byte-for-byte preservation of every non-background pixel.
- Text-only recall, repair-scope help, shipping limitations, and connection help
  were useful and factually consistent with their fixtures. Caetano's delegated
  delivery still included an unnecessary mascot joke; tone is worth further review.

The contrast guidance was added after the full run started and verified in its own
targeted run. These are two configurations, not a claim that the final exact prompt
passed all 18 cases unchanged. The next comparison should also add fresh unseen
cases; all existing cases have now been inspected and used for regression work.

Final offline verification: `pnpm --filter @vanda-studio/vanda typecheck` passes;
`pnpm --filter @vanda-studio/vanda test:run` passes 304 tests across 51 files, with
14 opt-in live cases skipped by default. Targeted Oxlint checks pass. `cargo check`
cannot run because Cargo is unavailable; this checkout's changed code is TypeScript.

Remaining risks: self-review sometimes misses problems; subtle product attributes
can still be invented; keyword discovery can require several attempts. Creative
consistency, real-photo editing, deployed search, latency, and comparison with
another GPT model need further trials. Scheduling authorization remains prompt
guidance, not an enforced server-side approval gate. These results support a better
working default and a repeatable evaluation loop, not “works for every request.”

## Oracle follow-up: retrieval, memory, and evaluation boundaries

The review found three correctness issues. They are now addressed locally:

- Image IDs from media search resolve directly with ownership and generation-state
  checks, including references and files older than the 100-image gallery window.
  Gallery listings retain their existing membership. Failed background description
  analysis does not make existing image bytes unreadable.
- History search examines at most 48 candidates to return 12 eligible messages.
  Archived hits no longer consume the initial 12 slots. Reaching either limit sets
  `incomplete: true` and asks for a narrower query. This is bounded overfetch, not
  exhaustive search or pagination; the component search API has no cursor.
- Always-on `/memory` has a shared 24,000-byte serialized UTF-8 budget, including
  paths and escaping. Writes cannot increase an over-budget account. Existing large
  files are preserved, preference files are prioritized, and a visible partial-memory
  notice directs retrieval rather than treating missing context as missing knowledge.
  No automatic destructive truncation or semantic summarization occurs. Decreasing
  writes allow incremental recovery. Long documents can be copied to discoverable
  `/notes` before compacting memory; brand identity, visual kit, and brand notes
  remain separate, always-included context. This is not a total model-token budget.

The suite now includes a nineteenth case: an attached-image revision delegated
through Caetano. The harness reproduces production's attachment manifest and
attachment timestamp without starting a competing scheduled agent run. Existing
production-ingress boundary tests check transfer of the exact prompt and image.

Evaluation guards now require a successful `inspect_image` result for every final
delegated image after the last delegation, actual rejected paint execution, and a
conservative failure-disclosure check. Pixel tests decode the PNGs and inspect every
protected foreground pixel, including the purple pen's enclosed background-colored
interior. Tests allow genuine background changes and reject single-pixel corruption;
they no longer equate an unchanged bounding rectangle with preserved objects.
The text check remains a heuristic, not proof of semantic truthfulness.

Offline verification covers byte-budget boundaries, escaped/multibyte content,
incremental legacy recovery, archived-result crowding, exhausted search windows,
old/reference media reads, wrong-account and generation-in-flight reads, and the
evaluation guards' false-positive cases. The previous 18/18 live result predates
these stricter checks; no new paid live run or deployed-state change was made in
this review-fix pass. Replaying the saved PNGs passed Pimba and Orvalho preservation
and rejected the known Café edge-pixel change at (461,374), as expected. Typecheck
and targeted lint pass; the full offline suite passes 314 tests across 52 files,
with 15 opt-in live cases skipped by default.

## External references

- [Amp tools](https://ampcode.com/docs/tools)
- [Amp skills](https://ampcode.com/docs/customize/skills)
- [Amp threads](https://ampcode.com/docs/threads)
- [Amp model evaluation, August 2025](https://ampcode.com/news/model-evaluation)
- [Amp: Raising an Agent](https://ampcode.com/podcast/episode-5)
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

The Anthropic article supports combining deterministic checks, human taste judgments,
calibrated model grading, repeated trials, and real outcome inspection. These are
references for the approach, not benchmarks proving that Vanda has improved.

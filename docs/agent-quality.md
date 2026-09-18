# Vanda agent quality: findings and next steps

Working notes from the September 18, 2026 discussion with Davi. This is a living
document for continued investigation and implementation, not a finished design.

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
  changing unrelated users' preferences. No live model comparisons have run yet.

The first local implementation supplies brand facts, the visual kit, brand notes,
and durable memory at the start of both agents' turns. Account selection returns
updated brand context. Caetano's handoff preserves the original current message
and attachment IDs/pixels using stored message and attachment references, with
ownership checks. Older conversations and media discovery remain future work;
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
real-model compliance or aesthetic quality. Those need the GPT comparisons.

Tool discovery is now implemented locally over the existing capabilities. Product-help
retrieval, conversation-content search, and fictional-brand taste evaluations remain
to build. Nothing in these implementations deploys or changes shared data.

### Tool discovery implementation

The working tools remain directly visible; specialized tools are discovered through
`tool_search`. The initial split is:

| Agent   | Always visible                                                                        | Discoverable                                                                                                          |
| ------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vanda   | `tool_search`, `list`, `read`, `write`, `paint`, `run_code`, `create_post`, `present` | The six Instagram research/analytics tools, `schedule_post`, `cancel_schedule`, `delete_post`                         |
| Caetano | `tool_search`, `ask_vanda`, `inspect_image`, `present`, `account_status`              | `list_accounts`, `select_account`, `usage_status`, `model_preferences`, `set_model_preferences`, `list_vanda_threads` |

Each agent receives a short capability map and instructions to search before declaring
a task unsupported. Brand context remains automatically included, outside discovery.
The maps do not advertise product-help or conversation-content search as implemented.

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
beyond an empty page. These checks do not establish creative quality. That still
needs live fictional-brand comparisons. No deployment or production writes made.

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
  with Python, or using an approved template. Compare the results to learn which
  works best for each task; there is no selected winner yet.
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

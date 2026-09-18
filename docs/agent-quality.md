# Vanda agent quality: findings and next steps

Working notes from the September 18, 2026 discussion with Davi. This is a living
document for continued investigation and implementation, not a finished design.

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

## Findings in the current application

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

Proposed change: return a review-sized preview to the creating agent, have it check
the actual artifact against the request and brand, and allow a bounded correction.
A separate reviewer model is a later experiment, not a required extra agent on
every request. Seeing pixels alone does not guarantee sound judgment.

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

- The prompt favors scheduling soon when immediate publication is ambiguous.
  Initiative can become unwanted publication. Proposed default: independently do
  reversible creative work, but derive publication authority from the request or
  an explicit standing policy. This is a proposed policy change, not an agreed
  implementation yet.
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

Start with existing capabilities: account status, settings, previous work,
publication status, and product help. Caetano and Vanda should discover functions
appropriate to their roles. We have not selected a registry, search implementation,
or execution interface yet. A controlled invocation mechanism is enough initially;
copying Amp's JavaScript `code_exec` layer is not required.

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

The suggested first application implementation is context preservation plus minimal
tool discovery, verified with representative tasks. This is a recommendation, not
a claim that implementation has started. No wholesale rewrite or additional group
of agents is required to begin.

## Review decisions and questions to investigate

Brand context is settled: always include it. Previous thread history and media
should ideally be discoverable. The other questions below remain open; they are
work for investigation and experiments, not choices Davi needs to make upfront.

- **Which tools are visible immediately?** We do not know yet. Decide which tools
  the agent needs often enough to show on every turn, and which it should find
  through `tool_search`. Start with the existing capabilities and test the split.
- **How does the agent call a tool after finding it?** Search only finds the
  function; something still has to execute it. We could expose the selected tool
  directly or use a controlled call that takes its name and arguments. The question
  is whether we need an Amp-like JavaScript execution tool at all. This is an
  implementation choice, not a request to remove Vanda's existing Python tool.
  Account ownership and permissions must still be checked on every operation.
- **When may Vanda schedule or publish?** For example, does "make a post" mean
  create a draft, or also put it on the calendar? Can a standing instruction allow
  automatic publication? The current prompt favors scheduling when immediate
  publication is ambiguous. We have not agreed to keep or change that policy.
- **How should Vanda make the artwork?** "Production method" means generating
  the whole post with an image model, generating a background and adding text/logo
  with Python, or using an approved template. Compare the results to learn which
  works best for each task; there is no selected winner yet.
- **Who checks the finished image, and when should it try again?** A "separate
  reviewer" means another model call or a subagent that sees the image and brief
  and looks for problems. It need not use a different model. The simpler starting
  point is for the creating agent to inspect its own result. Test whether a second
  reviewer improves quality enough to justify its extra time and cost; adding one
  is not a requirement. Also test when a correction helps rather than making the
  result worse.
- **Which model and prompt work best?** We have to find out through the fictional
  tasks and taste-based comparisons above, including consistency, cost, and wait
  time. Do not choose a winner from assumptions or one impressive output.

As work proceeds, add the experiment, what changed, the observed result, and the
decision here. Keep hypotheses distinct from measured or directly observed facts.

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

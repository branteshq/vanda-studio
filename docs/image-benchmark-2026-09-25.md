# Vanda: templates versus GPT Image 2.5

September 25, 2026. Exploratory live benchmark; fictional businesses; no publishing.

## Recommendation

**My quality pick for Vanda's new social artwork is raw Flare, provisionally.**
It produced the strongest initial café offer, instructional carousel and stationery
campaign in this set. Sunburst was competitive, cheaper in the measured first-pass
suite, and better at keeping the cosmetics bottle consistent. It was not a universal
quality upgrade over Flare. Neither model is dependable enough to skip final review.

**The larger win is complete-image generation over agent-adapted templates**, not
Flare over Sunburst. Raw generations integrated typography, illustration and product
photography more convincingly, with less agent work. Keep Python for approved layouts,
exact assets and deterministic edits, but do not confuse agent-written Python with
an already-tested deterministic renderer. The current Python revision also failed.

This is my non-blind visual assessment, not a human preference study or a statistical
claim about every Vanda workload. Actual files and failures are retained below.

## What ran

- **24 live trials**, **46 final image candidates**, including failed revisions;
  46 image-provider calls, including discarded attempts. All inference used the
  connected OpenAI/ChatGPT subscription. No OpenRouter inference or fallback.
- The real Vanda agent, tools, image transport and E2B Python execution ran headlessly
  against disposable `convex-test` databases. Each trial started with fresh business
  context and thread state. No deployed customer state or publishing was touched.
- Orchestrator: GPT-5.6 Terra, held fixed. Five new creative briefs across four
  fictional Brazilian businesses, plus one existing synthetic revision reference.
- Three primary arms: real Python templates (Flare assets allowed without text),
  complete-image Flare, complete-image Sunburst. Each arm ran all six cases.
- Main image setting: **requested `max`**, 4:5, normally `1024x1280` on the wire.
  Vanda production currently requests `high`; this benchmark changes only the test
  request. Two additional cases per raw model tested `high`. Each raw model also
  repeated the stationery carousel at `max`, with no prompt changes or selection
  of the best attempt.
- Exact Portuguese copy, prices, brand palettes and product facts were fixed across
  arms. Raw prompts specified hierarchy, exact quoted text and no extra copy. Later
  carousel slides used image references for visual identity. No Python repair or
  text overlay was permitted in the raw arms.
- Template traces really read scripts: repairs used C05 variants; other paths are
  preserved in `result.json`. The agent chose and adapted templates as it does in
  Vanda. This is **not** a benchmark of a human-designer-tuned, precompiled template
  renderer, which could have very different economics and quality.

The adapter sent the named models and recorded HTTP successes and token usage.
The endpoint did not echo model/snapshot identity; exact serving snapshots are not
independently confirmed. Returned sizes were not always requested sizes: many raw
PNGs were 1122×1402, one repeat output was 1092×1365. Template posts were 1080×1350.
Review sheets scale proportionally to approximately 352 pixels wide and composite
alpha over white; original PNGs are untouched.

## Matched first-run results

Cells show **end-to-end seconds / tracked API-equivalent USD**, including agent
orchestration and retries. These are not subscription invoices. Repeats and `high`
trials are excluded from this table, rather than pooled into the best result.

| Case | Templates/Python | Raw Flare max | Raw Sunburst max |
| --- | ---: | ---: | ---: |
| Repair-worker educational carousel, 3 slides | 194.00 / $0.601 | 152.59 / $0.306 | 152.18 / $0.265 |
| Café photographic offer, 1 slide | 131.99 / $0.396 | 71.77 / $0.159 | 71.61 / $0.124 |
| Cosmetics carousel, 3 slides | 181.67 / $0.651 | 110.63 / $0.213 | 122.51 / $0.222 |
| Stationery carousel, 3 slides | 178.39 / $0.552 | 141.64 / $0.217 | 145.94 / $0.200 |
| Dense service card, 1 slide | 143.74 / $0.296 | 105.93 / $0.180 | 81.95 / $0.138 |
| Background-only revision, separate task | 151.19 / $0.204 | 60.78 / $0.095 | 55.49 / $0.082 |

For the **same five new-creation briefs / 11 final slides per arm**:

| Measurement | Templates | Flare max | Sunburst max |
| --- | ---: | ---: | ---: |
| Median brief completion | 178.39 s | 110.63 s | 122.51 s |
| Image calls, including retries | 4 | 12 | 11 |
| Python runs / failed runs | 18 / 8 | 0 / 0 | 0 / 0 |
| Image-token API equivalent | $0.0722 | $0.5086 | $0.4157 |
| Tracked total API equivalent | $2.4970 | $1.0751 | $0.9485 |
| Total equivalent per final slide | $0.2270 | $0.0977 | $0.0862 |

Raw Flare's tracked total was **57% lower** than templates; Sunburst's was **62%
lower**. Median completion was approximately **38%** and **31%** shorter,
respectively. These are observed small-suite differences, not guaranteed savings.
Some arms overlapped in wall-clock time and shared subscription resources; this is
not a controlled provider-latency benchmark.

Python compute itself was tiny: only **$0.000605 estimated across the five creative
briefs**. The expensive component was agent reasoning, reading/adapting scripts and
repairing code. Failures included absent `/home/user/fonts/manifest.json` and a
newline substitution that produced invalid Python. These are current Vanda workflow
costs, not proof that template rendering is intrinsically expensive. No application
fixes were mixed into the experiment.

## Visual findings

| Workload | Observed result / my preference |
| --- | --- |
| Repair carousel | **Flare.** Clear, useful wall/anchor/weight illustrations and strong mobile hierarchy. Sunburst was also good. Python's diagram was much more abstract and its content smaller; a large decorative “03” on slide 1 made hierarchy less clear. |
| Café | **Flare.** Best integration of warm photography, headline and price. Sunburst and template versions were usable; template supporting copy was smaller and weaker against its background. |
| Cosmetics | **Sunburst.** Consistent amber dropper bottle across the series. Flare introduced a different short amber container on the soap slide; Python also changed bottle closure between slides. The blank cream labels were intentional to avoid duplicating required copy, not evidence of a real packaging identity test. |
| Stationery, original | **Flare.** Strongest integrated product illustration, color and type. Sunburst was also good. Python kept facts but looked generic, with simple stick-like pen drawings and stray decorative C-shaped marks. |
| Dense service card | **Sunburst high** was my best phone-readable result across quality settings; among max runs I preferred Flare's stronger supporting bands. Sunburst max had tiny footer text. Python placed a clock/icon over “Segunda a sexta”, a real overlap defect. All final versions retained the requested services, exclusions and prices on visual inspection. |
| Background revision | **None ready.** All three retained very low-contrast white text on cream; the brief itself creates that contrast conflict. Both raw models warned that their edit was not ready. Python claimed preservation but changed protected pixels. |

Inspect the complete comparisons:

- [Repairs](../.amp/in/artifacts/image-benchmark/bench-reparos-comparison.jpg)
- [Café, including high](../.amp/in/artifacts/image-benchmark/bench-cafe-comparison.jpg)
- [Cosmetics](../.amp/in/artifacts/image-benchmark/bench-cosmeticos-comparison.jpg)
- [Stationery, including repeats](../.amp/in/artifacts/image-benchmark/bench-papelaria-comparison.jpg)
- [Dense copy, including high](../.amp/in/artifacts/image-benchmark/bench-texto-denso-comparison.jpg)
- [Revision candidates](../.amp/in/artifacts/image-benchmark/bench-revisao-comparison.jpg)

### Repeats exposed failures that passing tests did not catch

The second stationery run was **not clean for either raw model**:

- **Flare:** five image calls, 229.17 seconds, $0.3734 equivalent. The final third
  slide omitted **“Kit Rabisco”** despite rendering the pens, price and CTA. This
  needs correction; the attractive appearance does not excuse missing copy.
- **Sunburst:** three image calls, 159.75 seconds, $0.2220 equivalent. The cover
  omitted **“Papelaria”** and returned extensive unintended transparency/glow rather
  than the intended solid purple campaign background. Only 3,088 of 1,573,044 cover
  pixels were fully opaque. The cover did not match the cleaner later slides.
- Both agents said they had reviewed the carousel and saved a draft. Structural
  tests passed because the expected slide count and inspection tool results existed.
  **Tool-based self-review did not reliably catch missing words.**

This is why my Flare recommendation is provisional, not “set it and forget it.”

### High versus max

| Case | Flare high | Flare max | Sunburst high | Sunburst max |
| --- | ---: | ---: | ---: | ---: |
| Café: seconds / equivalent | 64.91 / $0.0924 | 71.77 / $0.1593 | 59.99 / $0.1019 | 71.61 / $0.1238 |
| Dense card: seconds / equivalent | 163.98 / $0.2825 | 105.93 / $0.1797 | 110.99 / $0.1848 | 81.95 / $0.1378 |

Café generation used 744 output tokens at high versus 1,630 at max for both models.
But dense-copy high trials needed three Flare calls and two Sunburst calls, versus
two and one at max. Cheaper individual generations can yield a more expensive job.
Sunburst high's final dense-card layout was nevertheless more readable. These are
independent agent runs, not identical image prompts with a controlled quality-only
change; do not attribute every layout difference to the quality setting.

### Exact edits: keep the failures

Both raw models returned 1122×1402 images for a 1024×1280 reference, failing exact
preservation before per-pixel comparison. Python kept the dimensions but changed
**6,800 protected pixels**, primarily while attempting to recompose white text edges.
The purple pen deliberately shares the original background color, so a global color
replacement is not a valid solution. The agent also exceeded the requested two
correction rounds in the Python revision; that budget is guidance, not enforced.

No arm earned an exact-edit reliability claim. A tested mask/renderer is still the
appropriate engineering tool for this contract, but today's agent improvisation is
not that guarantee. Do not present “AI editing precision” as byte preservation.

## Cost accounting and provenance

- No pay-per-call image API/OpenRouter charges were initiated: inference used the
  subscription route. Vanda records zero image dollars there. Subscription monthly
  cost allocation, remaining quota and opportunity cost are **unknown**, not free.
- API-equivalent image value uses returned text/image input and output tokens at
  **$5 / $8 / $30 per million**, respectively. Image cache details were absent, so
  inputs are valued uncached. Both variants have the same published token rates;
  their actual per-request consumption can differ.
- Terra step usage is valued at **$2/M input, $0.20/M cached input, $12/M output**.
  Long-context premium is supported by the summarizer. The estimate includes traced
  agent steps and all recorded image retries, but not untraced background tasks,
  human fixes, publishing or the amortized cost of template design.
- Sandbox dollars use Vanda's duration-based estimate, not an E2B invoice. Do not
  treat the summed API-equivalent figure as actual subscription billing.
- Across all 24 runs, the tracked equivalent was **$6.1591**. Main first-run creative
  totals are the better apples-to-apples comparison; the overall figure includes
  unequal repeats, quality probes and failed revisions.
- [CSV measurements](../.amp/in/artifacts/image-benchmark/metrics.csv) and
  [JSON measurements](../.amp/in/artifacts/image-benchmark/metrics.json) list each run
  separately. `arm/timestamp/case/result.json` retains the exact user/system prompts,
  fixture hash, tool trace, generated code, usage, returned dimensions and final IDs.
  All intermediate stored PNGs and assertion failures remain in those directories.

## What I would ship next

1. Prefer complete-image **Flare** for new social creatives; retain Sunburst as a
   premium alternative for reference-heavy product work, not an assumed upgrade.
2. Keep `high` for uncomplicated drafts and test escalation to `max` on dense copy
   or repeated failures. This experiment alone does not justify switching every
   production image to max.
3. Make exact-copy completeness, unwanted alpha, actual dimensions and phone-scale
   readability explicit acceptance checks. The repeats show that “inspect_image
   happened” is insufficient.
4. Preserve Python/approved templates for fixed campaigns and precise edits. Fix
   template font provisioning and code adaptation before evaluating a tuned template
   engine against raw generation. Those fixes are outside this benchmark.

No production defaults were changed. Future evaluation should add more independent
autônomo categories (for example nutrition, beauty and fitness), real approved brand
assets, randomized blinded human review, and more repetitions. This set directly
covers local repairs and small-business retail, not every professional service.

## Research and verification

Read before designing the trials:

- [OpenAI introduction](https://openai.com/index/introducing-chatgpt-images-2-5/):
  Flare for everyday/social content; Sunburst for precision-focused visual work.
- [Image prompting](https://developers.openai.com/api/docs/guides/image-prompting):
  quote exact text, specify hierarchy, assign reference roles, preserve named details.
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation):
  high/xhigh/max, known text/layout/consistency limits and usage-based accounting.
- [Sunburst rate card](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
  and [Terra rate card](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

Verification: **21/24 live structural checks passed; all three strict revisions
failed and remain failures.** The 21 passes do not imply publishable visual quality.
Offline Vanda suite: **362 passed, 15 opt-in cases skipped**. Typecheck and targeted
Oxlint passed. Independent summarizer checks verified token-rate arithmetic, cache
discounting, sandbox aggregation and unknown-cost handling. All five template
creative traces were checked for actual script reads. Comparison images were visually
inspected, including repeats and non-default quality settings. `cargo check` was
attempted as required by repository guidance, but Cargo is unavailable in this
TypeScript checkout.

Replay commands: [evaluation README](../apps/vanda/evals/README.md).

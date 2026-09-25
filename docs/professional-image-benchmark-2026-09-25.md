# Can Vanda make editorial professional carousels using only image generation?

**Yes: this live trial produced convincing examples of the supplied style without
Python composition, template rendering, Canva, SVG, or text overlays.** The strongest
outputs are credible design drafts; dense small text and technical illustrations
still need review before real publication.

## The experiment

September 25, 2026. Six independent headless Vanda trials: three fictional
professionals × Flare/Sunburst at requested `max` quality. Each brief requested
exactly two vertical slides: an editorial portrait cover and an educational 2×2
diagram page, following the user's two attached ophthalmology references.

The actual Vanda agent used GPT-5.6 Terra to plan and call its real `paint` tool,
through the connected ChatGPT subscription. OpenRouter was blocked. Python execution
was disabled in this suite, and attempting it would fail the check. Each trial ran
in a fresh disposable database; nothing was published or deployed.

The briefs fixed Portuguese copy, brand colors, fictional identity and diagram
semantics. They explicitly prohibited copying the real reference doctor or clinic
identity. Each output includes “Estudo visual · profissional fictício”. These are
fictional demonstrations, not advertisements for real licensed professionals.

Both user references were passed as real image attachments to Vanda; hashes and
copies are retained with each result. Vanda sometimes passed those images directly
to `paint`, and sometimes translated them into a text art brief. This measures
Vanda's actual choices, not a fixed image-model prompt. All six agents read the
existing Instagram skill instructions, but none read a Python template script or
executed code to render artwork. Later slides used generated-image references.

## Outputs and measured cost

Each cell is **end-to-end seconds / tracked API-equivalent USD / image calls**.
The extra calls are retained corrections, not hidden attempts.

| Two-slide brief | Flare max | Sunburst max |
| --- | ---: | ---: |
| Ophthalmologist: retinitis pigmentosa | 145.97 / $0.254 / 2 | 131.42 / $0.221 / 2 |
| Civil engineer: understanding wall cracks | 192.23 / $0.351 / 3 | 138.88 / $0.275 / 2 |
| Dentist: gum health | 135.55 / $0.254 / 2 | 202.63 / $0.347 / 3 |

**12 final slides, 14 image calls, zero code runs.** Flare's tracked total was
$0.8584 and Sunburst's $0.8428. These value observed image and orchestration tokens
using the same published rate cards as the
[earlier benchmark](image-benchmark-2026-09-25.md#cost-accounting-and-provenance).
They are **not invoices or marginal subscription charges**. Quota depletion and
subscription allocation are unknown. No E2B rendering was used.

The adapter requested the named models; the endpoint did not echo their snapshots.
All 12 final PNGs were fully opaque. Actual dimensions were 1092×1365 or 1122×1402,
not the requested 1024×1280. The latter is approximately, not mathematically exactly,
4:5. No post-generation resizing or repair was applied to the delivered PNGs.

## What the images show

| Profession | Visual judgment |
| --- | --- |
| Ophthalmologist | **Both achieve the style.** Original female portrait, dark lower gradient, elegant serif headline and four coherent education panels. Flare resembles the reference's soft field diagrams more closely; Sunburst has a stronger brand lockup and a cleaner clinical page. The first three field openings narrow and the fourth is an individual-follow-up icon, not an inevitable blindness stage. I prefer Sunburst overall here. |
| Civil engineer | **Sunburst preferred.** Better-separated technical illustrations and a strong portrait. Both preserve the warning that a photo or crack width cannot establish cause/safety. Both agents made “FISSURAS EM PAREDES” the dominant cover headline rather than the smaller topic label seen in the reference; this is an adaptation, not an exact layout reproduction. Flare made one extra image edit to remove background lettering. |
| Dentist | **Flare preferred.** More restrained editorial composition than Sunburst's rounded cards and button treatment. Both include the named signs, care categories and consultation caveat. The floss drawings are simplified symbols, not precise technique demonstrations; have a dentist approve any instructional use. |

The principal shared limitation is **phone-scale supporting text**. The covers and
main headings read well around 360 pixels wide, but diagram captions, explanatory
paragraphs and fine print become small, especially near the bottom of slide 2.
The supplied reference has a similar density tradeoff. For a production carousel,
I would spread the educational content across another slide rather than squeeze
all of it into this two-slide format.

Native PNG inspection and targeted text spot-checks found the requested main names,
headlines, diagram labels and caveats. A suspected missing “r” in Flare's
“eletrorretinograma” was checked in an enlarged native crop and was **not** an error.
These are visual checks, not exhaustive OCR certification, clinical review or
professional-advertising compliance approval.

## Review the actual images

- [Selected examples: doctor and engineer from Sunburst, dentist from Flare](../.amp/in/artifacts/professional-benchmark/selected-examples.jpg)
- [Ophthalmologist: both models, both slides](../.amp/in/artifacts/professional-benchmark/pro-oftalmologista-comparison.jpg)
- [Civil engineer: both models, both slides](../.amp/in/artifacts/professional-benchmark/pro-engenheiro-comparison.jpg)
- [Dentist: both models, both slides](../.amp/in/artifacts/professional-benchmark/pro-dentista-comparison.jpg)
- [All 12 unaltered original PNGs](../.amp/in/artifacts/professional-benchmark/generated-carousels.zip)
- [Per-run CSV](../.amp/in/artifacts/professional-benchmark/metrics.csv)

Comparison sheets resize/composite for review only; no code-added lettering or
retouching is present in the original delivered artwork. The selected sheet is an
illustrative selection, not a replacement for the complete comparison. All final
and intermediate generated PNGs remain in the trial directories alongside prompts,
tool traces, usage and reference hashes.

## Conclusion and limits

**Canva and Python are not prerequisites for this visual style.** The key inputs
were a clear art reference, fixed copy, a defined brand and deliberate page structure.
The image models handled the portraits, gradients, lettering and diagrams together.

This batch does **not** establish a universal winner: I prefer Sunburst for two
briefs and Flare for one. It also does not establish reliability over repeated runs,
editable text layers, exact font/hex matching, real-person likeness preservation,
or exact logo reproduction. Every portrait is invented. Real customer work needs
their approved photo/logo and a separate identity-preservation test.

Verification: **6/6 live structural checks passed**, including two-slide draft
creation, image inspection results, zero attempted Python calls and selected-model
provenance for every final image. All recorded network calls were successful requests
to `chatgpt.com`. Reference hashes matched; no subscription credentials appeared in
result files. **362 offline tests passed**, 15 opt-in cases skipped; TypeScript and
targeted Oxlint passed. `cargo check` was attempted but Cargo is unavailable. No
application defaults changed.

Replay: [evaluation README](../apps/vanda/evals/README.md#reference-led-professional-carousels-images-only).
Medical copy references: [MedlinePlus](https://medlineplus.gov/genetics/condition/retinitis-pigmentosa/)
and [NIDCR](https://www.nidcr.nih.gov/health-info/gum-disease).

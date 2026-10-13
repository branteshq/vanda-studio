# Vanda skills

Each child directory is an [Agent Skills](https://agentskills.io/specification) package with a required `SKILL.md`. Text references, scripts, assets, and license files may live beside it.

The deployment does not read the filesystem at runtime. `pnpm skills:build` validates these packages and generates `src/convex/skills/generated.ts`, which Convex bundles with the agent.

To install a skill:

1. Add `<name>/SKILL.md` and its text resources.
2. Add the skill to `registry.json` with its source URL.
3. Set `alwaysApply` only when the full instructions must enter every Vanda turn.
4. Run `pnpm skills:build`.

Builds and type checks run `skills:check`, so stale generated output fails CI.

## Post skills: `post`, `design`, `copy`

A post is made by three skills, each doing one job and covering all of it. Vanda reads the three `SKILL.md` files before the first `paint` of a new post; the system prompt and `post` both point at them.

- `posts/post`: production. Type, purpose, format, references, real people, the order of work and `create_post`. Its other files are read only when the post needs them: `purposes.md` (the 14 purposes, one `## <id>` entry each), `carousel.md`, `infinite-carousel.md`, `story.md`, and `formats.md` with `formats/<name>.md`, one file per ad format.
- `design`: art direction for every image Vanda paints. Adapted from Anthropic's `frontend-design` (Apache-2.0, `LICENSE.txt`) for images instead of web pages: start from the client's subject, identity stays and execution improves (the brand file's `Manter` and `Evoluir`), a plan reviewed against the brief before painting, a concrete paint prompt, the tells of generated images, boldness in one place, and the pixel critique.
- `copy`: every word Vanda publishes: captions, text on the image, carousel slides, hooks, awareness-level headlines and the tells of generated text. Adapted from `coreyhaines31/marketingskills` (MIT, `LICENSE`); `ai-tells.md` is that repo's list copied unchanged, so upstream updates can be pulled as they are.

Keep each `SKILL.md` under 7.5 KB (`postPurposes.test.ts`).

### Ad formats (`posts/post/formats/*.md`)

A format file tells Vanda how one ad format or visual style looks. Vanda reads it after `SKILL.md` and writes one `paint` prompt from it, so the file is only as good as the prompt it produces. Live runs showed what separates a format that matches its reference from one that drifts into a generic template:

1. **It is found.** The heading is `# Formato de anúncio: <título>`, in the words owners use, and its row in `formats.md` lists the owner's words and aliases. Vanda's system prompt lists every title, so she recognizes "massinha" or "tier list" and opens the file.
2. **It carries a prompt-base.** One English paragraph of concrete art direction (subject, camera, light, materials, depth, finish, "no arbitrary text"), with `[CAMPOS]` Vanda fills from the brand file and the request. Without it Vanda writes a generic Portuguese brief and the format's look is lost.
3. **The hero adapts to the business.** The format never assumes a can or a bottle; it lists how its signature elements change per kind of business and uses `[HERO]` and `[... FROM THE HERO'S WORLD]` fields. The shared hero rules (owner's photo in `referenceImageIds`, real people only from their own photo) live once in `formats.md`.
4. **Text follows the format.** Key visuals carry no added text. Formats made of text (notes, chats, tier lists) list exact slots with word limits.
5. **Review is observable.** `Revisão` starts with `Reprove e corrija com editOfImageId se:` and lists failures you can see in pixels, taken from real runs.
6. **Guards and purpose stay short.** `Evite` and `Fatos necessários` forbid invented facts; `Propósito comum` uses `create_post` purpose ids only.

Test a format through Vanda, not by reading it: a real turn with the brand file and a product photo, checking that the format file was read, that the `paint` prompt starts with the prompt-base, and the pixels against the reference.

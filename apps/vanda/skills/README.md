# Vanda skills

Each child directory is an [Agent Skills](https://agentskills.io/specification) package with a required `SKILL.md`. Text references, scripts, assets, and license files may live beside it.

The deployment does not read the filesystem at runtime. `pnpm skills:build` validates these packages and generates `src/convex/skills/generated.ts`, which Convex bundles with the agent.

To install a skill:

1. Add `<name>/SKILL.md` and its text resources.
2. Add the skill to `registry.json` with its source URL.
3. Set `alwaysApply` only when the full instructions must enter every Vanda turn.
4. Run `pnpm skills:build`.

Builds and type checks run `skills:check`, so stale generated output fails CI.

## Visual format skills (`posts/ads/post-ad-*`)

A format skill tells Vanda how one ad format or visual style looks. Vanda reads it after `post-production` and writes one `paint` prompt from it, so the skill is only as good as the prompt it produces. Live runs showed what separates a skill that matches its reference from one that drifts into a generic template:

1. **It is found.** The `name` uses the words owners say, in Portuguese when they say it in Portuguese (`post-ad-iridescente`, not `iridescent`); multiword names match as a phrase. The `description` starts with `Formato de anúncio <título> —`, lists the owner's words and aliases, and avoids words every post skill shares (produto, promoção, desconto, carrossel, propósito, post, imagem, cupom).
2. **It carries a prompt-base.** One English paragraph of concrete art direction (subject, camera, light, materials, depth, finish, "no arbitrary text"), with `[CAMPOS]` Vanda fills from the brand file and the request. The skill tells Vanda to start the `paint` prompt with it. Without it Vanda writes a generic Portuguese brief and the format's look is lost.
3. **The hero adapts to the business.** The format never assumes a can or a bottle. The skill names the hero as whatever represents the offer in this post (product, dish, person, place, or a physical stand-in for a service) and lists how the format's signature elements change per kind of business (a splash of juice for drinks, sparks and parts for repairs, paper and light in the brand colour for finance). The prompt-base uses `[HERO]` and `[... FROM THE HERO'S WORLD]` fields instead of product words like label or packaging. The owner's photo goes in `referenceImageIds` and Vanda generates a new image; `editOfImageId` only fixes the piece Vanda generated. Real people only from their own photo.
4. **Text follows the format.** Key visuals carry no added text: the label signs the piece. Formats made of text (notes, chats, tier lists) list exact slots with word limits and which is biggest. No title bands added "for safety".
5. **Review is observable.** `Revisão` starts with `Reprove e corrija com editOfImageId se:` and lists failures you can see in pixels, taken from real runs.
6. **Guards and purpose stay short.** `Evite` and `Fatos necessários` forbid invented facts (reviews, data, offers, ingredients) and point to the brand file; `Propósito comum` uses `create_post` purpose ids only.

Test a format skill through Vanda, not by reading it: a real turn with the brand file and a product photo, checking that `tool_search` returned the skill, that it was read, that the `paint` prompt starts with the prompt-base, and the pixels against the reference.

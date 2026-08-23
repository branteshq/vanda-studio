# Vanda skills

Each child directory is an [Agent Skills](https://agentskills.io/specification) package with a required `SKILL.md`. Text references, scripts, assets, and license files may live beside it.

The deployment does not read the filesystem at runtime. `pnpm skills:build` validates these packages and generates `src/convex/skills/generated.ts`, which Convex bundles with the agent.

To install a skill:

1. Add `<name>/SKILL.md` and its text resources.
2. Add the skill to `registry.json` with its source URL.
3. Set `alwaysApply` only when the full instructions must enter every Vanda turn.
4. Run `pnpm skills:build`.

Builds and type checks run `skills:check`, so stale generated output fails CI.

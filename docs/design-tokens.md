# Design tokens

**Single source of truth: [`packages/ui/src/styles/globals.css`](../packages/ui/src/styles/globals.css).**
Dark is the native mode (`<html class="dark">`); light is the derived pair. Author
UI against the tokens below — **never** hardcode hex/rgb/oklch or gradients in
markup. `pnpm lint` runs the guard (`scripts/check-tokens.mjs`) that fails the
build on raw color, so this isn't a guideline you can forget.

## The vocabulary

Every token is both a CSS variable (`var(--surface)`) and a Tailwind utility
(`bg-surface`). Use the utility in markup.

| Group                         | Tokens                                       | Utility examples                                                   |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Surfaces                      | `--app --surface --sidebar --inset`          | `bg-app` `bg-surface` `bg-inset`                                   |
| Borders                       | `--border --border-strong`                   | `border-border` `border-border-strong`                             |
| Text (1→6, primary→metadata)  | `--text --text-2 … --text-6`                 | `text-text` `text-text-3` `text-text-5`                            |
| Brand (magenta, constant)     | `--brand-accent --brand-soft`                | `bg-brand-accent` `text-brand-accent`                              |
| Status (each = a state)       | `--green --amber --peri`                     | `text-green` `text-amber` `text-peri`                              |
| Status surfaces               | `--needs-bg/-border` `--creating-bg/-border` | `bg-needs-bg` `bg-creating-bg`                                     |
| Radii (chip·btn·card·lg·pill) | `7 · 9 · 12 · 16 · ∞`                        | `rounded-sm` `rounded-md` `rounded-lg` `rounded-xl` `rounded-full` |
| Elevation                     | `--shadow-sm --shadow --shadow-lg`           | `shadow-sm` `shadow`                                               |
| Motion                        | `--ease-out --ease-in-out`                   | `ease-out`                                                         |

shadcn names (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`,
`bg-card`, `bg-accent`, …) still work — they're mapped onto the tokens above, so
vendored components stay consistent. `text-foreground` = `--text`; `bg-primary` =
`--brand-accent`.

## Compose through components

Recurring patterns are components, not ad-hoc classes — import from
`@vanda-studio/ui/components/*`:

| Component                                                             | Use                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Button` (`variant` brand·outline·ghost·subtle·soft·destructive·link) | actions; **solid brand, never gradient**; presses with `scale(0.97)` |
| `StatusPill` (`tone` live·needs·creating·suggestion·scheduled·done)   | item/stage state                                                     |
| `Tag` (`tone` signal·neutral·brand)                                   | signal categories, trends, counts (periwinkle)                       |
| `StatusRing` (`state` done·active·pending)                            | Linear-style step rings                                              |
| `Card` (`variant` base·inset·needs·creating)                          | suggestion/plan cards                                                |
| `Toggle`                                                              | on/off (auto vs manual, etc.)                                        |

## Rules

- **Tokens only.** No `bg-[#…]`, no `linear-gradient(…)`, no `style={{ color: "#…" }}`.
  The orchid mark (`orchid-aperture.tsx`, `vanda-mark.tsx`) is the one allowed
  gradient — it's the brand.
- **Magenta is the only brand color.** Green/amber/periwinkle only ever carry
  state. Never purple (that's Linear, not Vanda).
- **Depth from the border**, not shadow (dark mode). Shadow only on floating
  layers (drawer, popover).
- **Mono labels** (`font-mono`) are uppercase, wide tracking, `text-text-5`.
- North star: Linear — calm, dense-but-quiet, little chrome. Less noise, more signal.

## Lint enforcement

`pnpm lint` runs all six `@shadcn/lint` rules as errors, plus the gradient/color
guard. Contracts live in `.oxlintrc.json`; do not disable rules to make a screen pass.

- App code may position components with layout classes. Appearance belongs in
  shared variants (`Button.variant`, `Input.variant`, `Avatar.size`, etc.).
- Skeletons accept shape/layout, spinners accept color/layout, and the listed
  layout containers accept spacing. These are explicit component contracts,
  not permission to restyle every control.
- Shared component implementations own their styling categories. They still
  enforce token colors, known/static classes, no arbitrary values, and no inline
  CSS properties. Prefer Tailwind v4 numeric scales and the existing type tokens.
- Runtime data (brand swatches, aspect ratios, progress) goes through typed CSS
  custom properties consumed by static classes, not dynamically built class names.
- Brand artwork uses the fixed `orchid-*` theme colors. SVG fills/strokes are
  checked too; a `token-guard-ignore` comment does not bypass the shadcn rules.
- The UI package declares Tailwind and animation CSS dependencies so lint resolves
  its actual theme instead of silently falling back to a bundled grammar.

After UI changes, run `pnpm lint` and fix all errors. The design-contract test
checks that every rule rejects an invalid fixture and accepts approved composition.

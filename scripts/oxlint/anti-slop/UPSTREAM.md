# Anti-slop provenance

- Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).
- Revision: [c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b](https://github.com/dmmulroy/anti-slop/commit/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b).
- Source assets: `skills/install-anti-slop/assets/anti-slop/`.
- Installed entry points: `scripts/oxlint/anti-slop/index.ts` and `scripts/oxlint/anti-slop/effect/index.ts`.
- Installed with `.agents/skills/install-anti-slop/scripts/install.mjs`; the installed skill was compared against the revision's archive and matched exactly.
- Intentional deviations: this provenance file and the root MIT license were added; plugin source is unchanged. Nested ESLint Stylistic license and provenance are preserved.

## Repository integration

`.oxlintrc.json` enables all 18 generic rules, all five Effect rules, and the native `oxc/no-accumulating-spread` companion at error severity. `pnpm lint` and `pnpm lint:fix` load these plugins, and the existing CI lint step enforces them. Oxlint and `@oxlint/plugins` are pinned together at 1.70.0.

Agent assets and the vendored plugin are excluded from lint. Existing application findings are not suppressed or migrated by this installation.

The Effect service-import rule covers relative project imports, not package-alias imports.

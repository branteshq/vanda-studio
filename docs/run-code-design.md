# run_code — deterministic compute primitive

**Status:** design · **Owner:** vanda agent tools · **Depends on:** E2B (vendor), existing paint pipeline

## 1. Purpose

`run_code` gives Vanda a deterministic counterpart to `paint`: agent-authored Python
(Pillow/numpy) executed in an isolated sandbox against account-owned images, with outputs
saved back to the gallery through the same path painted images take.

What it unlocks, all from one tool:

- Text overlays, logo compositing, brand-color grading — pixel-exact, no generative typos.
- Crops, resizes, borders, collages, format conversions.
- Templates (v2): a script + assets applied to photo #500 exactly like photo #1.
- Zero-COGS edits: ~$0.0004/run vs cents per generation.

The routing rule the agent follows: **generative change → paint; deterministic
composition → run_code.** The model makes the photo; code puts the brand on top of it.

Non-goals for v1: persistent REPL state across calls, non-image workloads (analytics,
video), user-visible template library, network access of any kind inside the sandbox.

## 2. Trust model

```
Convex "use node" action (trusted: holds ctx, storage, secrets)
  ├── resolve + fetch input image bytes (identity wall in a query, same as paint)
  ├── E2B Firecracker sandbox (untrusted: agent code, no secrets, no network)
  │     /home/user/in/   ← input images + meta.json     (we write)
  │     /home/user/out/  ← produced images              (code writes)
  └── validate outputs → Convex storage → images rows
```

Invariants:

- The sandbox receives **only** files derived from images the account owns. No env vars,
  no API keys, no Convex URLs, no other tenants' data.
- Internet access is **disabled** at sandbox creation (`allowInternetAccess: false` —
  verify exact flag name against the pinned SDK version at build time). Worst case for
  malicious generated code is mangling the user's own pixels.
- Outputs are untrusted bytes: re-validated with `sniffDimensions` (already in
  `images.ts`), capped in count/pixels/bytes before touching storage.
- Every run is recorded (code, stdout, status) in a `codeRuns` table — auditable, and
  the seed for templates later.

## 3. Agent-facing tool contract

Registered in `vanda.ts` as `run_code`, next to `paint`.

```ts
inputSchema: z.object({
  // Python 3 source. Pillow + numpy available. Reads /home/user/in, writes /home/user/out.
  code: z.string(),
  // Short human description of what the code does — shown in the chat UI and stored
  // as the output images' prompt. Written in the brand's voice, PT-BR.
  description: z.string(),
  // Gallery images materialized as input files, in order. Attached uploads, painted
  // images, and reference photos all qualify (account ownership is the only gate).
  inputImageIds: z.array(z.string()).max(10).optional(),
});
```

Return value to the agent:

```ts
{
  ok: boolean,
  stdout: string,          // truncated to 8 KB, tail preserved
  stderr: string,          // truncated to 8 KB — tracebacks land here; the agent
                           // is expected to read them, fix the code, and retry
  images: Array<{ imageId, name, width, height }>,
}
```

Python exceptions are **not** tool errors: they return `ok: false` with the traceback in
`stderr`. This keeps the self-correction loop (run → read traceback → fix → rerun) inside
the turn instead of surfacing as a failed tool call. Infra failures (sandbox provisioning,
timeout, output validation) throw normally.

### Filesystem contract inside the sandbox

- Inputs are **workspace paths** (`inputPaths`: `/images/…`, `/brand/references/…`,
  `/projects/<p>/renders/NN`) or bare imageIds (attachments). Each materializes at its
  workspace mirror path under `/home/user` — the path the agent read in conversation is
  the path its Python opens. Bare ids land at their canonical `/images` or
  `/brand/references` path.
- `/home/user/meta.json` — one entry per input with `path`, `kind` and image/text metadata.
- `/home/user/out/` — PNG/JPEG files are validated and ingested into the gallery; JSON,
  CSV, Markdown and text are UTF-8 validated, capped at 1 MB and projected under
  `/runs/<run>/outputs/`. The image filename becomes its gallery name.

## 4. Execution environment

Custom E2B template **`vanda-imaging`**, defined and built by
`apps/vanda/e2b/vanda-imaging/build.mjs` (E2B's v2 SDK cloud build — no local Docker;
`E2B_API_KEY=... node build.mjs` to rebuild). The base image's runCode server must be
booted explicitly via `setStartCmd("sudo /root/.jupyter/start-up.sh", waitForPort(49999))`:

- Code-interpreter base + `pillow`, `numpy`, `pandas`, `matplotlib`, `scikit-learn`.
- Font pack installed system-wide (deterministic text needs fonts _in the image_):
  Inter, Poppins, Montserrat, Lora, Playfair Display, Roboto + DejaVu fallback, with an
  `/home/user/fonts/manifest.json` listing family → path so code never guesses paths.
- No network. No preinstalled credentials. Nothing account-specific baked in — account
  files arrive per-run.

Runtime budget per run:

| knob              | value         | rationale                                                              |
| ----------------- | ------------- | ---------------------------------------------------------------------- |
| sandbox spec      | 2 vCPU / 2 GB | Pillow on 4K inputs fits comfortably; matches E2B default billing tier |
| `runCode` timeout | 30 s          | any legit Pillow job finishes in single-digit seconds                  |
| sandbox TTL       | 60 s          | backstop if the action dies mid-run; E2B reaps it                      |
| cost/run          | ~$0.0004      | (2 vCPU + 2 GiB) × ~10 s at E2B per-second rates                       |

## 5. Convex orchestration

New file `convex/codeRuns.ts` (`"use node"`), one internalAction `run`:

1. `resolveCodeRunInput` enforces account ownership for images and resolves text through
   the account-chrooted workspace. Insert the `codeRuns` row (`status: "running"`).
2. Fetch image bytes and materialize workspace text in the action; create the sandbox and
   write inputs + `meta.json` at their mirror paths.
3. `runCode(code, { timeoutMs: 30_000 })`; capture stdout/stderr.
4. List `/home/user/out`; read at most 10 allowed files and enforce byte/pixel/text caps.
5. Store image blobs through `savePaintedImage`; store structured text in
   `codeRunArtifacts`, projected under the run's `outputs/` directory.
6. Patch the `codeRuns` row (`status`, truncated stdout/stderr, `durationMs`,
   `imageIds`). `finally: sandbox.kill()`.

### Schema additions

```ts
codeRuns: defineTable({
  accountId: v.id("accounts"),
  threadId: v.optional(v.string()),
  code: v.string(),
  description: v.string(),
  status: v.union(v.literal("running"), v.literal("ok"), v.literal("failed")),
  stdout: v.optional(v.string()), // truncated to 8 KB
  stderr: v.optional(v.string()), // truncated to 8 KB
  error: v.optional(v.string()), // infra errors only
  durationMs: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  imageIds: v.optional(v.array(v.id("images"))),
  createdAt: v.number(),
}).index("by_account", ["accountId", "createdAt"]);
```

`images` gains one optional field: `codeRunId: v.optional(v.id("codeRuns"))`. Origin stays
`"generated"` — code-produced images are generated assets; the lightbox distinguishes them
by `model: "python/pillow"`.

No gallery placeholders in v1: runs finish in seconds, and pre-inserting rows would need
output-count knowledge we don't have until the code runs. Revisit only if runs feel slow.

## 6. Cancellation

Identical to paint's cooperative stop (`images.ts`):

- When `threadId` is present, poll `internal.chat.threadHasActivity` every 2.5 s; on
  stop, `sandbox.kill()` and abort.
- Re-check activity after the run, before saving outputs — never save results the owner
  walked away from.
- `runCode` timeout + sandbox TTL are the non-cooperative backstops.

## 7. Limits & failure modes

| failure                       | surfaced as                                               |
| ----------------------------- | --------------------------------------------------------- |
| Python exception              | `ok: false`, traceback in `stderr` — agent self-corrects  |
| timeout (30 s)                | `ok: false`, `stderr: "tempo de execução excedido (30s)"` |
| no outputs, no stdout         | `ok: true`, agent told nothing was produced               |
| output too big / not an image | file skipped, noted in returned `stderr`                  |
| sandbox provisioning error    | tool error (thrown) — infra, not the agent's fault        |
| per-account rate limit        | tool error: "muitas execuções, aguarde"                   |

Rate limiting: max **20 runs / 5 min / account** (mutation-side counter on `codeRuns`)
plus a global concurrency guard sized to the E2B plan (free tier: 20 concurrent
sandboxes). Both are cheap inserts-and-counts on the new table.

## 8. Agent guidance (prompt surface)

Tool description (registered on `run_code`, PT-BR like the rest):

> Executa código Python (Pillow/numpy) num sandbox isolado para editar imagens de forma
> **determinística**: sobrepor texto, aplicar logo, cortar, redimensionar, montar
> colagens, aplicar cores da marca. Imagens de entrada vão em `inputImageIds` e aparecem
> em `/home/user/in/` (veja `meta.json`); salve os resultados em `/home/user/out/` — o
> nome do arquivo vira o nome na galeria. Fontes instaladas estão em
> `/home/user/fonts/manifest.json`. Sem acesso à internet. Se o código falhar, o
> traceback volta em `stderr`: corrija e rode de novo.

Addition to `INSTRUCTIONS` (routing rule, mirrors the paint block):

> - Edição de imagem — regra de roteamento: mudança **generativa** (trocar fundo,
>   cenário, roupa, criar do zero) → `paint`. Composição **determinística** (texto sobre
>   a imagem, logo, corte, redimensionar, colagem, moldura, cor da marca) → `run_code`.
>   Texto renderizado por modelo generativo erra; texto composto por código não erra.
>   `run_code` é quase gratuito — prefira-o sempre que o resultado precisar ser exato.

## 9. Chat & gallery UX

- Tool call in the thread renders as a collapsed code block (description as its label)
  with the breathing-dot loader while running; expandable to see code + stdout.
- Output images render through the existing `PaintedImage` component (gallery.get
  subscription) — tombstones, hover kit, and lightbox work with zero new code.
- Lightbox: `model` renders as "Pillow (código)"; the prompt box shows `description`
  with the Vanda mark (promptAuthor is "vanda"). Showing the actual code behind a
  toggle is a v2 nicety.

## 10. Rollout

1. E2B account; `E2B_API_KEY` env var on the Convex deployment (next to
   `OPENROUTER_API_KEY`). Pin `@e2b/code-interpreter`.
2. Build + push the `vanda-imaging` template; verify at build time: internet-off flag
   name, binary `files.read`, `runCode` timeout option — the three SDK details this doc
   assumes.
3. Schema + `resolveCodeRunInput` + `codeRuns.ts` action, with boundary tests mirroring
   `imagesData.boundary.test.ts` (ownership wall, rate limit, output caps).
4. Register the tool + instructions block in `vanda.ts`.
5. Chat rendering (code block + outputs), manual E2E: text overlay on an uploaded photo,
   a two-image collage, a deliberate traceback → self-correction.

## 11. v2 direction (explicitly out of scope now)

- **Templates:** promote a successful `codeRuns` row to a named script stored in the
  account's brand kit; "aplica o template promo na foto X" becomes a cheap re-run.
- **Brand kit mounts:** `/home/user/brand/` (logo, colors.json, fonts) alongside `in/` —
  first concrete step toward the account-as-workspace substrate.
- **Per-thread sessions:** keep one sandbox alive per thread for REPL-style iteration
  (E2B supports long TTLs); only worth it once runs chain often enough that per-run
  boot + upload dominates.

# workspace — the account as a virtual filesystem

**Status:** implemented (reads + v1 writes) · **Depends on:** existing tables + `workspaceFiles`

## 1. Purpose

Give the agent two generic tools — `list(path)` and `read(path)` — over a per-account
virtual filesystem, replacing the six bespoke reader tools (`get_brand_memory`,
`list_reference_photos`, `list_opportunities`, `get_market_status`, `list_projects`,
`get_project`). The extensibility contract inverts: **new feature = new file in a mount;
a new tool is the exception that needs justification.** Agent Skills use the same contract:
the system prompt discloses their catalog, and `read` loads `/skills/<name>/SKILL.md` or
one of its resources only when needed.

First principles:

- **Editorial projection, not a database mirror.** Domain tables are exposed through
  curated mounts. Each file is a view rendered on read (like `/proc`), each mount is an
  API contract. Internal pipeline artifacts never leak into the namespace.
- **One write surface, per-mount handlers (the VFS shape).** `write(path, content)` is
  the only write tool, forever — dispatch lives in the resolver, not in the model's tool
  selection (like Linux: one `write()` syscall, per-driver handlers; writable `/proc`
  files parse input per-file). v1 handlers cover the files that ARE the data —
  `/memory/*.md` (free), `/templates/*.py` (free), `/brand/notes.md` (owner-approval,
  via `needsApproval` as a function of the path). Projections stay read-only: a refused
  write returns the verb that changes that state (`revise_slide`, `paint`,
  `publish_project`…) — errors as navigation, applied to writes. New writable targets
  are new handlers behind the same tool, never new tools; a projection can later gain a
  true inverse (e.g. `caption.md` parse → document edit) without touching the surface.
  Every write upserts the head in `workspaceFiles` and appends to
  `workspaceFileRevisions` (audit trail / undo). `/memory` is NOT auto-injected into the
  system prompt — the agent reads what it needs, keeping a poisoned note inspectable.
- **Multimodal read (v1).** Reading an image path returns a metadata header AND the
  pixels — the model sees the image. Tool results carry image parts by URL:
  `createTool.toModelOutput` → AI SDK `ToolResultOutput {type:'content'}` with a file
  part → OpenRouter provider maps to `image_url` in the tool message. Verified through
  all three layers. The transcript stores compact JSON; only the model sees pixels.

## 2. The namespace

```
/
├── brand/
│   ├── memory.md              ← confirmed brandCanon + readiness, rendered as prose
│   ├── profile.json           ← handle, mode, kind, readiness
│   ├── notes.md               ← WRITABLE (owner approval): free-form brand notes
│   ├── kit.json               ← WRITABLE (owner approval): visual identity — exact
│   │                            colors/fonts/tagline; writes are schema-validated and
│   │                            normalized (the first per-target write parser)
│   └── references/
│       └── rosto-ana-8xk2.jpg ← read = header (imageId, kind, autorização) + pixels
├── memory/                    ← WRITABLE (free): durable agent notes — owner
│   └── preferencias.md          preferences, plans, learnings across conversations
├── templates/                 ← WRITABLE (free): reusable Python for run_code
│   └── moldura-branca.py
├── skills/                    ← installed Agent Skills packages, read-only
│   └── unslop/
│       ├── SKILL.md
│       └── LICENSE
├── images/                    ← gallery (non-reference images), newest first, cap 100
│   └── promo-agosto-bvn9.jpg  ← read = header (prompt, model, custo, dims, imageId) + pixels
├── instagram/                 ← normalized provider observations + provenance
│   ├── self/profile.json · posts.json · insights.json
│   ├── public/cafe-vizinho/profile.json · posts.json
│   ├── posts/ABC123/post.json · comments.json · insights.json
│   └── searches/cafeterias-pinheiros.json
├── projects/
│   └── cafe-gelado-3kb2/
│       ├── status.json        ← stage, review, publication state
│       ├── brief.json         ← briefSnapshotJson, when present
│       ├── slides.md          ← active carouselDocument rendered (slideIds inline)
│       ├── caption.md
│       └── renders/01.jpg …   ← read = pixels (visual audit before publishing)
├── market/
│   ├── opportunities/
│   │   └── cafe-gelado-viral-9dk2.md  ← evidence, trigger, adaptation, join ids
│   ├── creators.json
│   └── last-scan.json
└── runs/
    └── comparar-perfis-vgpe/
        ├── run.json           ← code, stdout/stderr, images and artifacts
        └── outputs/
            ├── ranking.json
            └── benchmark.csv
```

- Markdown for prose-shaped views (model reads them as language), JSON for structured
  state. Rendering is deterministic: stable ordering, no volatile fields.
- **No sidecar files.** Listings carry a one-line summary per entry (dims, origin,
  model, truncated prompt, the entity id); deep metadata arrives with the read.
- Listings are capped (100 entries) with an explicit truncation note — no silent caps.

## 3. Path stability: slug + id suffix

Entity names are `slug(title)-<last 6 chars of Convex id>`: `cafe-gelado-3kb2xq`.
**The resolver matches on the id suffix alone; the slug is decoration.** Renames refresh
listings but never break a previously seen path; collisions are impossible; a bare id
also resolves. This is what lets a filesystem metaphor survive renameable entities.

**Errors are navigation.** A failed resolution never returns a bare "not found" — it
returns the listing of the nearest existing directory, so the model self-corrects in one
step (same philosophy as run_code returning tracebacks).

## 4. Architecture

```
convex/workspace/
├── types.ts        WorkspaceEntry / WorkspaceFile / WorkspaceMount (list/read/write?)
├── documents.ts    workspaceFiles store: save/read/list + documentMount factory
├── mounts/         brand · memory · templates · skills · images · instagram · posts · market · runs
└── index.ts        registry, path parsing, writePath, writeNeedsApproval

convex/workspaceData.ts   internalQuery list / read + internalMutation write
vanda.ts                  tools `list`, `read`, `write` (pi-shaped)
```

- Mounts are pure functions of `(QueryCtx, accountId, segments)`. The account is the
  chroot root injected by the tool layer — cross-account paths are structurally
  impossible, not merely checked.
- `read(path, offset?, limit?)` paginates text files pi-style (1-indexed lines,
  truncation note). Image reads ignore offset/limit.
- Image files resolve their storage URL in the query; the tool's `toModelOutput` emits
  `[{type:'text', header}, {type:'file', data:{type:'url'}, mediaType}]`.
- Cost guardrail lives in the tool description, not a separate `look()` tool: reading an
  image sends pixels (~1–2k vision tokens after provider downscale); scan listings first.

## 5. Tool surface (registered in vanda.ts)

- `list(path)` — directory listing with summaries. Root `/` lists the mounts.
- `read(path, offset?, limit?)` — text content, or header + pixels for images.
- `write(path, content)` — full-content write into the writable files;
  `needsApproval` computed from the path (only `/brand/notes.md` in v1). Listings mark
  writable files (`gravável` / `gravável com aprovação`).

Named `list`/`read` (pi-style) betting on the model's filesystem training transferring.
Retired at the same time: the six reader tools; INSTRUCTIONS rewritten to describe the
workspace and reference paths (`/brand/references`) instead of tool names.

## 6. Interaction with run_code (phase 3 — implemented)

run_code takes `inputPaths`: any text file visible through the account workspace or an
account-owned image path/bare attachment imageId. Each input materializes at its
workspace mirror path under `/home/user` — the path Vanda reads in conversation is the
path her Python opens. `/home/user/meta.json` records each input's kind and metadata.
This lets offline Python analyze `/instagram` JSON without receiving provider credentials
or internet access. PNG/JPEG outputs enter the gallery; JSON, CSV, Markdown and text
outputs are stored under `/runs/<run>/outputs/`. `paint` still speaks imageIds.

## 7. Testing

Boundary tests per mount: ownership wall (foreign account's entities invisible and
unresolvable), suffix resolution (stale slug still resolves; bare suffix resolves),
errors-as-navigation (miss returns nearest listing), deterministic renders (golden
assertions on memory.md / slides.md shape), listing caps.

# workspace — the account as a read-only virtual filesystem

**Status:** design (agreed) · **Depends on:** nothing new — pure projection over existing tables

## 1. Purpose

Give the agent two generic tools — `list(path)` and `read(path)` — over a per-account
virtual filesystem, replacing the six bespoke reader tools (`get_brand_memory`,
`list_reference_photos`, `list_opportunities`, `get_market_status`, `list_projects`,
`get_project`). The extensibility contract inverts: **new feature = new file in a mount;
a new tool is the exception that needs justification.**

First principles:

- **Editorial projection, not a database mirror.** 27 tables exist; five mounts are
  exposed. Each file is a curated view rendered on read (like `/proc`), each mount is an
  API contract. Internal pipeline artifacts never leak into the namespace.
- **Read-only, forever.** Reads generalize safely because they can't violate invariants.
  Writes stay verbs (`paint`, `run_code`, `publish_project`) — that's where approval
  gates and irreversibility live. There will be no generic `write()`.
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
│   └── references/
│       └── rosto-ana-8xk2.jpg ← read = header (imageId, kind, autorização) + pixels
├── images/                    ← gallery (non-reference images), newest first, cap 100
│   └── promo-agosto-bvn9.jpg  ← read = header (prompt, model, custo, dims, imageId) + pixels
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
    └── cartao-promo-vgpe.json ← codeRuns log: code, stdout/stderr, produced imageIds
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
├── types.ts        WorkspaceEntry / WorkspaceFile / WorkspaceMount
├── mounts/         brand.ts · images.ts · projects.ts · market.ts · runs.ts
└── index.ts        registry, path parsing, suffix resolution helpers

convex/workspaceData.ts   internalQuery list / read — dispatch by first path segment
vanda.ts                  tools `list` and `read` (pi-shaped)
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

Named `list`/`read` (pi-style) betting on the model's filesystem training transferring.
Retired at the same time: the six reader tools; INSTRUCTIONS rewritten to describe the
workspace and reference paths (`/brand/references`) instead of tool names.

## 6. Interaction with run_code (phase 3, later)

The same resolver will materialize sandbox slices: run_code inputs become paths
(`/images/promo-agosto-bvn9.jpg`) instead of raw ids, `/brand/kit/` mounts into the
sandbox, and the path Vanda reads in conversation is the path her Python opens. Until
then, listings and read headers always carry the `imageId` join key that `paint` and
`run_code` v1 speak.

## 7. Testing

Boundary tests per mount: ownership wall (foreign account's entities invisible and
unresolvable), suffix resolution (stale slug still resolves; bare suffix resolves),
errors-as-navigation (miss returns nearest listing), deterministic renders (golden
assertions on memory.md / slides.md shape), listing caps.

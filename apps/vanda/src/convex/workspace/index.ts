import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { brandMount } from "./mounts/brand";
import { imagesMount } from "./mounts/images";
import { marketMount } from "./mounts/market";
import { memoryMount } from "./mounts/memory";
import { projectsMount } from "./mounts/projects";
import { runsMount } from "./mounts/runs";
import { templatesMount } from "./mounts/templates";
import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceMount,
  WorkspaceWriteResult,
} from "./types";

const MOUNTS: readonly WorkspaceMount[] = [
  brandMount,
  memoryMount,
  templatesMount,
  imagesMount,
  projectsMount,
  marketMount,
  runsMount,
];

const rootListing = (): WorkspaceEntry[] =>
  MOUNTS.map((mount) => ({ name: mount.root, kind: "dir", summary: mount.summary }));

const parsePath = (path: string): string[] =>
  path
    .trim()
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");

export type ListResult =
  | { ok: true; path: string; entries: WorkspaceEntry[] }
  | { ok: false; error: string; nearest: string; entries: WorkspaceEntry[] };

export type ReadResult =
  | { ok: true; path: string; file: WorkspaceFile }
  | { ok: false; error: string; nearest: string; entries: WorkspaceEntry[] };

/**
 * Errors are navigation: a miss never returns a bare not-found — it walks up
 * to the nearest listable ancestor and returns that listing, so the model
 * self-corrects in one step.
 */
const miss = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  segments: string[],
  error: string,
): Promise<{ ok: false; error: string; nearest: string; entries: WorkspaceEntry[] }> => {
  for (let depth = segments.length - 1; depth > 0; depth--) {
    const ancestor = segments.slice(0, depth);
    const mount = MOUNTS.find((candidate) => candidate.root === ancestor[0]);
    const entries = await mount?.list(ctx, accountId, ancestor.slice(1));
    if (entries) return { ok: false, error, nearest: `/${ancestor.join("/")}`, entries };
  }
  return { ok: false, error, nearest: "/", entries: rootListing() };
};

export const listPath = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  path: string,
): Promise<ListResult> => {
  const segments = parsePath(path);
  if (segments.length === 0) return { ok: true, path: "/", entries: rootListing() };
  const mount = MOUNTS.find((candidate) => candidate.root === segments[0]);
  const entries = mount ? await mount.list(ctx, accountId, segments.slice(1)) : null;
  if (!entries) {
    return miss(ctx, accountId, segments, `diretório não encontrado: /${segments.join("/")}`);
  }
  return { ok: true, path: `/${segments.join("/")}`, entries };
};

export const readPath = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  path: string,
): Promise<ReadResult> => {
  const segments = parsePath(path);
  const mount = MOUNTS.find((candidate) => candidate.root === segments[0]);
  const file = mount ? await mount.read(ctx, accountId, segments.slice(1)) : null;
  if (!file) {
    // Reading a directory is a common model reflex — answer with its listing.
    const listed = mount ? await mount.list(ctx, accountId, segments.slice(1)) : null;
    if (listed || segments.length === 0) {
      return {
        ok: false,
        error: `isto é um diretório — conteúdo listado abaixo`,
        nearest: segments.length === 0 ? "/" : `/${segments.join("/")}`,
        entries: listed ?? rootListing(),
      };
    }
    return miss(ctx, accountId, segments, `arquivo não encontrado: /${segments.join("/")}`);
  }
  return { ok: true, path: `/${segments.join("/")}`, file };
};

export type WriteResult = WorkspaceWriteResult;

const WRITABLE_HELP =
  "graváveis: /memory/<nome>.md (livre), /templates/<nome>.py (livre), /brand/notes.md (com aprovação do dono)";

/**
 * One write surface, per-mount handlers underneath (the VFS shape — like
 * /proc's writable files). A refusal is guidance, not a dead end: it names the
 * verb that changes the underlying state.
 */
export const writePath = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  path: string,
  content: string,
): Promise<WorkspaceWriteResult> => {
  const segments = parsePath(path);
  const mount = MOUNTS.find((candidate) => candidate.root === segments[0]);
  if (!mount) {
    return { ok: false, error: `não há /${segments[0] ?? ""} no workspace — ${WRITABLE_HELP}` };
  }
  if (!mount.write) {
    return { ok: false, error: `/${mount.root} é somente leitura — ${mount.writeHint}` };
  }
  return mount.write(ctx, accountId, segments.slice(1), content);
};

/** Per-path approval policy for the write tool: brand notes need the owner. */
export const writeNeedsApproval = (path: string): boolean =>
  parsePath(path).join("/") === "brand/notes.md";

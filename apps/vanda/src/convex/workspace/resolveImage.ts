import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { resolveByName } from "./types";

/**
 * Resolve a workspace path to the image row behind it — the bridge run_code
 * uses to materialize inputs into the sandbox at the same path the agent read
 * them from. Unlike the /images listing (a recency window), resolution scans
 * the whole account so older images stay addressable.
 */
export const resolveImagePath = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  path: string,
): Promise<Doc<"images"> | null> => {
  const segments = path
    .trim()
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const allImages = () =>
    ctx.db
      .query("images")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

  if (segments[0] === "images" && segments.length === 2) {
    const images = (await allImages()).filter(
      (image) => image.purpose !== "reference" && image.status === undefined,
    );
    return resolveByName(segments[1]!, images);
  }
  if (segments[0] === "brand" && segments[1] === "references" && segments.length === 3) {
    const references = (await allImages()).filter((image) => image.purpose === "reference");
    return resolveByName(segments[2]!, references);
  }
  if (segments[0] === "projects" && segments.length === 4 && segments[2] === "renders") {
    const projects = await ctx.db
      .query("contentProjects")
      .withIndex("by_account_updated", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(25);
    const project = resolveByName(segments[1]!, projects);
    const post = project?.postId ? await ctx.db.get(project.postId) : null;
    if (!post) return null;
    const index = Number.parseInt(segments[3]!, 10) - 1;
    const imageId = Number.isNaN(index) ? undefined : post.imageIds[index];
    return imageId ? ctx.db.get(imageId) : null;
  }
  return null;
};

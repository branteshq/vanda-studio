import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { demoPosts, demoSnapshot } from "./demoData";
import { loadRootEnv } from "./loadRootEnv";
import type { AccountStats, ProjectSummary, SocialPost, VandaDataSnapshot } from "./types";

loadRootEnv();

type ConvexProject = {
  _id: string;
  name: string;
  instagramHandle?: string;
  postCount?: number;
  mediaCount?: number;
  socialPostCount?: number;
  scheduledCount?: number;
  publishedCount?: number;
  metrics?: AccountStats;
  latestSocialPosts?: Array<{
    _id: string;
    caption?: string;
    mediaType: string;
    thumbnailUrl?: string;
    permalink: string;
    publishedAt: number;
    likeCount?: number;
    commentsCount?: number;
    engagementScore?: number;
  }>;
  instagramConnection?: {
    status?: string;
    handle?: string;
    externalAccountName?: string;
  } | null;
};

type ConvexSocialPost = {
  _id: string;
  caption?: string;
  mediaType: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  permalink: string;
  publishedAt: number;
  likeCount?: number;
  commentsCount?: number;
  reach?: number;
  impressions?: number;
  saved?: number;
  shares?: number;
  engagementScore?: number;
};

const listProjectSummariesQuery = makeFunctionReference<"query", Record<string, never>, ConvexProject[]>(
  "projects:listSummaries",
);
const listSocialPostsByProjectQuery = makeFunctionReference<
  "query",
  { projectId: string; limit?: number },
  ConvexSocialPost[]
>("socialPosts:listByProject");

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL ?? "";
}

export type VandaDataOptions = {
  convexAuthToken?: string | null;
  authFallbackReason?: string | null;
};

function makeClient(authToken?: string | null) {
  const url = convexUrl();
  if (!url) return null;

  const client = new ConvexHttpClient(url);
  const token = authToken ?? process.env.CONVEX_AUTH_TOKEN;
  if (token) {
    client.setAuth(token);
  }
  return client;
}

function normalizeProject(project: ConvexProject): ProjectSummary {
  return {
    id: project._id,
    name: project.name,
    mode: "live",
    instagramHandle: project.instagramConnection?.handle ?? project.instagramHandle ?? null,
    instagramConnectionStatus: project.instagramConnection?.status ?? null,
    postCount: project.postCount ?? 0,
    mediaCount: project.mediaCount ?? 0,
    socialPostCount: project.socialPostCount ?? project.latestSocialPosts?.length ?? 0,
    scheduledCount: project.scheduledCount ?? 0,
    publishedCount: project.publishedCount ?? 0,
    stats: {
      followersCount: project.metrics?.followersCount ?? null,
      followersDelta: project.metrics?.followersDelta ?? null,
      postsCount: project.metrics?.postsCount ?? null,
      avgEngagement: project.metrics?.avgEngagement ?? null,
    },
  };
}

function normalizePost(post: ConvexSocialPost | NonNullable<ConvexProject["latestSocialPosts"]>[number]): SocialPost {
  return {
    id: post._id,
    caption: post.caption,
    mediaType: post.mediaType,
    thumbnailUrl: "thumbnailUrl" in post ? post.thumbnailUrl : undefined,
    permalink: post.permalink,
    publishedAt: post.publishedAt,
    likeCount: post.likeCount,
    commentsCount: post.commentsCount,
    engagementScore: post.engagementScore,
    ...("reach" in post && post.reach !== undefined ? { reach: post.reach } : {}),
    ...("impressions" in post && post.impressions !== undefined ? { impressions: post.impressions } : {}),
    ...("saved" in post && post.saved !== undefined ? { saved: post.saved } : {}),
    ...("shares" in post && post.shares !== undefined ? { shares: post.shares } : {}),
  };
}

function selectProject(projects: ProjectSummary[], requestedProjectId?: string) {
  const demoProjectId = process.env.DEMO_PROJECT_ID ?? process.env.NEXT_PUBLIC_DEMO_PROJECT_ID;
  const projectId = requestedProjectId ?? demoProjectId;
  if (projectId) {
    const match = projects.find((project) => project.id === projectId);
    if (match) return match;
  }
  return projects[0] ?? null;
}

function rankPosts(posts: SocialPost[]) {
  return [...posts].sort((a, b) => {
    const aScore = a.engagementScore ?? (a.likeCount ?? 0) + (a.commentsCount ?? 0) * 2;
    const bScore = b.engagementScore ?? (b.likeCount ?? 0) + (b.commentsCount ?? 0) * 2;
    return bScore - aScore;
  });
}

export async function getVandaSnapshot(projectId?: string, options: VandaDataOptions = {}): Promise<VandaDataSnapshot> {
  const authToken = options.convexAuthToken ?? process.env.CONVEX_AUTH_TOKEN ?? null;
  const client = makeClient(authToken);
  if (!convexUrl()) {
    return demoSnapshot("No live Convex URL is configured for the POC.");
  }
  if (!authToken) {
    return demoSnapshot(options.authFallbackReason ?? "No signed-in Clerk Convex JWT is available for this POC request.");
  }
  if (!client) {
    return demoSnapshot("Could not create a Convex client for the configured live Convex URL.");
  }

  try {
    const rawProjects = await client.query(listProjectSummariesQuery, {});
    const projects = rawProjects.map(normalizeProject);
    const selectedProject = selectProject(projects, projectId);
    if (!selectedProject) {
      return demoSnapshot("Live Convex responded, but no projects were available for this auth token.");
    }

    let posts: SocialPost[] = [];
    try {
      const rawPosts = await client.query(listSocialPostsByProjectQuery, {
        projectId: selectedProject.id,
        limit: 30,
      });
      posts = rawPosts.map(normalizePost);
    } catch {
      const project = rawProjects.find((candidate) => candidate._id === selectedProject.id);
      posts = project?.latestSocialPosts?.map(normalizePost) ?? [];
    }

    const topPosts = rankPosts(posts);
    return {
      mode: "live",
      selectedProject,
      projects,
      latestPost: posts[0] ?? null,
      topPosts,
      stats: selectedProject.stats,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Convex error.";
    return demoSnapshot(`Live Convex access failed: ${message}`);
  }
}

export async function listProjects(options?: VandaDataOptions) {
  const snapshot = await getVandaSnapshot(undefined, options);
  return {
    mode: snapshot.mode,
    reason: snapshot.reason,
    projects: snapshot.projects,
    selectedProject: snapshot.selectedProject,
  };
}

export async function latestInstagramPost(projectId?: string, options?: VandaDataOptions) {
  const snapshot = await getVandaSnapshot(projectId, options);
  return {
    mode: snapshot.mode,
    reason: snapshot.reason,
    project: snapshot.selectedProject,
    latestPost: snapshot.latestPost ?? demoPosts[0],
  };
}

export async function bestInstagramPosts(projectId?: string, limit = 3, options?: VandaDataOptions) {
  const snapshot = await getVandaSnapshot(projectId, options);
  return {
    mode: snapshot.mode,
    reason: snapshot.reason,
    project: snapshot.selectedProject,
    posts: snapshot.topPosts.slice(0, limit),
  };
}

export async function currentStats(projectId?: string, options?: VandaDataOptions) {
  const snapshot = await getVandaSnapshot(projectId, options);
  return {
    mode: snapshot.mode,
    reason: snapshot.reason,
    project: snapshot.selectedProject,
    stats: snapshot.stats,
  };
}

export async function summarizePerformance(projectId?: string, options?: VandaDataOptions) {
  const snapshot = await getVandaSnapshot(projectId, options);
  const topPost = snapshot.topPosts[0] ?? null;
  return {
    mode: snapshot.mode,
    reason: snapshot.reason,
    project: snapshot.selectedProject,
    stats: snapshot.stats,
    latestPost: snapshot.latestPost,
    topPost,
    summary: topPost
      ? `${snapshot.selectedProject?.name ?? "This account"} is strongest on ${topPost.mediaType.toLowerCase()} posts right now. The top recent post scored ${
          topPost.engagementScore ?? "unknown"
        } engagement with ${topPost.likeCount ?? 0} likes and ${topPost.commentsCount ?? 0} comments.`
      : "No recent social posts were available, so this POC can only report account-level stats.",
  };
}

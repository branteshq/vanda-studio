"use client";

import { useEffect, useState } from "react";
import type { VandaDataSnapshot } from "../../lib/types";

type DashboardSnapshot = VandaDataSnapshot & {
  auth?: {
    status: "signed-in" | "signed-out" | "token-error";
    userId: string | null;
    reason: string | null;
  };
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: number | null | undefined) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  useEffect(() => {
    fetch("/api/vanda")
      .then((response) => response.json())
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, []);

  const project = snapshot?.selectedProject;
  const stats = snapshot?.stats;

  return (
    <section className="dashboard">
      <div className="status-row">
        <span className={`mode-pill ${snapshot?.mode ?? "demo"}`}>{snapshot?.mode === "live" ? "live convex" : "demo fallback"}</span>
        <span>{snapshot?.reason ?? snapshot?.auth?.reason ?? "Read-only operator tools are available."}</span>
      </div>

      <div className="grid">
        <article className="panel">
          <h2>Connected Surface</h2>
          <p className="large">{project?.name ?? "Loading project"}</p>
          <dl>
            <div>
              <dt>Instagram</dt>
              <dd>{project?.instagramHandle ? `@${project.instagramHandle}` : "not connected in this view"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{project?.instagramConnectionStatus ?? snapshot?.mode ?? "loading"}</dd>
            </div>
            <div>
              <dt>Imported posts</dt>
              <dd>{formatNumber(project?.socialPostCount)}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>Current Stats</h2>
          <div className="metric-row">
            <strong>{formatNumber(stats?.followersCount)}</strong>
            <span>followers</span>
          </div>
          <div className="metric-row">
            <strong>{formatNumber(stats?.avgEngagement)}</strong>
            <span>avg engagement</span>
          </div>
          <div className="metric-row">
            <strong>{formatNumber(stats?.followersDelta)}</strong>
            <span>follower delta</span>
          </div>
        </article>

        <article className="panel wide">
          <h2>Recent Posts The Agent Can Read</h2>
          <div className="post-list">
            {(snapshot?.topPosts ?? []).slice(0, 3).map((post) => (
              <a className="post" href={post.permalink} target="_blank" rel="noreferrer" key={post.id}>
                <span>{post.mediaType}</span>
                <strong>{post.caption ?? "Imported Instagram post"}</strong>
                <small>
                  {formatDate(post.publishedAt)} · {formatNumber(post.likeCount)} likes · {formatNumber(post.commentsCount)} comments · score{" "}
                  {formatNumber(post.engagementScore)}
                </small>
              </a>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

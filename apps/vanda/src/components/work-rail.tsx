import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Id } from "../convex/_generated/dataModel";

/**
 * The right rail's state, hoisted to the dashboard layout so any surface
 * (chat cards, tool results, the rail itself) can open it on a specific
 * view — the rail is global, not owned by any one thread.
 */

export type WorkRailView =
  | { kind: "list" }
  | { kind: "post"; postId: Id<"posts"> }
  | { kind: "project"; projectId: Id<"contentProjects">; threadId?: string };

interface WorkRailState {
  open: boolean;
  setOpen: (open: boolean) => void;
  view: WorkRailView;
  openList: () => void;
  openPost: (postId: Id<"posts">) => void;
  openProject: (projectId: Id<"contentProjects">, threadId?: string) => void;
}

const WorkRailContext = createContext<WorkRailState | null>(null);

export function WorkRailProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<WorkRailView>({ kind: "list" });

  const openList = useCallback(() => {
    setView({ kind: "list" });
    setOpen(true);
  }, []);
  const openPost = useCallback((postId: Id<"posts">) => {
    setView({ kind: "post", postId });
    setOpen(true);
  }, []);
  const openProject = useCallback((projectId: Id<"contentProjects">, threadId?: string) => {
    setView({ kind: "project", projectId, ...(threadId !== undefined ? { threadId } : {}) });
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, view, openList, openPost, openProject }),
    [open, view, openList, openPost, openProject],
  );
  return <WorkRailContext.Provider value={value}>{children}</WorkRailContext.Provider>;
}

export function useWorkRail(): WorkRailState {
  const context = useContext(WorkRailContext);
  if (context === null) throw new Error("useWorkRail must be used within a WorkRailProvider");
  return context;
}

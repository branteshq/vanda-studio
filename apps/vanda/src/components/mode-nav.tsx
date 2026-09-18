import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

/**
 * Per-mode navigation memory for the chat ⇄ gallery toggle.
 *
 * Each mode is a route, and its open state lives in the URL (the chat's active
 * thread is `?t=`). Switching modes unmounts the other route, so a naive toggle
 * back would drop its URL state and land on the mode's blank default. This
 * remembers the last location per mode and restores it — the composable way to
 * keep "switch away and come back" landing where you left off. Any component can
 * drive the toggle through `useModeNav()`.
 */

type ChatSearch = { t?: string };

interface ModeNavValue {
  galleryActive: boolean;
  toChat: () => void;
  toGallery: () => void;
}

const ModeNavContext = createContext<ModeNavValue | null>(null);

export function ModeNavProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const galleryActive = location.pathname.startsWith("/galeria");

  // The chat's essential URL state is which thread is open. Gallery state
  // (search text, scroll) is transient React state, so it has nothing to carry.
  const lastChatSearch = useRef<ChatSearch>({});
  useEffect(() => {
    if (location.pathname.startsWith("/conversa")) {
      // SAFETY: TanStack's route search value is validated by the chat route schema.
      const search = location.search as ChatSearch;
      lastChatSearch.current = search.t ? { t: search.t } : {};
    }
  }, [location]);

  const toChat = useCallback(() => {
    void navigate({ to: "/conversa", search: lastChatSearch.current });
  }, [navigate]);

  const toGallery = useCallback(() => {
    void navigate({ to: "/galeria", search: {} });
  }, [navigate]);

  const value = useMemo(
    () => ({ galleryActive, toChat, toGallery }),
    [galleryActive, toChat, toGallery],
  );

  return <ModeNavContext.Provider value={value}>{children}</ModeNavContext.Provider>;
}

export function useModeNav(): ModeNavValue {
  const value = useContext(ModeNavContext);

  if (!value) throw new Error("useModeNav must be used within ModeNavProvider");

  return value;
}

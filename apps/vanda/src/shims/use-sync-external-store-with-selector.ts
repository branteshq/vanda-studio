/**
 * ESM port of `use-sync-external-store/shim/with-selector` (MIT, Meta
 * Platforms) on top of React 19's native useSyncExternalStore — see the
 * sibling shim for why the CJS package is aliased out of the graph.
 */
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

const objectIs = Object.is;

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const instRef = useRef<{ hasValue: true; value: Selection } | { hasValue: false; value: null }>({
    hasValue: false,
    value: null,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- faithful port:
  // upstream memoizes on these four; `inst` is a stable ref read lazily.
  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);

        const cached = instRef.current;

        if (isEqual !== undefined && cached.hasValue) {
          const currentSelection = cached.value;

          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;

            return currentSelection;
          }
        }

        memoizedSelection = nextSelection;

        return nextSelection;
      }

      const prevSnapshot = memoizedSnapshot;
      const prevSelection = memoizedSelection;

      if (objectIs(prevSnapshot, nextSnapshot)) return prevSelection;
      const nextSelection = selector(nextSnapshot);

      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;

        return prevSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;

      return nextSelection;
    };

    const maybeGetServerSnapshot = getServerSnapshot === undefined ? null : getServerSnapshot;

    return [
      () => memoizedSelector(getSnapshot()),
      maybeGetServerSnapshot === null
        ? undefined
        : () => memoizedSelector(maybeGetServerSnapshot()),
    ] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    instRef.current = { hasValue: true, value };
  }, [value]);

  useDebugValue(value);

  return value;
}

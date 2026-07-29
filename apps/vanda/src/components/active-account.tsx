import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { useQueries, useQuery } from "convex-helpers/react/cache";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type Account = FunctionReturnType<typeof api.accounts.listMine>[number];

interface ActiveAccountValue {
  accounts: Account[] | undefined;
  activeAccount: Account | undefined;
  /** Switches instantly (optimistic local update); the server confirms in the background. */
  selectAccount: (accountId: Id<"accounts">) => void;
}

const ActiveAccountContext = createContext<ActiveAccountValue | null>(null);

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const accounts = useQuery(api.accounts.listMine);
  // Flip the `active` flag locally the moment the user clicks, so the switcher
  // and every `activeAccount` consumer re-render this frame instead of waiting
  // for the mutation round-trip + query re-push.
  const selectActive = useMutation(api.accounts.selectActive).withOptimisticUpdate(
    (store, { accountId }) => {
      const current = store.getQuery(api.accounts.listMine, {});
      if (!current) return;
      store.setQuery(
        api.accounts.listMine,
        {},
        current.map((account) => ({ ...account, active: account.id === accountId })),
      );
    },
  );
  const activeAccount =
    accounts?.find((account) => account.active && account.onboardedAt !== null) ??
    accounts?.find((account) => account.onboardedAt !== null);

  // Keep every ready account's thread list subscribed (owners have at most a
  // handful). Switching profiles then paints the new sidebar instantly from
  // live local data instead of a fresh round-trip.
  useQueries(
    useMemo(
      () =>
        Object.fromEntries(
          (accounts ?? [])
            .filter((account) => account.onboardedAt !== null)
            .map((account) => [
              account.id,
              { query: api.chat.listThreads, args: { accountId: account.id } },
            ]),
        ),
      [accounts],
    ),
  );

  return (
    <ActiveAccountContext.Provider
      value={{
        accounts,
        activeAccount,
        selectAccount: (accountId) => {
          void selectActive({ accountId });
        },
      }}
    >
      {children}
    </ActiveAccountContext.Provider>
  );
}

export function useActiveAccount() {
  const value = useContext(ActiveAccountContext);
  if (value === null) throw new Error("useActiveAccount must be used inside ActiveAccountProvider");
  return value;
}

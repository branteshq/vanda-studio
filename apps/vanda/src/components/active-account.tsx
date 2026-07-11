import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type Account = FunctionReturnType<typeof api.accounts.listMine>[number];

interface ActiveAccountValue {
  accounts: Account[] | undefined;
  activeAccount: Account | undefined;
  selectAccount: (accountId: Id<"accounts">) => Promise<void>;
}

const ActiveAccountContext = createContext<ActiveAccountValue | null>(null);

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const accounts = useQuery(api.accounts.listMine);
  const selectActive = useMutation(api.accounts.selectActive);
  const activeAccount =
    accounts?.find((account) => account.active && account.onboardedAt !== null) ??
    accounts?.find((account) => account.onboardedAt !== null);

  return (
    <ActiveAccountContext.Provider
      value={{
        accounts,
        activeAccount,
        selectAccount: async (accountId) => {
          await selectActive({ accountId });
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

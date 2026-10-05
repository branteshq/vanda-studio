import { createContext, useContext, type ComponentType } from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useActiveAccount } from "../active-account";
import { WhatsAppSettings } from "../whatsapp-settings";

/**
 * Everything the Perfil page reads or calls, behind one context so tests can
 * render the page without Convex, Clerk or the router.
 */
const profileHooks = {
  useUsageSummary: () => useQuery(api.usage.summary),
  useSyncBilling: () => useAction(api.billing.autumn.syncBilling),
  useBillingActions: () => ({
    startCheckout: useAction(api.billing.autumn.startCheckout),
    previewPlanChange: useAction(api.billing.autumn.previewPlanChange),
    changePlan: useAction(api.billing.autumn.changePlan),
    getPortalUrl: useAction(api.billing.autumn.getBillingPortalUrl),
  }),
  useModelPreferences: () => {
    const setAgentModel = useMutation(api.users.setAgentModel);
    const setCaetanoModel = useMutation(api.users.setCaetanoModel);
    const setImageModel = useMutation(api.users.setImageModel);

    return {
      preferences: useQuery(api.users.modelPreferences),
      setAgentModel: (args: { modelId: string }) => setAgentModel(args),
      setCaetanoModel: (args: { modelId: string }) => setCaetanoModel(args),
      setImageModel: (args: { modelId: string }) => setImageModel(args),
    };
  },
  usePublisherConnection: (accountId: Id<"accounts">) => ({
    status: useQuery(api.publisherConnect.connectionStatus, { accountId }),
    startConnect: useAction(api.publisherConnect.startConnect),
    syncConnection: useAction(api.publisherConnect.syncConnection),
  }),
  useOpenAiConnection: () => {
    const disconnect = useMutation(api.openaiSub.disconnect);

    return {
      status: useQuery(api.openaiSub.connectionStatus),
      startDeviceAuth: useAction(api.openaiSub.startDeviceAuth),
      pollDeviceAuth: useAction(api.openaiSub.pollDeviceAuth),
      disconnect: () => disconnect(),
    };
  },
  useBrandFile: (accountId: Id<"accounts">) => {
    const save = useMutation(api.brandFile.save);

    return {
      file: useQuery(api.brandFile.get, { accountId }),
      save: (content: string) => save({ accountId, content }),
    };
  },
  useWorkspaceFile: (accountId: Id<"accounts">, path: string) =>
    useQuery(api.workspacePublic.file, { accountId, path }),
};

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;

type ProfileAccount = Pick<
  NonNullable<ReturnType<typeof useActiveAccount>["accounts"]>[number],
  "id" | "name" | "onboardedAt"
>;

export type ProfileRuntime = typeof profileHooks & {
  useProfileUser: () => {
    user:
      | (Pick<ClerkUser, "firstName" | "fullName"> &
          Partial<Pick<ClerkUser, "username" | "imageUrl" | "primaryEmailAddress">>)
      | null
      | undefined;
  };
  useClerkActions: () => Pick<ReturnType<typeof useClerk>, "signOut" | "openUserProfile">;
  useProfileNavigate: () => ReturnType<typeof useNavigate>;
  useProfileAccounts: () => {
    accounts: ProfileAccount[] | undefined;
    activeAccount: ProfileAccount | undefined;
    selectAccount: (accountId: Id<"accounts">) => void;
  };
  WhatsAppSettings: ComponentType;
};

export const defaultProfileRuntime: ProfileRuntime = {
  ...profileHooks,
  useProfileUser: useUser,
  useClerkActions: useClerk,
  useProfileNavigate: useNavigate,
  useProfileAccounts: useActiveAccount,
  WhatsAppSettings,
};

export const ProfileRuntimeContext = createContext(defaultProfileRuntime);

export const useProfileRuntime = () => useContext(ProfileRuntimeContext);

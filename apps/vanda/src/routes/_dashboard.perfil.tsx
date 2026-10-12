import { useEffect, type ReactNode } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ProfileShell } from "../components/profile/shell";
import {
  ProfileRuntimeContext,
  defaultProfileRuntime,
  useProfileRuntime,
  type ProfileRuntime,
} from "../components/profile/runtime";

export const Route = createFileRoute("/_dashboard/perfil")({
  component: () => (
    <ProfilePage>
      <Outlet />
    </ProfilePage>
  ),
});

/**
 * Perfil is a settings area, like Linear's: a sidebar of pages (Conta, Plano e
 * uso, Conexões, each business, Modelos) and one page at a time in an inset
 * panel. The pages live in components/profile/pages.tsx, one route each.
 */
export function ProfilePage({
  runtime = defaultProfileRuntime,
  children,
}: {
  runtime?: ProfileRuntime;
  children?: ReactNode;
}) {
  return (
    <ProfileRuntimeContext.Provider value={runtime}>
      <BillingSync />
      <ProfileShell>{children}</ProfileShell>
    </ProfileRuntimeContext.Provider>
  );
}

/** Checkout returns to Perfil; refresh the enforcement snapshot once on arrival. */
function BillingSync() {
  const syncBilling = useProfileRuntime().useSyncBilling();

  useEffect(() => {
    void syncBilling().catch(() => {});
  }, [syncBilling]);

  return null;
}

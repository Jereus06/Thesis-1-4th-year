import type { SessionUser } from "@/lib/api";
import { useAppStore } from "@/lib/store";

// Mirror backend/app/main.py; the API remains the authority on authorization.
export function getPermissions(dataMode: "api" | "browser-demo", session: SessionUser | null) {
  const signedIn = dataMode === "browser-demo" || Boolean(session);
  const owner = dataMode === "browser-demo" || session?.role === "owner";
  return {
    canManageProducts: owner,
    canImportRecords: owner,
    canDeleteImportedSales: owner,
    canManageSettings: owner,
    canManageMembers: dataMode === "api" && session?.role === "owner",
    canRefreshForecast: owner,
    canRecordSales: signedIn,
    canReceiveStock: signedIn,
    canRecordReturns: signedIn,
    canWriteOffStock: owner,
    canReviewDataQuality: signedIn,
  };
}

export function usePermissions() {
  const dataMode = useAppStore((state) => state.dataMode);
  const session = useAppStore((state) => state.session);
  return getPermissions(dataMode, session);
}

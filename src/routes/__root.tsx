import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { ApiGate } from "@/components/api-gate";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ApiGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </ApiGate>
  );
}

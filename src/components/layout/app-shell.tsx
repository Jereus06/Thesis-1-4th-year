import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  LayoutDashboard,
  LineChart,
  PackagePlus,
  Plus,
  Warehouse,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ForecastProvider } from "@/components/forecast-context";
import { RecordSaleDialog } from "@/components/record-sale-dialog";
import { Button } from "@/components/ui/button";
import {
  attachCachePersist,
  peekPipeline,
  peekStalePipeline,
  runServeCached,
} from "@/lib/forecast/cache";
import { requestBackgroundTrain } from "@/lib/forecast/job";
import { localForecastCache } from "@/lib/forecast/persist";
import { AS_OF } from "@/lib/data/seed";
import { formatLong } from "@/lib/dates";
import { useAppStore } from "@/lib/store";
import type { PipelineResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/restock", label: "Restock", icon: PackagePlus },
  { to: "/forecasts", label: "Forecasts", icon: LineChart },
  { to: "/inventory", label: "Inventory", icon: Warehouse },
  { to: "/methodology", label: "Strategies", icon: BookOpen },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [initial, setInitial] = useState<PipelineResult | null>(null);

  useEffect(() => {
    attachCachePersist(localForecastCache);
    let cancelled = false;
    let fitted = false;
    const timers: number[] = [];

    const fit = () => {
      if (cancelled || fitted) return;
      fitted = true;
      const state = useAppStore.getState();
      const cached =
        peekPipeline(state.products, state.sales, state.settings) ?? peekStalePipeline();
      if (cached) {
        setInitial(cached);
        requestBackgroundTrain();
        return;
      }
      void runServeCached(state.products, state.sales, state.settings).then((result) => {
        if (!cancelled) setInitial(result);
        requestBackgroundTrain();
      });
    };

    const persistApi = useAppStore.persist;
    if (persistApi.hasHydrated()) {
      timers.push(window.setTimeout(fit, 0));
    } else {
      const unsub = persistApi.onFinishHydration(() => {
        timers.push(window.setTimeout(fit, 0));
      });
      timers.push(window.setTimeout(fit, 350));
      return () => {
        cancelled = true;
        unsub();
        timers.forEach((id) => window.clearTimeout(id));
      };
    }

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  if (!initial) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-fg">
        <p className="font-display text-4xl italic tracking-tight">StockCast</p>
        <p className="mt-2 max-w-sm text-center text-sm text-muted">
          Loading cached forecasts for Cruz Mini Mart
        </p>
        <div className="splash-bar mt-6" />
      </div>
    );
  }

  return (
    <ForecastProvider initialResult={initial}>
      <div className="min-h-dvh bg-bg text-fg">
        <div className="lg:grid lg:grid-cols-[16.5rem_1fr]">
          <aside className="hidden min-h-dvh flex-col border-r border-border bg-sidebar lg:flex">
            <div className="px-5 pt-8 pb-6">
              <p className="font-display text-2xl italic tracking-tight">StockCast</p>
              <p className="mt-1 text-xs tracking-wide text-muted uppercase">Demand & restock</p>
            </div>
            <SidebarStore />
            <nav className="flex flex-1 flex-col gap-1 px-3 pt-6">
              {NAV.map((item) => (
                <NavLink key={item.to} {...item} />
              ))}
            </nav>
            <p className="px-5 pb-6 text-xs text-muted">
              Forecasts are decision-support only, not guarantees.
            </p>
          </aside>

          <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
            <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur-sm lg:px-8">
              <div className="min-w-0 lg:hidden">
                <p className="font-display text-lg italic">StockCast</p>
              </div>
              <p className="hidden text-sm text-muted lg:block">{formatLong(AS_OF)}</p>
              <RecordSaleDialog
                trigger={
                  <Button size="sm">
                    <Plus className="size-4" />
                    Record sale
                  </Button>
                }
              />
            </header>
            <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
          </div>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-sm lg:hidden">
          <ul className="grid grid-cols-5">
            {NAV.map((item) => (
              <li key={item.to}>
                <MobileNavLink {...item} />
              </li>
            ))}
          </ul>
        </nav>
        <Toaster position="top-center" richColors />
      </div>
    </ForecastProvider>
  );
}

function SidebarStore() {
  const storeName = useAppStore((s) => s.settings.storeName);
  const location = useAppStore((s) => s.settings.storeLocation);
  return (
    <div className="mx-4 rounded-xl bg-surface px-3 py-3">
      <p className="text-sm font-medium">{storeName}</p>
      <p className="text-xs text-muted">{location}</p>
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to;
  return (
    <Link
      to={to}
      className={cn(
        "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active ? "bg-surface text-fg" : "text-muted hover:bg-surface/70 hover:text-fg",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

function MobileNavLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to;
  return (
    <Link
      to={to}
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
        active ? "text-primary" : "text-muted",
      )}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );
}

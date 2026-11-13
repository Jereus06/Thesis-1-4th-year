import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CircleHelp,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LineChart,
  Leaf,
  PackagePlus,
  Pause,
  Play,
  Plus,
  Store,
  Warehouse,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { AmbientBackground } from "@/components/ambient-background";
import { ApiForecastProvider, ForecastProvider } from "@/components/forecast-context";
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
import { formatLong, todayISO } from "@/lib/dates";
import { useAppStore } from "@/lib/store";
import type { PipelineResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/restock", label: "Restock", icon: PackagePlus },
  { to: "/forecasts", label: "Forecasts", icon: LineChart },
  { to: "/sales-report", label: "Sales report", icon: FileText },
  { to: "/inventory", label: "Inventory", icon: Warehouse },
  { to: "/data-quality", label: "Data Review", icon: ClipboardCheck },
  { to: "/methodology", label: "Strategies", icon: BookOpen },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const mode = useAppStore((s) => s.dataMode);
  if (mode === "api")
    return (
      <ApiForecastProvider>
        <ShellLayout>{children}</ShellLayout>
      </ApiForecastProvider>
    );
  return <BrowserForecastShell>{children}</BrowserForecastShell>;
}

function BrowserForecastShell({ children }: { children: ReactNode }) {
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
          Loading demonstration forecasts
        </p>
        <div className="splash-bar mt-6" />
      </div>
    );
  }

  return (
    <ForecastProvider initialResult={initial}>
      <ShellLayout>{children}</ShellLayout>
    </ForecastProvider>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const mode = useAppStore((s) => s.dataMode);
  const { paused, reducedMotion, toggle } = useBackgroundMotion();
  return (
    <div className="app-shell relative isolate min-h-dvh text-fg">
      <AmbientBackground paused={paused || reducedMotion} />
      <div className="app-shell-grid relative z-10 lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className="app-sidebar hidden h-dvh min-w-0 flex-col lg:sticky lg:top-0 lg:flex lg:self-start lg:overflow-y-auto">
          <div className="px-5 pt-7 pb-6">
            <Link to="/" className="app-brand" aria-label="StockCast home">
              <span className="app-brand-mark" aria-hidden="true">
                <LineChart className="size-6" strokeWidth={1.8} />
              </span>
              <span>
                <span className="app-brand-wordmark">StockCast</span>
                <span className="mt-1 block text-[10px] font-semibold tracking-[0.15em] text-muted uppercase">
                  Demand & restock
                </span>
              </span>
            </Link>
          </div>
          <SidebarStore />
          <p className="px-6 pt-7 pb-3 text-[10px] font-semibold tracking-[0.16em] text-muted uppercase">
            Workspace
          </p>
          <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1.5 px-3 pb-6">
            {NAV.map((item) => (
              <NavLink key={item.to} {...item} />
            ))}
          </nav>
        </aside>

        <div className="app-shell-content flex min-h-dvh min-w-0 flex-col pb-20 lg:pb-0">
          <header className="app-header sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap lg:px-8">
            <div className="min-w-0 lg:hidden">
              <Link to="/" className="app-brand gap-2" aria-label="StockCast home">
                <span className="app-brand-mark size-8! rounded-lg!" aria-hidden="true">
                  <LineChart className="size-5" strokeWidth={1.8} />
                </span>
                <span className="app-brand-wordmark text-xl!">StockCast</span>
              </Link>
            </div>
            <p className="hidden text-sm font-medium text-muted lg:block">
              {formatLong(mode === "api" ? todayISO() : AS_OF)}
            </p>
            <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5 sm:gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="app-motion-button size-9 px-0"
                aria-label={
                  reducedMotion
                    ? "Background motion reduced"
                    : paused
                      ? "Resume background motion"
                      : "Pause background motion"
                }
                title={
                  reducedMotion
                    ? "Background motion is off because your device prefers reduced motion."
                    : paused
                      ? "Resume background motion"
                      : "Pause background motion"
                }
                disabled={reducedMotion}
                onClick={toggle}
              >
                {reducedMotion ? (
                  <Leaf aria-hidden="true" />
                ) : paused ? (
                  <Play aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link
                  to="/methodology"
                  search={{ tab: "guide" }}
                  aria-label="Open user guide"
                  title="User guide"
                >
                  <CircleHelp className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">User guide</span>
                </Link>
              </Button>
              {mode === "api" && <SignOutButton />}
              <RecordSaleDialog
                trigger={
                  <Button size="sm">
                    <Plus className="size-4" aria-hidden="true" />
                    Record sale
                  </Button>
                }
              />
            </div>
          </header>
          <main className="app-main relative z-0 mx-auto w-full min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>

      <nav
        aria-label="Mobile navigation"
        className="app-mobile-nav fixed inset-x-0 bottom-0 z-40 lg:hidden"
      >
        <ul className="grid grid-cols-7">
          {NAV.map((item) => (
            <li key={item.to}>
              <MobileNavLink {...item} />
            </li>
          ))}
        </ul>
      </nav>
      <Toaster position="top-center" richColors />
    </div>
  );
}

function SidebarStore() {
  const storeName = useAppStore((s) => s.settings.storeName);
  const mode = useAppStore((s) => s.dataMode);
  const origin = useAppStore((s) => s.dataOrigin);
  const location = useAppStore((s) => s.settings.storeLocation);
  return (
    <div className="app-store-card mx-4 flex items-start gap-3 rounded-xl px-3 py-3.5">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-primary"
        aria-hidden="true"
      >
        <Store className="size-[18px]" strokeWidth={1.7} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold break-words">{storeName}</p>
        {location && <p className="mt-0.5 text-xs text-muted break-words">{location}</p>}
        {(mode === "browser-demo" || origin === "demo") && (
          <p className="mt-2 text-xs text-muted">Demo store · Test records</p>
        )}
      </div>
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "app-nav-link flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
        active ? "text-primary" : "text-muted hover:text-fg",
      )}
    >
      <span
        className="app-nav-icon flex size-8 shrink-0 items-center justify-center rounded-lg"
        aria-hidden="true"
      >
        <Icon className="size-[18px]" strokeWidth={1.8} />
      </span>
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
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "app-mobile-nav-link flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium sm:text-[11px]",
        active ? "text-primary" : "text-muted",
      )}
    >
      <span
        className="app-mobile-nav-icon flex h-7 w-10 items-center justify-center rounded-lg"
        aria-hidden="true"
      >
        <Icon className="size-[19px]" strokeWidth={1.8} />
      </span>
      <span>{to === "/sales-report" ? "Sales" : to === "/data-quality" ? "Review" : label}</span>
    </Link>
  );
}

function useBackgroundMotion() {
  const [paused, setPaused] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        window.localStorage.getItem("stockcast-background-motion") === "paused"
      );
    } catch {
      return false;
    }
  });
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    const syncPreference = (event: StorageEvent) => {
      if (event.key === "stockcast-background-motion") setPaused(event.newValue === "paused");
    };
    window.addEventListener("storage", syncPreference);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  function toggle() {
    const next = !paused;
    setPaused(next);
    try {
      window.localStorage.setItem("stockcast-background-motion", next ? "paused" : "running");
    } catch {
      // Motion controls remain usable when this browser blocks local storage.
    }
  }

  return { paused, reducedMotion, toggle };
}

function SignOutButton() {
  const signOut = useAppStore((s) => s.signOut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await signOut();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? `Could not sign out. ${failure.message} Try again.`
          : "Could not sign out. Check your connection and try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void submit()}
      >
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {error && (
        <p role="alert" className="max-w-64 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, LogIn, LogOut, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  ApiError,
  api,
  type AccountActivityEvent,
  type AccountActivityPage,
  type SessionUser,
} from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";

type ActivityFilter = "all" | AccountActivityEvent["event"];
type LoadedActivity = AccountActivityPage & { queryKey: string; session: SessionUser };

export function AccountActivityCard() {
  const { canManageMembers } = usePermissions();
  const mode = useAppStore((state) => state.dataMode);
  const session = useAppStore((state) => state.session);
  const timezone = useAppStore((state) => state.settings.timezone);

  if (mode !== "api" || !session || !canManageMembers) return null;

  return (
    <OwnerActivity
      key={`${session.businessId}:${session.userId}:${session.role}`}
      session={session}
      timezone={timezone}
    />
  );
}

function OwnerActivity({ session, timezone }: { session: SessionUser; timezone: string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [page, setPage] = useState<LoadedActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [retryBefore, setRetryBefore] = useState<string | undefined>();
  const requests = useRef(0);
  const pending = useRef(false);
  const trimmedSearch = search.trim();
  const searchPending = trimmedSearch !== debouncedSearch;
  const queryKey = JSON.stringify([debouncedSearch, filter]);
  const visiblePage =
    !searchPending && page?.session === session && page.queryKey === queryKey ? page : null;
  const events = visiblePage?.events ?? [];
  const filtered = Boolean(debouncedSearch) || filter !== "all";

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(trimmedSearch), 250);
    return () => window.clearTimeout(timeout);
  }, [trimmedSearch]);

  const loadActivity = useCallback(
    async (before?: string) => {
      const current = useAppStore.getState();
      if (current.dataMode !== "api" || current.session !== session || session.role !== "owner")
        return;
      const version = ++requests.current;
      pending.current = true;
      setLoading(!before);
      setLoadingOlder(Boolean(before));
      setError("");
      setNotConfigured(false);
      setRetryBefore(before);
      const isCurrent = () =>
        version === requests.current &&
        useAppStore.getState().dataMode === "api" &&
        useAppStore.getState().session === session;
      try {
        const result = await api.accountActivity({
          limit: 50,
          ...(before ? { before } : {}),
          ...(filter === "all" ? {} : { event: filter }),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        });
        if (!isCurrent()) return;
        setPage((previous) => {
          const existing =
            before && previous?.session === session && previous.queryKey === queryKey
              ? previous.events
              : [];
          const ids = new Set(existing.map((event) => event.id));
          return {
            session,
            queryKey,
            events: [...existing, ...result.events.filter((event) => !ids.has(event.id))],
            nextCursor: result.nextCursor,
          };
        });
      } catch (failure) {
        if (!isCurrent()) return;
        if (failure instanceof ApiError && [404, 501].includes(failure.status)) {
          setNotConfigured(true);
          setPage(null);
        } else {
          setError(failure instanceof Error ? failure.message : "Activity could not be loaded.");
        }
      } finally {
        if (isCurrent()) {
          pending.current = false;
          setLoading(false);
          setLoadingOlder(false);
        }
      }
    },
    [debouncedSearch, filter, queryKey, session],
  );

  useEffect(() => {
    if (!searchPending) void loadActivity();
    return () => {
      requests.current += 1;
      pending.current = false;
    };
  }, [loadActivity, searchPending]);

  function updateSearch(value: string) {
    if (value.trim() === trimmedSearch) {
      setSearch(value);
      return;
    }
    requests.current += 1;
    pending.current = false;
    setSearch(value);
    setError("");
    setNotConfigured(false);
  }

  function updateFilter(value: ActivityFilter) {
    requests.current += 1;
    pending.current = false;
    setFilter(value);
    setError("");
    setNotConfigured(false);
  }

  function refresh() {
    if (pending.current || searchPending) return;
    void loadActivity();
  }

  return (
    <Card role="region" aria-label="Sign-in activity">
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div className="grid min-w-0 gap-1">
            <CardTitle>Sign-in activity</CardTitle>
            <CardDescription>See who signed in and signed out of your store.</CardDescription>
            <span className="text-xs text-muted">Owner access · Times in {timezone}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={refresh}
          disabled={loading || loadingOlder || searchPending}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
          Refresh activity
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="grid gap-1.5">
            <Label htmlFor="activity-search">Search team activity</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted"
                aria-hidden="true"
              />
              <Input
                id="activity-search"
                type="search"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                placeholder="Search by name or email"
                maxLength={160}
                className="pl-9"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="activity-type">Activity type</Label>
            <Select
              id="activity-type"
              value={filter}
              onChange={(event) => updateFilter(event.target.value as ActivityFilter)}
            >
              <option value="all">All activity</option>
              <option value="signed_in">Signed in</option>
              <option value="signed_out">Signed out</option>
            </Select>
          </div>
        </div>

        {notConfigured ? (
          <div role="status" className="rounded-xl border border-border bg-surface-2 p-5">
            <p className="font-medium">Sign-in activity is not configured</p>
            <p className="mt-1 text-sm text-muted">
              Activity history is unavailable. Contact your administrator.
            </p>
          </div>
        ) : loading || searchPending ? (
          <div
            role="status"
            className="rounded-xl bg-surface-2 px-5 py-8 text-center text-sm text-muted"
          >
            {searchPending ? "Searching activity…" : "Loading activity…"}
          </div>
        ) : events.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-[minmax(0,1fr)_9rem_12rem] gap-5 bg-surface-2 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted sm:grid">
              <span>Team member</span>
              <span>Activity</span>
              <span>Date & time</span>
            </div>
            <ul
              aria-label="Sign-in activity entries"
              tabIndex={0}
              className="h-72 divide-y divide-border overflow-y-auto focus-visible:outline-2 focus-visible:outline-primary sm:h-80"
            >
              {events.map((event) => (
                <ActivityRow key={event.id} event={event} timezone={timezone} />
              ))}
            </ul>
          </div>
        ) : !error ? (
          <div role="status" className="rounded-xl bg-surface-2 px-5 py-8 text-center">
            <Clock3 className="mx-auto mb-3 size-6 text-muted" aria-hidden="true" />
            <p className="font-medium">
              {filtered ? "No matching activity" : "No activity recorded yet"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {filtered
                ? "Try a different name, email, or activity type."
                : "Sign-ins and sign-outs will appear here."}
            </p>
          </div>
        ) : null}

        {error && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-danger/20 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 text-sm">
              <p className="font-medium">Activity could not be loaded</p>
              <p className="mt-1 break-words text-muted">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => void loadActivity(retryBefore)}
            >
              Try again
            </Button>
          </div>
        )}

        {visiblePage && !notConfigured && !loading && (
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {events.length} {filtered ? "matching " : ""}event{events.length === 1 ? "" : "s"}{" "}
              loaded
            </p>
            {visiblePage.nextCursor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!pending.current) void loadActivity(visiblePage.nextCursor ?? undefined);
                }}
                disabled={loadingOlder || searchPending}
              >
                {loadingOlder ? "Loading older activity…" : "Load older activity"}
              </Button>
            )}
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted">
          Sign-outs appear when someone chooses Sign out. Closing the browser is not recorded as
          signing out.
        </p>
      </CardContent>
    </Card>
  );
}

function ActivityRow({ event, timezone }: { event: AccountActivityEvent; timezone: string }) {
  const signedIn = event.event === "signed_in";
  const Icon = signedIn ? LogIn : LogOut;
  const instant = new Date(event.occurredAt);
  const validTime = Number.isFinite(instant.getTime());
  const date = validTime
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(instant)
    : "Date unavailable";
  const time = validTime
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(instant)
    : "";

  return (
    <li className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_9rem_12rem] sm:items-center sm:gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
            {event.displayName || event.email}
          </span>
          <Badge variant="outline" className="capitalize">
            {event.role}
          </Badge>
        </div>
        <p className="mt-1 break-all text-sm text-muted">{event.email}</p>
      </div>
      <div>
        <Badge variant={signedIn ? "primary" : "default"} className="gap-1.5 whitespace-nowrap">
          <Icon className="size-3.5" aria-hidden="true" />
          {signedIn ? "Signed in" : "Signed out"}
        </Badge>
      </div>
      <time
        dateTime={validTime ? event.occurredAt : undefined}
        className="text-sm sm:grid sm:gap-0.5"
      >
        <span>{date}</span> <span className="ml-1 text-muted sm:ml-0">{time}</span>
      </time>
    </li>
  );
}

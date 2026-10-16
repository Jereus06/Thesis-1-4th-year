import { createFileRoute } from "@tanstack/react-router";
import { UserGuide } from "@/components/user-guide";
import { SystemEvaluation } from "@/components/system-evaluation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STRATEGY_TABS = ["guide", "evaluation"] as const;
type StrategyTab = (typeof STRATEGY_TABS)[number];

function isStrategyTab(value: unknown): value is StrategyTab {
  return typeof value === "string" && STRATEGY_TABS.includes(value as StrategyTab);
}

export const Route = createFileRoute("/methodology")({
  validateSearch: (search: Record<string, unknown>): { tab?: StrategyTab } => ({
    tab: isStrategyTab(search.tab) ? search.tab : undefined,
  }),
  component: StrategiesPage,
});

function StrategiesPage() {
  const tab = Route.useSearch().tab ?? "guide";
  const navigate = Route.useNavigate();

  function setTab(value: string) {
    if (isStrategyTab(value)) void navigate({ search: { tab: value }, hash: "" });
  }

  return (
    <div
      className={
        "page-enter mx-auto grid gap-6 " + (tab === "guide" ? "max-w-6xl" : "max-w-3xl")
      }
    >
      <header>
        <h1 className="font-display text-3xl">Strategies</h1>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          className="w-full max-w-full justify-start overflow-x-auto"
          aria-label="Strategies sections"
        >
          <TabsTrigger className="shrink-0" value="guide">
            User guide
          </TabsTrigger>
          <TabsTrigger className="shrink-0" value="evaluation">
            Evaluation
          </TabsTrigger>
        </TabsList>
        <TabsContent value="guide">
          <UserGuide />
        </TabsContent>
        <TabsContent value="evaluation">
          <SystemEvaluation />
        </TabsContent>
      </Tabs>
    </div>
  );
}

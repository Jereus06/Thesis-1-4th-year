import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useForecast } from "@/components/forecast-context";
import { ThesisPanel } from "@/components/thesis-panel";
import { UserGuide } from "@/components/user-guide";
import { SystemEvaluation } from "@/components/system-evaluation";
import { TrainingBanner } from "@/components/training-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { invalidatePipelineCache } from "@/lib/forecast/cache";
import { CV_FOLDS, DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { FEATURE_NAMES } from "@/lib/forecast/features";
import { requestBackgroundTrain } from "@/lib/forecast/job";
import { LEVELS, TECHNIQUES } from "@/lib/forecast/strategies";
import { DEFAULT_XGB } from "@/lib/forecast/xgboost";
import { metric, num } from "@/lib/format";
import { forecastRefreshAdvice, forecastScheduleMessage } from "@/lib/forecast-schedule";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";

const STRATEGY_TABS = [
  "methodology",
  "accuracy",
  "speed",
  "thesis",
  "models",
  "guide",
  "evaluation",
] as const;
type StrategyTab = (typeof STRATEGY_TABS)[number];
const API_TABS: readonly StrategyTab[] = ["methodology", "thesis", "guide", "evaluation"];
const DEMO_TABS: readonly StrategyTab[] = [
  "accuracy",
  "speed",
  "thesis",
  "models",
  "guide",
  "evaluation",
];

function isStrategyTab(value: unknown): value is StrategyTab {
  return typeof value === "string" && STRATEGY_TABS.includes(value as StrategyTab);
}

export const Route = createFileRoute("/methodology")({
  validateSearch: (search: Record<string, unknown>): { tab?: StrategyTab } => ({
    tab: isStrategyTab(search.tab) ? search.tab : undefined,
  }),
  component: MethodPage,
});

function MethodPage() {
  const mode = useAppStore((s) => s.dataMode);
  const { result, status } = useForecast();
  const d = result?.diagnostics;
  const ready = Boolean(result);
  const requestedTab = Route.useSearch().tab;
  const navigate = Route.useNavigate();
  const allowedTabs = mode === "api" ? API_TABS : DEMO_TABS;
  const tab =
    requestedTab && allowedTabs.includes(requestedTab)
      ? requestedTab
      : mode === "api"
        ? "methodology"
        : "accuracy";

  function setTab(value: string) {
    if (isStrategyTab(value)) void navigate({ search: { tab: value }, hash: "" });
  }

  if (mode === "api") return <PythonMethods tab={tab} onTabChange={setTab} />;

  return (
    <div
      className={
        "page-enter mx-auto flex flex-col gap-6 " + (tab === "guide" ? "max-w-6xl" : "max-w-3xl")
      }
    >
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">Two strategies</h1>
        <p className="mt-2 text-muted">
          Accuracy is five reliability levels. Speed is five architecture techniques. They are
          separate on purpose — one does not substitute for the other. Live evidence on this page is
          taken from the current forecast run, not from slide copy.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setTab("accuracy")}
          className={
            tab === "accuracy"
              ? "rounded-2xl border border-primary/40 bg-primary/5 p-4 text-left"
              : "rounded-2xl border border-border bg-surface p-4 text-left hover:bg-surface-2"
          }
        >
          <p className="font-mono text-xs tracking-wide text-muted uppercase">Strategy 1</p>
          <p className="mt-1 font-display text-xl font-medium">Five levels</p>
          <p className="mt-1 text-sm text-muted">Accuracy and reliability when data are small.</p>
        </button>
        <button
          type="button"
          onClick={() => setTab("speed")}
          className={
            tab === "speed"
              ? "rounded-2xl border border-primary/40 bg-primary/5 p-4 text-left"
              : "rounded-2xl border border-border bg-surface p-4 text-left hover:bg-surface-2"
          }
        >
          <p className="font-mono text-xs tracking-wide text-muted uppercase">Strategy 2</p>
          <p className="mt-1 font-display text-xl font-medium">Five techniques</p>
          <p className="mt-1 text-sm text-muted">
            Speed and architecture so the dashboard stays usable.
          </p>
        </button>
      </div>

      <TrainingBanner />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
          <TabsTrigger value="speed">Speed</TabsTrigger>
          <TabsTrigger value="thesis">Thesis text</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="guide">User guide</TabsTrigger>
          <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
        </TabsList>

        <TabsContent value="accuracy">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Strategy 1 — five levels that keep forecasts trustworthy when the partner dataset is
              small or irregular.
            </p>
            {LEVELS.map((level) => (
              <Card key={level.id}>
                <CardHeader>
                  <p className="font-mono text-xs tracking-wide text-muted uppercase">
                    Level {level.id}
                  </p>
                  <CardTitle>{level.title}</CardTitle>
                  <CardDescription>{level.purpose}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <ul className="grid gap-1.5 text-muted">
                    {level.bullets.map((b) => (
                      <li key={b}>— {b}</li>
                    ))}
                  </ul>
                  {ready && d && <LevelEvidence id={level.id} />}
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted">{DISCLAIMER}</p>
          </div>
        </TabsContent>

        <TabsContent value="speed">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Strategy 2 — five techniques so the dashboard stays usable. Training never blocks a
              page load.
            </p>
            {TECHNIQUES.map((tech) => (
              <Card key={tech.id}>
                <CardHeader>
                  <p className="font-mono text-xs tracking-wide text-muted uppercase">
                    Technique {tech.id}
                  </p>
                  <CardTitle>{tech.title}</CardTitle>
                  <CardDescription>{tech.purpose}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <ul className="grid gap-1.5 text-muted">
                    {tech.bullets.map((b) => (
                      <li key={b}>— {b}</li>
                    ))}
                  </ul>
                  {ready && d && <TechniqueEvidence id={tech.id} />}
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader>
                <CardTitle>Retrain offline</CardTitle>
                <CardDescription>
                  Serving keeps the last cache. This button is the only explicit training trigger
                  besides a data change.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => {
                    invalidatePipelineCache();
                    requestBackgroundTrain(true);
                    toast.success(
                      "Background training started. Dashboard stays on the last cache.",
                    );
                  }}
                  disabled={status === "training"}
                >
                  {status === "training" ? "Training…" : "Retrain models"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="thesis">
          <ThesisPanel />
        </TabsContent>

        <TabsContent value="models">
          <ModelsPanel />
        </TabsContent>

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

function PythonMethods({
  tab,
  onTabChange,
}: {
  tab: StrategyTab;
  onTabChange: (value: string) => void;
}) {
  const { result, refresh, status, schedule } = useForecast();
  const settings = useAppStore((state) => state.settings);
  const { canRefreshForecast } = usePermissions();
  const refreshAdvice = forecastRefreshAdvice("api", canRefreshForecast, schedule);
  const scheduled = Boolean(forecastScheduleMessage("api", schedule));
  return (
    <div
      className={tab === "guide" ? "mx-auto grid max-w-6xl gap-6" : "mx-auto grid max-w-3xl gap-6"}
    >
      <header>
        <h1 className="font-display text-3xl">Strategies</h1>
        <p className="mt-2 text-muted">
          Explore the forecasting methodology, supporting thesis text, user guide, and system
          evaluation.
        </p>
      </header>
      <TrainingBanner />
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList
          className="w-full max-w-full justify-start overflow-x-auto"
          aria-label="Strategies sections"
        >
          <TabsTrigger className="shrink-0" value="methodology">
            Methodology
          </TabsTrigger>
          <TabsTrigger className="shrink-0" value="thesis">
            Thesis text
          </TabsTrigger>
          <TabsTrigger className="shrink-0" value="guide">
            User guide
          </TabsTrigger>
          <TabsTrigger className="shrink-0" value="evaluation">
            Evaluation
          </TabsTrigger>
        </TabsList>
        <TabsContent value="methodology">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Chronological model evaluation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  Training, validation, and final testing use separate consecutive date ranges.
                  Product ranking, eligibility, and parameter selection use training data only.
                  Later validation selects early stopping, ensemble weights, and the operating
                  method.
                </p>
                <p>
                  Moving Average and XGBoost predict the same final-test dates recursively from the
                  same cutoff. Test actuals are not fed back into those predictions. Aggregate
                  comparisons use the same eligible products.
                </p>
                <p>
                  Minimum training history: {settings.minWeeks} weeks and{" "}
                  {settings.minimumNonzeroDays} nonzero sales days. At most {settings.topNProducts}
                  products train with ML. Other products use the Python Moving Average fallback.
                </p>
                <p>
                  Configured cross-validation: {settings.cvFolds} chronological training folds, each
                  with a 14-day validation window. If training history cannot support all folds,
                  conservative parameters are used and zero effective folds are recorded.
                </p>
                <p>
                  Features: lag 1, lag 7, lag 14, mean 7, mean 30, weekday, and month. Only recorded
                  sales and explicitly confirmed-zero dates are targets. Product-specific reviews
                  override store-wide reviews; closures, incomplete dates, and stockouts are
                  excluded. Unknown calendar gaps make the affected forecast unavailable rather than
                  becoming zero.
                </p>
                <p>
                  Fallbacks use the contiguous usable tail and keep each product's own forecast
                  origin. Missing test dates remain unscored but still count as elapsed forecast
                  days. Without usable history at the test cutoff, baseline test metrics are
                  unavailable. Expired predictions are not moved forward by another product's newer
                  history; older saved baselines require a new forecast run.
                </p>
                <p>
                  After evaluation, the operating model is refitted on observed history with its
                  frozen configuration. When at least twenty validation observations exist, the
                  later portion is reserved for interval calibration after model selection. At least
                  ten residuals from this reserved portion are required. The selected operating
                  method's 10th and 90th residual quantiles form an interval with nominal 80%
                  coverage; final-test residuals never calibrate it. Saved final-test coverage
                  reports how often actual sales fell inside those bounds. This small-sample,
                  time-ordered estimate does not guarantee future coverage. Products without
                  calibration evidence show intervals as unavailable. Quality labels describe
                  evidence, not a probability of correctness.
                </p>
                <p className="text-muted">{result?.diagnostics.disclaimer}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Saved forecasts and responsive pages</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  Pages read saved PostgreSQL predictions.{" "}
                  {scheduled
                    ? "Daily automatic refresh and owner-requested Refresh queue"
                    : "Owner-requested Refresh queues"}{" "}
                  a separate Python worker; inventory and sales remain usable during training.
                  Official XGBoost model files are saved in the model volume.
                </p>
                <p>
                  {canRefreshForecast ? "Record or import new history" : "Record new sales history"}
                  , then {refreshAdvice}. The last completed run remains visible while the new run
                  is pending.
                </p>
                {canRefreshForecast && (
                  <Button
                    disabled={status === "training"}
                    onClick={() =>
                      void refresh().catch((error: Error) => toast.error(error.message))
                    }
                  >
                    Refresh forecasts
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="thesis">
          <ThesisPanel />
        </TabsContent>
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

function LevelEvidence({ id }: { id: number }) {
  const { result } = useForecast();
  const products = useAppStore((s) => s.products);
  const d = result?.diagnostics;
  if (!result || !d) return null;
  const name = (pid: string) => products.find((p) => p.id === pid)?.name ?? pid;

  if (id === 1) {
    return (
      <Evidence
        items={[
          `History: ${num(d.weeksCovered, 1)} weeks (minimum ${d.minWeeksRequired})`,
          d.meetsMinimum ? "Meets the 8-week floor" : "Below minimum — fallback path",
          d.reliableRange
            ? "Inside the 6–12 month reliable band"
            : "Outside 6–12 months — treat as a prototype, not a long-run model",
          `Grain: ${d.dailyProductCount} daily · ${d.weeklyProductCount} weekly (sparse >30% zeros)`,
          `ML scope: ${d.mlProductIds.length} of ${products.length} SKUs (top ${d.topN}, ≥100 non-zero days)`,
          d.usedFallbackDataset
            ? (d.fallbackReason ?? "Public retail fallback in use")
            : "Partner history used — no fallback",
        ]}
      />
    );
  }
  if (id === 2) {
    return (
      <Evidence
        items={[
          `Features: ${FEATURE_NAMES.join(", ")}`,
          d.avoidedProductIds
            ? "Product IDs are not features — category index only"
            : "Unexpected ID features",
        ]}
      />
    );
  }
  if (id === 3) {
    return (
      <Evidence
        items={[
          `max_depth ${d.maxDepth} · eta ${d.learningRate} · n_estimators cap ${d.nEstimatorsCap}`,
          `Trees used after early stopping: ${result.treesUsed}`,
          `TimeSeriesSplit folds: ${d.cvFolds} (not 5)`,
          d.chronologicalSplit ? "Chronological train / validation / holdout" : "Split error",
        ]}
      />
    );
  }
  if (id === 4) {
    return (
      <Evidence
        items={[
          `Ensemble used on ${d.ensembleUsedCount} SKUs`,
          `XGBoost unstable fallback: ${d.xgbUnstableCount} SKUs`,
          `Pooled winner: ${modelLabel(result.winner)}`,
          ...d.ruleProductIds
            .slice(0, 3)
            .map((id) => `${name(id)}: ${d.skippedReasons[id] ?? "rule"}`),
        ]}
      />
    );
  }
  return (
    <Evidence
      items={[
        `Low-confidence SKUs (<${30} observations): ${d.lowConfidenceCount}`,
        "Browser demonstration bands are illustrative; their coverage has not been validated.",
        d.disclaimer,
      ]}
    />
  );
}

function TechniqueEvidence({ id }: { id: number }) {
  const { result, status, progress } = useForecast();
  const d = result?.diagnostics;
  if (!result || !d) return null;

  if (id === 1) {
    return (
      <Evidence
        items={[
          `This view mode: ${d.mode === "train" ? "serving a trained cache" : "serving path (no XGBoost)"}`,
          `Job status: ${status}`,
          "Opening Overview / Restock / Forecasts never calls trainXgb",
        ]}
      />
    );
  }
  if (id === 2) {
    return (
      <Evidence
        items={[
          d.servingFromCache || d.mode === "train"
            ? `Cache hit · last processing ${result.trainedMs < 1000 ? `${result.trainedMs} ms` : `${(result.trainedMs / 1000).toFixed(1)}s`}`
            : "No trained cache yet — serving Moving Average",
          "Serialized forecasts live in memory + local cache (joblib analogue in the browser)",
        ]}
      />
    );
  }
  if (id === 3) {
    return (
      <Evidence
        items={[
          `Top N = ${d.topN}`,
          `Trained with ML: ${d.trainedProductCount}`,
          `Simple reorder rules: ${d.ruleProductIds.length}`,
        ]}
      />
    );
  }
  if (id === 4) {
    return (
      <Evidence
        items={[
          `n_splits = ${d.cvFolds} (configured ${CV_FOLDS})`,
          "Justified for short SME series",
        ]}
      />
    );
  }
  return (
    <Evidence
      items={[
        status === "training"
          ? `Background job: ${progress.message}`
          : "No training wait on this paint",
        "Cache refreshes for the next dashboard load",
      ]}
    />
  );
}

function Evidence({ items }: { items: string[] }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-3">
      <p className="mb-1 text-xs tracking-wide text-muted uppercase">This run</p>
      <ul className="grid gap-1 text-sm">
        {items.filter(Boolean).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ModelsPanel() {
  const { result } = useForecast();
  const ready = Boolean(result);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Moving Average</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-mono text-muted">MAₜ = (Dₜ₋₁ + … + Dₜ₋ₙ) / n</p>
          <p>
            Default window n = 7. Statistical baseline. Also the serving-path forecast and the
            fallback when XGBoost is unstable.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>XGBoost regressor</CardTitle>
          <CardDescription>
            Conservative boosting: shallow trees, reduced learning rate, L2, early stopping, 3-fold
            TimeSeriesSplit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-3">
            <Param k="max_depth" v={String(DEFAULT_XGB.maxDepth)} />
            <Param k="eta" v={String(DEFAULT_XGB.learningRate)} />
            <Param k="n_estimators" v={String(DEFAULT_XGB.nEstimators)} />
            <Param k="lambda" v={String(DEFAULT_XGB.lambda)} />
            <Param k="gamma" v={String(DEFAULT_XGB.gamma)} />
            <Param k="early_stop" v={String(DEFAULT_XGB.earlyStoppingRounds)} />
          </dl>
          <p className="text-muted">{FEATURE_NAMES.join(" · ")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Holdout comparison</CardTitle>
          <CardDescription>
            Same chronological holdout for Moving Average, XGBoost, and the weighted ensemble.
            {ready && result?.trainedMs
              ? ` Last processing ${result.trainedMs < 1000 ? `${result.trainedMs} ms` : `${(result.trainedMs / 1000).toFixed(1)}s`}.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">MAE</th>
                <th className="pb-2 font-medium">RMSE</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="py-2">Moving Average</td>
                <td className="tabular">{ready ? metric(result?.maMae) : "—"}</td>
                <td className="tabular">{ready ? metric(result?.maRmse) : "—"}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2">XGBoost</td>
                <td className="tabular">{ready ? metric(result?.xgbMae) : "—"}</td>
                <td className="tabular">{ready ? metric(result?.xgbRmse) : "—"}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2">Ensemble</td>
                <td className="tabular">{ready ? metric(result?.ensembleMae) : "—"}</td>
                <td className="tabular">{ready ? metric(result?.ensembleRmse) : "—"}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm text-muted">
            Better model on this run:{" "}
            <span className="font-medium text-fg">
              {!ready || !result ? "—" : modelLabel(result.winner)}
            </span>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory math</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-mono text-muted">ROP = (Dᴬ × L) + SS</p>
          <p className="font-mono text-muted">S = Dᴬ × (L + C) + SS · Q = S − I</p>
          <p>
            Dᴬ is average forecasted daily demand from the selected method (ensemble, MA, or a
            simple rule). Slow movers never enter the boosting job.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Param({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

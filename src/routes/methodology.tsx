import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useForecast } from "@/components/forecast-context";
import { ThesisPanel } from "@/components/thesis-panel";
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
import {
  ISO_ITEMS,
  emptyIsoScores,
  isoAverage,
  loadIsoScores,
  saveIsoScores,
  type IsoScores,
} from "@/lib/iso-eval";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/methodology")({ component: MethodPage });

function MethodPage() {
  const { result, status } = useForecast();
  const d = result?.diagnostics;
  const ready = Boolean(result);
  const [tab, setTab] = useState("accuracy");

  return (
    <div className="page-enter mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">Two strategies</h1>
        <p className="mt-2 text-muted">
          Accuracy is five reliability levels. Speed is five architecture techniques. They are
          separate on purpose — one does not substitute for the other. Live evidence on this page
          is taken from the current forecast run, not from slide copy.
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
          <p className="mt-1 text-sm text-muted">Speed and architecture so the dashboard stays usable.</p>
        </button>
      </div>

      <TrainingBanner />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
          <TabsTrigger value="speed">Speed</TabsTrigger>
          <TabsTrigger value="thesis">Thesis text</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="iso">ISO 25010</TabsTrigger>
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
                    toast.success("Background training started. Dashboard stays on the last cache.");
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

        <TabsContent value="iso">
          <IsoSurvey />
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
            ? d.fallbackReason ?? "Public retail fallback in use"
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
          ...d.ruleProductIds.slice(0, 3).map((id) => `${name(id)}: ${d.skippedReasons[id] ?? "rule"}`),
        ]}
      />
    );
  }
  return (
    <Evidence
      items={[
        `Low-confidence SKUs (<${30} observations): ${d.lowConfidenceCount}`,
        "Intervals: 10th / 50th / 90th on every chart",
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
            ? `Cache hit · last fit ${result.trainedMs < 1000 ? `${result.trainedMs} ms` : `${(result.trainedMs / 1000).toFixed(1)}s`}`
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
        items={[`n_splits = ${d.cvFolds} (configured ${CV_FOLDS})`, "Justified for short SME series"]}
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
              ? ` Last train ${result.trainedMs < 1000 ? `${result.trainedMs} ms` : `${(result.trainedMs / 1000).toFixed(1)}s`}.`
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

function IsoSurvey() {
  const [scores, setScores] = useState<IsoScores>(emptyIsoScores);
  const average = isoAverage(scores);

  useEffect(() => {
    setScores(loadIsoScores());
  }, []);

  function setScore(id: keyof IsoScores, value: number) {
    setScores((prev) => ({ ...prev, [id]: value }));
  }

  function save() {
    saveIsoScores(scores);
    toast.success("Saved ISO 25010 ratings for this session.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>System evaluation form</CardTitle>
        <CardDescription>
          Rate the prototype 1–5 on each ISO/IEC 25010:2023 characteristic.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 text-sm">
          <Iso
            k="Functional suitability"
            v="Forecasts, ensemble, ROP, restock quantities, confidence flags, CSV import."
          />
          <Iso
            k="Reliability"
            v="Chronological splits, early stopping, MA fallback, cached serving path."
          />
          <Iso
            k="Interaction capability"
            v="Owner language, restock queue first, confidence and disclaimer in plain words."
          />
          <Iso
            k="Performance efficiency"
            v="Dashboard serves cache immediately; XGBoost trains on top-N SKUs in the background."
          />
          <Iso
            k="Maintainability"
            v="Accuracy levels and speed techniques are separate modules from the dashboard."
          />
        </div>
        {ISO_ITEMS.map((item) => (
          <fieldset key={item.id} className="grid gap-2">
            <legend className="text-sm font-medium">{item.title}</legend>
            <p className="text-xs text-muted">{item.prompt}</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((n) => {
                const active = scores[item.id] === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setScore(item.id, n)}
                    className={
                      active
                        ? "flex size-11 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground"
                        : "flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium hover:bg-surface-2"
                    }
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Mean score:{" "}
            <span className="font-medium text-fg tabular">
              {average == null ? "—" : num(average, 2)} / 5
            </span>
          </p>
          <Button onClick={save}>Save ratings</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Iso({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="font-medium">{k}</p>
      <p className="text-muted">{v}</p>
    </div>
  );
}

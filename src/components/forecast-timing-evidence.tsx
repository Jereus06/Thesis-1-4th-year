import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatForecastDuration } from "@/lib/forecast-timing";
import type { ForecastTiming } from "@/lib/types";

export function ForecastTimingEvidence({ timing }: { timing?: ForecastTiming }) {
  const phases = [
    ["Preparation", timing?.preparationMs],
    ["Model training", timing?.trainingMs],
    ["Validation / evaluation", timing?.validationEvaluationMs],
    ["Result persistence", timing?.persistenceMs],
    ["Total processing", timing?.totalProcessingMs],
    ["Queue wait", timing?.queueWaitMs],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved processing times</CardTitle>
        <CardDescription>
          {timing?.timingVersion === "disjoint_phases_v1"
            ? "Saved times for preparing and checking this forecast. Model training includes every model fit. Total processing ends when results are saved; queue wait and timing publication are separate."
            : "How these times were measured was not saved for this forecast."}{" "}
          Unmeasured steps show as unavailable.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          {phases.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted">{label}</dt>
              <dd className="mt-1 font-mono tabular">{formatForecastDuration(value)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

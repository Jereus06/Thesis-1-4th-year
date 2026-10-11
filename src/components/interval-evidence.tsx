import { modelLabel } from "@/lib/forecast/constants";
import { num } from "@/lib/format";
import { intervalAvailability } from "@/lib/forecast-interval";
import type { ProductForecast } from "@/lib/types";

export function IntervalEvidence({
  forecast,
  mode,
  forecastThrough,
  refreshAdvice = "refresh forecasts",
}: {
  forecast: ProductForecast;
  mode: "api" | "browser-demo";
  forecastThrough?: string | null;
  refreshAdvice?: string;
}) {
  const interval = forecast.interval;
  const status = intervalAvailability(forecast, mode);
  if (mode === "browser-demo")
    return (
      <div
        className="mt-4 rounded-xl bg-surface-2 p-3 text-sm"
        aria-label="Prediction interval evidence"
      >
        <p className="font-medium">{status}</p>
        <p className="mt-1 text-muted">
          Browser demonstration bands illustrate uncertainty. They have no validated calibration
          sample or guaranteed coverage and are separate from saved Python forecast intervals.
        </p>
      </div>
    );

  const count = interval?.calibrationObservations;
  const coverage = interval?.finalTestCoverage;
  const testCount = interval?.finalTestObservations;
  const knownProtocol = interval?.calibrationSplit === "late_validation_reserved_after_selection";
  const validCoverage =
    coverage !== undefined &&
    coverage !== null &&
    Number.isFinite(coverage) &&
    coverage >= 0 &&
    coverage <= 1;
  const validNominal =
    interval?.nominalCoverage !== undefined &&
    Number.isFinite(interval.nominalCoverage) &&
    interval.nominalCoverage > 0 &&
    interval.nominalCoverage < 1;
  return (
    <div
      className="mt-4 rounded-xl bg-surface-2 p-3 text-sm"
      aria-label="Prediction interval evidence"
    >
      <p className="font-medium">{status}</p>
      {forecast.forecastExpired && interval?.available && (
        <p className="mt-1 text-muted">
          The saved forecast{forecastThrough ? ` ended on ${forecastThrough}` : " has expired"}.
          Calibration evidence below describes that saved run. For current evidence, {refreshAdvice}
          .
        </p>
      )}
      {!interval ? (
        <p className="mt-1 text-muted">
          {forecast.trainedWithMl
            ? "No calibration metadata was saved for this product. Existing bounds alone do not establish calibrated coverage."
            : "This baseline product has no saved interval calibration evidence. A point forecast can still be available without an interval."}
        </p>
      ) : (
        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted">Calibration sample</dt>
            <dd>
              {count === undefined ? "Observation count not saved" : `${num(count)} observations`}
              {!interval.available && knownProtocol && count !== undefined && count < 10
                ? " (at least 10 required)"
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Calibration dates</dt>
            <dd>
              {interval.calibrationStart && interval.calibrationEnd
                ? `${interval.calibrationStart} to ${interval.calibrationEnd}`
                : "Not saved / no calibration sample"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Model-selection sample</dt>
            <dd>
              {interval.selectionObservations === undefined
                ? "Observation count not saved"
                : `${num(interval.selectionObservations)} observations`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Interval method</dt>
            <dd>
              {interval.method
                ? `${interval.method} for ${modelLabel(forecast.method)}`
                : "Method not saved"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Nominal coverage</dt>
            <dd>
              {validNominal
                ? `${num(interval.nominalCoverage! * 100)}% target`
                : "Target not saved"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Saved residual offsets</dt>
            <dd>
              {interval.lowerResidual !== undefined &&
              interval.lowerResidual !== null &&
              interval.upperResidual !== undefined &&
              interval.upperResidual !== null &&
              Number.isFinite(interval.lowerResidual) &&
              Number.isFinite(interval.upperResidual)
                ? `${num(interval.lowerResidual, 2)} to ${num(interval.upperResidual, 2)} units`
                : "Not saved / no calibrated offsets"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Final-test coverage</dt>
            <dd>
              {validCoverage
                ? `${num(coverage! * 100, 1)}% of actual sales inside the bounds`
                : "Not available"}
              {testCount === undefined
                ? "; observation count not saved"
                : `; ${num(testCount)} final-test observations`}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-xs text-muted">
        {knownProtocol
          ? "Calibration uses separate late-validation residuals after model selection. Fixed 10th and 90th residual offsets are added across the forecast horizon and clipped at zero. A small, time-ordered sample does not guarantee future coverage. Final-test observations assess coverage and never tune these bounds. These bands describe observed sales, not unmet demand during stockouts."
          : "The calibration protocol is not saved or recognized. These records do not establish independently calibrated coverage or guaranteed future coverage. Observed sales may understate demand during stockouts."}
      </p>
    </div>
  );
}

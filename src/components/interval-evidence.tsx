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
      <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm" aria-label="Forecast range">
        <p className="font-medium">{status}</p>
        <p className="mt-1 text-muted">
          Sample range for demonstration; accuracy has not been checked.
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
    <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm" aria-label="Forecast range">
      <p className="font-medium">{status}</p>
      {forecast.forecastExpired && interval?.available && (
        <p className="mt-1 text-muted">
          The saved forecast{forecastThrough ? ` ended on ${forecastThrough}` : " has expired"}. To
          update it, {refreshAdvice}.
        </p>
      )}
      {!interval ? (
        <p className="mt-1 text-muted">
          {forecast.trainedWithMl
            ? "This range has not been checked against past sales."
            : "A sales estimate may be available even when a range is unavailable."}
        </p>
      ) : (
        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted">Range checked on</dt>
            <dd>
              {count === undefined ? "Not available" : `${num(count)} sales records`}
              {!interval.available && knownProtocol && count !== undefined && count < 10
                ? " (at least 10 required)"
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Range check dates</dt>
            <dd>
              {interval.calibrationStart && interval.calibrationEnd
                ? `${interval.calibrationStart} to ${interval.calibrationEnd}`
                : "Dates unavailable"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Target coverage</dt>
            <dd>
              {validNominal
                ? `${num(interval.nominalCoverage! * 100)}% target`
                : "Target not saved"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Past test coverage</dt>
            <dd>
              {validCoverage
                ? `${num(coverage! * 100, 1)}% of actual sales inside the bounds`
                : "Not available"}
              {testCount === undefined
                ? "; record count unavailable"
                : `; ${num(testCount)} tested sales records`}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-xs text-muted">
        {knownProtocol
          ? "Future sales may fall outside this range. Sales during stockouts may understate demand."
          : "Range accuracy could not be verified. Sales during stockouts may understate demand."}
      </p>
    </div>
  );
}

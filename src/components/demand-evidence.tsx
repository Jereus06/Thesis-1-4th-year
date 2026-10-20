import { num } from "@/lib/format";
import type { ForecastConfidence, ForecastEvidence } from "@/lib/types";

export type DemandEvidenceProps = {
  forecast?: {
    fallbackReason?: string;
    unavailableReason?: string;
    unknownDays?: number;
    excludedDays?: number;
    qualityWarnings?: string[];
    forecastEvidence?: ForecastEvidence;
    forecastConfidence?: ForecastConfidence;
  };
  fallbackReason?: string;
  unavailableReason?: string;
  unknownDays?: number;
  excludedDays?: number;
  qualityWarnings?: string[];
  forecastEvidence?: ForecastEvidence;
  forecastConfidence?: ForecastConfidence;
  compact?: boolean;
  className?: string;
};

function dayCount(value: number | undefined): string {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? num(value) : "not recorded";
}

function salesRecordReason(reason: string): string {
  const history = reason.match(
    /^Training history: (\d+)\/(\d+) classified calendar days, (\d+) nonzero days; requires a complete daily sequence, at least (\d+) training days and (\d+) nonzero days\.$/,
  );
  if (history)
    return `Sales history has ${history[1]} of ${history[2]} days checked, with sales on ${history[3]} days. A full daily record, at least ${history[4]} days of history and ${history[5]} days with sales are needed.`;
  if (/^Not enough (?:nonzero training days|training observations)/.test(reason))
    return "More complete sales history is needed for this product.";
  if (/^XGBoost evaluation requires|^Calendar history is incomplete/.test(reason))
    return "Some dates have missing records or could not be used. Review the sales records.";
  const outsideTop = reason.match(
    /^Outside top (\d+) eligible products by training-period sales volume \(rank (\d+)\); Moving Average fallback\.$/,
  );
  if (outsideTop)
    return `This product ranked ${outsideTop[2]} in past sales, outside the top ${outsideTop[1]} products selected. A basic estimate is used.`;
  if (reason === "Refresh forecasts to evaluate this product")
    return "Refresh forecasts to check this product's estimate.";
  if (/^No usable (?:sales|demand) history/.test(reason))
    return "No sales history is ready to use. Check sales records and review missing days.";
  if (/^No usable current predictions/.test(reason))
    return "No current sales estimate. Check sales records and refresh forecasts.";
  if (reason === "Business date changed. Waiting for current recommendations.")
    return "A new day has started. Waiting for current recommendations.";
  if (/^Saved baseline uses an older calendar policy/.test(reason))
    return "Refresh forecasts to update this older estimate.";
  if (/^Serving (?:cached path|path)/.test(reason))
    return "Forecasts are updating. A basic estimate is shown for now.";
  if (/^XGBoost unstable/.test(reason))
    return "The forecast was unreliable, so a basic estimate is shown.";
  return reason;
}

function confidenceReason(reason: string): string {
  const errorDays = reason.match(
    /^(Low|Moderate|Large) past error across (\d+) consecutive tested days\./,
  );
  if (errorDays)
    return `${errorDays[1] === "Low" ? "Small" : errorDays[1]} errors in tests across ${errorDays[2]} days in a row.${errorDays[1] === "Large" ? " Check the estimate before ordering." : ""}`;
  if (reason === "No usable saved past test yet. Treat this estimate with care.")
    return "Not tested on past sales yet. Use this estimate with care.";
  const shortTest = reason.match(/^Only (\d+) past test days/);
  if (shortTest)
    return `Only ${shortTest[1]} days have been tested; at least 14 are needed for a stronger confidence rating.`;
  if (/^The past test has gaps/.test(reason))
    return "The test has missing days. At least 14 days in a row are needed for a stronger confidence rating.";
  if (/^The past test contains no sales/.test(reason))
    return "There were no sales during the test, so the confidence rating is limited.";
  return reason;
}

export function DemandEvidence({
  forecast,
  fallbackReason,
  unavailableReason,
  unknownDays,
  excludedDays,
  qualityWarnings,
  forecastEvidence,
  forecastConfidence,
  compact = false,
  className = "space-y-1 text-xs text-muted",
}: DemandEvidenceProps) {
  const reason = fallbackReason ?? forecast?.fallbackReason;
  const unavailable = unavailableReason ?? forecast?.unavailableReason;
  const evidence = forecastEvidence ?? forecast?.forecastEvidence;
  const confidence = forecastConfidence ?? forecast?.forecastConfidence;
  const missingDays = unknownDays ?? forecast?.unknownDays;
  const skippedDays = excludedDays ?? forecast?.excludedDays;
  const missingCount = dayCount(missingDays);
  const skippedCount = dayCount(skippedDays);
  const relativeError = confidence?.relativeError == null ? NaN : Number(confidence.relativeError);
  const warnings = [...new Set(qualityWarnings ?? forecast?.qualityWarnings ?? [])].filter(
    (warning) => warning.trim() && warning !== reason && warning !== unavailable,
  );
  const reasonText = reason ? salesRecordReason(reason) : undefined;
  const unavailableText = unavailable ? salesRecordReason(unavailable) : undefined;
  const confidenceText = confidence?.reason ? confidenceReason(confidence.reason) : undefined;
  const hasRelativeError =
    confidence?.level && Number.isFinite(relativeError) && relativeError >= 0;
  const shortenedTest =
    evidence &&
    Number.isInteger(evidence.testObservations) &&
    evidence.testObservations > 0 &&
    evidence.requestedHorizonDays !== undefined &&
    Number.isInteger(evidence.requestedHorizonDays) &&
    evidence.testObservations < evidence.requestedHorizonDays;
  const shortenedNotice = shortenedTest
    ? `Accuracy checked on ${num(evidence.testObservations)} of the requested ${num(evidence.requestedHorizonDays!)} days. Test evidence is limited.`
    : undefined;
  const measurements = (
    <>
      {confidenceText && <p>{confidenceText}</p>}
      {evidence && evidence.testObservations > 0 && evidence.mae !== null && (
        <p>
          {shortenedNotice && !compact ? (
            `${shortenedNotice} `
          ) : (
            <>
              Tested on {num(evidence.testObservations)} past{" "}
              {evidence.testObservations === 1 ? "day" : "days"}.{" "}
            </>
          )}
          Average error: {num(Number(evidence.mae), 1)} units.
          {evidence.status === "needs_refresh" && " Results are from an older forecast."}
        </p>
      )}
      {hasRelativeError && (
        <p>Past error compared with actual sales: {num(relativeError * 100, 1)}%.</p>
      )}
    </>
  );
  const notices = (
    <>
      {unavailableText && <p>Sales estimate unavailable: {unavailableText}</p>}
      {reasonText && reason !== unavailable && (
        <p>
          {unavailable ? "Sales records: " : "Using a basic estimate: "}
          {reasonText}
        </p>
      )}
    </>
  );
  const recordCounts = (
    <p>
      Days with missing records: {missingCount} · Days left out: {skippedCount}
    </p>
  );
  const qualityNotices = warnings.map((warning) => (
    <p key={warning}>
      Check sales records:{" "}
      {warning === "Confirmed-zero classification kept recorded sales for this date."
        ? "A date marked 'no sales' has recorded sales. Those sales were kept."
        : warning}
    </p>
  ));
  if (compact) {
    const hasDetails =
      confidenceText ||
      (evidence && evidence.testObservations > 0 && evidence.mae !== null) ||
      hasRelativeError ||
      missingDays !== undefined ||
      skippedDays !== undefined;
    return (
      <div className={className}>
        {notices}
        {shortenedNotice && evidence && evidence.mae !== null && <p>{shortenedNotice}</p>}
        {qualityNotices}
        {hasDetails && (
          <details>
            <summary className="cursor-pointer font-medium text-primary">Forecast details</summary>
            <div className="mt-2 space-y-1">
              {measurements}
              {recordCounts}
            </div>
          </details>
        )}
      </div>
    );
  }
  return (
    <div className={className}>
      {measurements}
      {notices}
      {recordCounts}
      {qualityNotices}
    </div>
  );
}

import { num } from "@/lib/format";
import type { ForecastEvidence } from "@/lib/types";

export type DemandEvidenceProps = {
  forecast?: {
    fallbackReason?: string;
    unavailableReason?: string;
    unknownDays?: number;
    excludedDays?: number;
    qualityWarnings?: string[];
    forecastEvidence?: ForecastEvidence;
  };
  fallbackReason?: string;
  unavailableReason?: string;
  unknownDays?: number;
  excludedDays?: number;
  qualityWarnings?: string[];
  forecastEvidence?: ForecastEvidence;
  className?: string;
};

function dayCount(value: number | undefined): string {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? num(value) : "not saved";
}

export function DemandEvidence({
  forecast,
  fallbackReason,
  unavailableReason,
  unknownDays,
  excludedDays,
  qualityWarnings,
  forecastEvidence,
  className = "space-y-1 text-xs text-muted",
}: DemandEvidenceProps) {
  const reason = fallbackReason ?? forecast?.fallbackReason;
  const unavailable = unavailableReason ?? forecast?.unavailableReason;
  const evidence = forecastEvidence ?? forecast?.forecastEvidence;
  const warnings = [...new Set(qualityWarnings ?? forecast?.qualityWarnings ?? [])].filter(
    (warning) => warning.trim() && warning !== reason && warning !== unavailable,
  );
  return (
    <div className={className}>
      {evidence && evidence.testObservations > 0 && evidence.mae !== null && (
        <p>
          Past test: {num(evidence.testObservations)}{" "}
          {evidence.testObservations === 1 ? "day" : "days"}. Average error:{" "}
          {num(Number(evidence.mae), 1)} units.
          {evidence.status === "needs_refresh" && " These results belong to the older saved run."}
        </p>
      )}
      {unavailable && <p>Demand unavailable: {unavailable}</p>}
      {reason && reason !== unavailable && <p>Fallback reason: {reason}</p>}
      <p>
        Unknown days: {dayCount(unknownDays ?? forecast?.unknownDays)} · Excluded days:{" "}
        {dayCount(excludedDays ?? forecast?.excludedDays)}
      </p>
      {warnings.map((warning) => (
        <p key={warning}>Data quality: {warning}</p>
      ))}
    </div>
  );
}

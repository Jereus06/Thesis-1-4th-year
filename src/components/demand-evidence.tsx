import { num } from "@/lib/format";

export type DemandEvidenceProps = {
  forecast?: {
    fallbackReason?: string;
    unavailableReason?: string;
    unknownDays?: number;
    excludedDays?: number;
    qualityWarnings?: string[];
  };
  fallbackReason?: string;
  unavailableReason?: string;
  unknownDays?: number;
  excludedDays?: number;
  qualityWarnings?: string[];
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
  className = "space-y-1 text-xs text-muted",
}: DemandEvidenceProps) {
  const reason = fallbackReason ?? forecast?.fallbackReason;
  const unavailable = unavailableReason ?? forecast?.unavailableReason;
  const warnings = [...new Set(qualityWarnings ?? forecast?.qualityWarnings ?? [])].filter(
    (warning) => warning.trim() && warning !== reason && warning !== unavailable,
  );
  return (
    <div className={className}>
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

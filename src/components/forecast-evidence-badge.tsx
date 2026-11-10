import { Badge } from "@/components/ui/badge";
import type { ForecastConfidence, ForecastEvidence } from "@/lib/types";

const labels = {
  tested: [
    "Tested on past sales",
    "Past test results are available. Future sales can still differ.",
  ],
  basic: ["Basic estimate", "Based on recent sales; accuracy has not been checked yet."],
  untested: ["Not tested yet", "Accuracy has not been checked yet."],
  needs_refresh: ["Refresh needed", "Records or settings changed after this estimate was saved."],
  unavailable: ["No current estimate", "Review the sales history and the reason shown below."],
  expired: ["Expired forecast", "The saved forecast period has ended."],
} as const;

export function ForecastEvidenceBadge({
  evidence,
  confidence,
  demonstration = false,
}: {
  evidence?: ForecastEvidence;
  confidence?: ForecastConfidence;
  demonstration?: boolean;
}) {
  if (demonstration)
    return (
      <Badge variant="outline" title="Sample data for demonstration.">
        Demonstration
      </Badge>
    );
  const stateWarning =
    evidence && ["needs_refresh", "unavailable", "expired"].includes(evidence.status);
  if (!stateWarning && confidence?.policy === "past_test_wape_v1" && confidence.level) {
    const label = {
      high: "High confidence",
      medium: "Medium confidence",
      low: "Low confidence",
    }[confidence.level];
    return (
      <Badge
        variant={
          confidence.level === "high"
            ? "success"
            : confidence.level === "low"
              ? "warning"
              : "outline"
        }
        title={confidence.reason + " Future sales may differ."}
      >
        {label}
      </Badge>
    );
  }
  const [label, explanation] = evidence
    ? labels[evidence.status]
    : ["Test results unavailable", "Refresh forecasts to load past test results."];
  return (
    <Badge variant={stateWarning ? "warning" : "outline"} title={explanation}>
      {label}
    </Badge>
  );
}

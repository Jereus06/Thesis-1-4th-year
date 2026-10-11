import { Badge } from "@/components/ui/badge";
import type { ForecastEvidence } from "@/lib/types";

const labels = {
  tested: [
    "Tested on past sales",
    "Past test results are available. Future sales can still differ.",
  ],
  basic: ["Basic estimate", "Uses recent usable sales. No saved past test is available."],
  untested: ["Not tested yet", "No usable saved past test is available for this estimate."],
  needs_refresh: ["Refresh needed", "Records or settings changed after this estimate was saved."],
  unavailable: ["No current estimate", "Review the sales history and the reason shown below."],
  expired: ["Expired forecast", "The saved forecast period has ended."],
} as const;

export function ForecastEvidenceBadge({
  evidence,
  demonstration = false,
}: {
  evidence?: ForecastEvidence;
  demonstration?: boolean;
}) {
  if (demonstration)
    return (
      <Badge variant="outline" title="Synthetic demonstration; not measured client accuracy.">
        Demonstration
      </Badge>
    );
  const [label, explanation] = evidence
    ? labels[evidence.status]
    : ["Evidence unavailable", "Refresh forecasts to load their saved test evidence."];
  const warning = evidence && ["needs_refresh", "unavailable", "expired"].includes(evidence.status);
  return (
    <Badge variant={warning ? "warning" : "outline"} title={explanation}>
      {label}
    </Badge>
  );
}

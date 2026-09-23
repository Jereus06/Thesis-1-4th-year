import { Badge } from "@/components/ui/badge";
import { confidenceLabel } from "@/lib/forecast/constants";
import type { ConfidenceLevel } from "@/lib/types";

export function ConfidenceBadge({ level, score }: { level: ConfidenceLevel; score?: number }) {
  const variant = level === "high" ? "success" : level === "medium" ? "warning" : "danger";
  return (
    <Badge variant={variant}>
      {confidenceLabel(level)}
      {score != null ? ` · ${score}` : ""}
    </Badge>
  );
}

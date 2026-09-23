import { Badge } from "@/components/ui/badge";
import type { StockStatus } from "@/lib/types";

const copy: Record<StockStatus, { label: string; variant: "danger" | "warning" | "success" | "default" }> = {
  stockout: { label: "Stockout", variant: "danger" },
  reorder: { label: "Reorder now", variant: "warning" },
  watch: { label: "Watch", variant: "default" },
  healthy: { label: "Healthy", variant: "success" },
};

export function StatusBadge({ status }: { status: StockStatus }) {
  const item = copy[status];
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

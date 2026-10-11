import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type DataQualityClassification, type DataQualityEntry } from "@/lib/api";
import { todayISO } from "@/lib/dates";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export const Route = createFileRoute("/data-quality")({ component: DataQualityPage });
const LABELS: Record<DataQualityClassification, string> = {
  confirmed_zero: "Confirmed zero sales",
  business_closed: "Business closed",
  full_stockout: "Full stockout",
  partial_stockout: "Partial stockout",
  incomplete: "Missing / incomplete records",
};

function DataQualityPage() {
  const { session, products, dataMode } = useAppStore();
  const { canReviewDataQuality } = usePermissions();
  const [rows, setRows] = useState<DataQualityEntry[]>([]);
  const [date, setDate] = useState(todayISO());
  const [productId, setProductId] = useState("");
  const [classification, setClassification] = useState<DataQualityClassification>("incomplete");
  const [note, setNote] = useState("");
  const load = () => session && api.dataQuality(session.businessId).then(setRows);
  useEffect(() => {
    if (dataMode === "api" && session)
      void api
        .dataQuality(session.businessId)
        .then(setRows)
        .catch((e: Error) => toast.error(e.message));
  }, [dataMode, session]);
  if (dataMode !== "api")
    return (
      <p>
        Data-quality corrections are available in the PostgreSQL application. Browser demonstration
        records remain isolated.
      </p>
    );
  if (!session) return null;
  const save = async () => {
    if (!canReviewDataQuality) return;
    await api.saveDataQuality(session.businessId, {
      productId: productId || null,
      classificationDate: date,
      classification,
      note: note.trim() || null,
    });
    toast.success("Classification saved with an audit entry.");
    setNote("");
    await load();
  };
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="font-display text-3xl">Data quality</h1>
        <p className="mt-2 text-muted">
          Classify dates before forecasting. An absent transaction is not automatically a zero-sale
          day.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Record a classification</CardTitle>
          <CardDescription>
            Choose “all products” for a closure or store-wide incomplete ledger. Product-specific
            classifications take precedence during review. Every change is retained in the audit
            export.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="quality-date">Date</Label>
            <Input
              id="quality-date"
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="quality-product">Product</Label>
            <Select
              id="quality-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                  {p.isActive === false ? " (inactive)" : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="quality-kind">Classification</Label>
            <Select
              id="quality-kind"
              value={classification}
              onChange={(e) => setClassification(e.target.value as DataQualityClassification)}
            >
              {Object.entries(LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="quality-note">Evidence / note</Label>
            <Input
              id="quality-note"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional source or correction reason"
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            {canReviewDataQuality && (
              <Button onClick={() => void save().catch((e: Error) => toast.error(e.message))}>
                Save classification
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                window.location.assign(api.exportUrl(session.businessId, "data-quality"))
              }
            >
              Export audit CSV
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reviewed dates</CardTitle>
          <CardDescription>
            {rows.length
              ? `${rows.length} current classifications. Stockouts and incomplete dates should not be interpreted as observed zero demand.`
              : "No dates have been classified. The account remains empty until you add records."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div>
                  <p className="font-medium">
                    {row.classificationDate} · {LABELS[row.classification]}
                  </p>
                  <p className="text-sm text-muted">
                    {row.productName ? `${row.sku} — ${row.productName}` : "All products"}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                {canReviewDataQuality && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void api
                        .deleteDataQuality(
                          session.businessId,
                          row.productId,
                          row.classificationDate,
                        )
                        .then(load)
                        .catch((e: Error) => toast.error(e.message))
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-muted">
        Confirmed zeros are explicit observations. Closures, incomplete records, and full or partial
        stockouts are excluded from demand targets because recorded sales may understate demand.
        Eligible forecasts can show prediction intervals from at least ten separate late-validation
        residuals. The Forecast evaluation page shows each product's calibration evidence and
        interval availability; nominal coverage is a target, not a guarantee.
      </p>
    </div>
  );
}

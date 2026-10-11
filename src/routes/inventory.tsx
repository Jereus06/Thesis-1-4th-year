import { createFileRoute } from "@tanstack/react-router";
import { AccountAccessCard } from "@/components/account-access-card";
import { AccountMaintenance } from "@/components/account-maintenance";
import { ProductsPanel } from "@/components/products-panel";
import { StockMovementsPanel } from "@/components/stock-movements-panel";
import { SalesLedgerCard } from "@/components/sales-ledger-card";
import { CsvImporter } from "@/components/csv-importer";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShort, parseDate } from "@/lib/dates";
import { useAppStore } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { CSV_API_ROW_LIMITS } from "@/lib/csv-preparation";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/inventory")({ component: InventoryPage });

function InventoryPage() {
  const { canManageSettings } = usePermissions();
  const mode = useAppStore((s) => s.dataMode);
  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">Inventory & records</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Products, lead times, and safety stock drive reorder points. Sales history is the only
          input the models need.
        </p>
      </header>
      <Tabs defaultValue="products">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="sales">Sales ledger</TabsTrigger>
          <TabsTrigger value="movements">Stock movements</TabsTrigger>
          <TabsTrigger value="settings">
            {canManageSettings ? "Account & settings" : "Account"}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductsPanel />
        </TabsContent>
        <TabsContent value="sales">
          <SalesPanel />
        </TabsContent>
        <TabsContent value="movements">
          <StockMovementsPanel />
        </TabsContent>
        <TabsContent value="settings">
          <div className="grid gap-6">
            <AccountAccessCard />
            {canManageSettings && <SettingsPanel />}
            {mode === "api" && <AccountMaintenance />}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SalesPanel() {
  const { canImportRecords } = usePermissions();
  const session = useAppStore((state) => state.session);
  return (
    <div className={`grid gap-4 ${canImportRecords ? "lg:grid-cols-[1.2fr_1fr]" : ""}`}>
      <SalesLedgerCard key={session ? `${session.businessId}:${session.userId}` : "browser-demo"} />
      {canImportRecords && <SalesImportCard />}
    </div>
  );
}

function SalesImportCard() {
  const { canImportRecords } = usePermissions();
  const products = useAppStore((s) => s.products);
  const importSales = useAppStore((s) => s.importSales);
  const session = useAppStore((s) => s.session);
  const mode = useAppStore((s) => s.dataMode);

  async function importPreparedRows(rows: Sale[], originalFilename?: string) {
    if (!canImportRecords) throw new Error("Only an owner can import sales records.");
    try {
      const result = await importSales(rows, originalFilename);
      const skipped = result.errors.filter(
        (error) => error.code === "duplicate_source_record_key",
      ).length;
      const conflicts = result.errors.filter(
        (error) => error.code === "source_record_key_conflict",
      );
      const otherRejected = result.rejectedRows - skipped - conflicts.length;
      const firstOtherError = result.errors.find(
        (error) =>
          error.code !== "duplicate_source_record_key" &&
          error.code !== "source_record_key_conflict",
      );
      const messages = [`Imported ${result.acceptedRows} sales rows.`];
      if (skipped) messages.push(`${skipped} already imported rows skipped.`);
      if (conflicts.length)
        messages.push(
          `${conflicts.length} rows have conflicting Source Record Keys (first at row ${conflicts[0].row}).`,
        );
      if (otherRejected)
        messages.push(
          `${otherRejected} rows rejected${firstOtherError ? ` (row ${firstOtherError.row}: ${firstOtherError.code.replaceAll("_", " ")})` : ""}.`,
        );
      if (result.rejectedRows) {
        toast.warning(messages.join(" "), {
          description: "Your CSV is kept. Review skipped and rejected rows before retrying.",
        });
      } else {
        toast.success(messages.join(" "));
      }
      return result.rejectedRows === 0;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
      throw error;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import CSV</CardTitle>
        <CardDescription>
          Upload your file to automatically find sale dates, products, and quantities. Extra columns
          are ignored. The prepared records appear below, ready to import when valid.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <CsvImporter
          key={session ? `${session.businessId}:${session.userId}` : "browser-demo"}
          kind="sales"
          products={products}
          rowLimit={mode === "api" ? CSV_API_ROW_LIMITS.sales : null}
          importLabel="Upload CSV"
          placeholder={
            "2026-09-18,Lucky Me Pancit Canton,12\n2026-09-18,Nature Spring Water 500ml,20"
          }
          onImport={importPreparedRows}
        />
        <p className="text-sm text-muted">
          Use a stable Source Record Key unique to each sale line and reuse it on retries or
          overlapping imports. Separate sales need different keys even when their date, product, and
          quantity match. Without a key, overlapping records cannot be identified.
        </p>
      </CardContent>
    </Card>
  );
}

function SettingsPanel() {
  const { canManageSettings } = usePermissions();
  const settings = useAppStore((s) => s.settings);
  const sales = useAppStore((s) => s.sales);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const mode = useAppStore((s) => s.dataMode);
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const edit = (patch: Partial<typeof settings>) =>
    setDraft((current) => ({ ...current, ...patch }));
  async function saveSettings() {
    if (!canManageSettings || saving) return;
    setSaving(true);
    try {
      await updateSettings(draft);
      toast.success("Settings saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  const history = useMemo(() => getSalesHistory(sales), [sales]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store & model settings</CardTitle>
        <CardDescription>
          Business planning settings are separated from advanced forecasting controls.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-4">
        <div className="grid gap-1.5">
          <Label>Store name</Label>
          <Input value={draft.storeName} onChange={(e) => edit({ storeName: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Location</Label>
          <Input
            value={draft.storeLocation}
            onChange={(e) => edit({ storeLocation: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Forecast horizon</Label>
          <Select
            value={String(draft.forecastHorizon)}
            onChange={(e) => edit({ forecastHorizon: Number(e.target.value) })}
          >
            {[7, 14, 21, 30].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Cover days after delivery</Label>
          <Select
            value={String(draft.coverDays)}
            onChange={(e) => edit({ coverDays: Number(e.target.value) })}
          >
            {[3, 7, 10, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <p className="text-sm font-medium">
            {history.limited ? "Limited history" : "Available sales history"}
          </p>
          {history.start && history.end ? (
            <>
              <p className="mt-1 text-sm">
                {formatShort(history.start)}, {parseDate(history.start).getFullYear()} –{" "}
                {formatShort(history.end)}, {parseDate(history.end).getFullYear()}
              </p>
              <p className="text-sm text-muted">
                {history.days} days / about {history.months} month{history.months === 1 ? "" : "s"}
              </p>
              {history.limited && (
                <p className="mt-2 text-sm text-warning">
                  Only about {history.weeks} week{history.weeks === 1 ? "" : "s"} of sales are
                  available. XGBoost eligibility may be unavailable and a simpler forecasting method
                  may be used.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-warning">
              No sales history is available. Add or import sales before forecasting.
            </p>
          )}
        </div>
        <div className="grid gap-4 rounded-xl border border-border p-4">
          <div>
            <p className="font-medium">Advanced forecasting settings</p>
            <p className="text-sm text-muted">
              Model controls for forecast experiments and eligibility.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label>Moving Average window (days)</Label>
            <Select
              value={String(draft.maWindow)}
              onChange={(e) => edit({ maWindow: Number(e.target.value) })}
            >
              {[3, 7, 14].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>ML product limit</Label>
            <Select
              value={String(draft.topNProducts)}
              onChange={(e) => edit({ topNProducts: Number(e.target.value) })}
            >
              {[5, 8, 12, 20].map((n) => (
                <option key={n} value={n}>
                  Top {n} eligible products
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted">
              This is the maximum ML scope. Products must still pass data sufficiency and
              eligibility checks.
            </p>
          </div>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {mode === "browser-demo" && (
          <Button
            variant="outline"
            onClick={() => {
              resetDemo();
              toast.success("Demo data restored.");
            }}
          >
            Reset demo data
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function getSalesHistory(sales: Sale[]) {
  if (!sales.length) return { start: "", end: "", days: 0, weeks: 0, months: 0, limited: true };
  let start = "";
  let end = "";
  for (const { date } of sales) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!start || date < start) start = date;
    if (!end || date > end) end = date;
  }
  if (!start) return { start: "", end: "", days: 0, weeks: 0, months: 0, limited: true };
  const days = Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1;
  return {
    start,
    end,
    days,
    weeks: Math.max(1, Math.round(days / 7)),
    months: Math.max(1, Math.round(days / 30.44)),
    limited: days < 56,
  };
}

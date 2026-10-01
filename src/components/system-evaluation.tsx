import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ISO_ITEMS,
  accountIsoStorageKey,
  emptyIsoScores,
  isoAverage,
  loadIsoScores,
  saveIsoScores,
  type IsoScores,
} from "@/lib/iso-eval";
import { num } from "@/lib/format";
import { useAppStore } from "@/lib/store";

const ratingLabels = ["Poor", "Fair", "Good", "Very good", "Excellent"];

export function SystemEvaluation() {
  const mode = useAppStore((state) => state.dataMode);
  const session = useAppStore((state) => state.session);
  if (mode === "api" && !session) return <p>Sign in to open the evaluation form.</p>;
  const storageKey =
    mode === "api" && session
      ? accountIsoStorageKey(session.businessId, session.userId)
      : undefined;
  return <EvaluationForm key={storageKey ?? "browser-demo"} storageKey={storageKey} />;
}

function EvaluationForm({ storageKey }: { storageKey?: string }) {
  const [scores, setScores] = useState<IsoScores>(() => loadIsoScores(storageKey));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const average = isoAverage(scores);
  const answered = ISO_ITEMS.filter((item) => scores[item.id] > 0).length;

  function setScore(id: keyof IsoScores, value: number) {
    setScores((previous) => ({ ...previous, [id]: value }));
    setError("");
    setSaved(false);
  }

  function save() {
    try {
      saveIsoScores(scores, storageKey);
      setError("");
      setSaved(true);
      toast.success("Ratings saved in this browser.");
    } catch {
      setSaved(false);
      setError("Unable to save ratings. Check this browser's storage permissions and try again.");
      toast.error("Ratings could not be saved.");
    }
  }

  function clearForm() {
    setScores(emptyIsoScores());
    setError("");
    setSaved(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>System evaluation form</CardTitle>
        <CardDescription>
          Rate StockCast on the five selected quality characteristics from the earlier ISO 25010
          evaluation form. Choose a score from 1 (Poor) to 5 (Excellent).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
          Save ratings keeps a draft in this browser
          {storageKey ? " for your signed-in account" : " for the demonstration"}. Save before
          leaving this tab. Use the same device and browser to reopen the draft. These ratings are
          not uploaded to the server.
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Rating scale">
          {ratingLabels.map((label, index) => (
            <span key={label}>
              {index + 1} — {label}
            </span>
          ))}
        </div>
        {ISO_ITEMS.map((item) => (
          <fieldset key={item.id} className="grid gap-2">
            <legend className="text-sm font-medium">{item.title}</legend>
            <p id={"evaluation-prompt-" + item.id} className="text-sm text-muted">
              {item.prompt}
            </p>
            <div className="flex flex-wrap gap-2">
              {ratingLabels.map((label, index) => {
                const value = index + 1;
                const active = scores[item.id] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    aria-label={item.title + ": " + value + " — " + label}
                    aria-describedby={"evaluation-prompt-" + item.id}
                    onClick={() => setScore(item.id, value)}
                    className={
                      active
                        ? "flex size-11 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground focus-visible:outline-primary"
                        : "flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium hover:bg-surface-2 focus-visible:outline-primary"
                    }
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-sm" role="status">
            <p>
              Mean score:{" "}
              <span className="font-medium tabular">
                {average == null ? "—" : num(average, 2)} / 5
              </span>
            </p>
            <p className="text-xs text-muted">
              {answered} of {ISO_ITEMS.length} criteria scored. The mean uses scored criteria only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={clearForm}>
              Clear form
            </Button>
            <Button onClick={save}>Save ratings</Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-primary">
            Saved in this browser.
          </p>
        )}
        <p className="text-xs text-muted">
          This form records feedback on selected characteristics. It does not certify standards
          compliance or establish completed research results.
        </p>
      </CardContent>
    </Card>
  );
}

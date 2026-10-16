import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";

/** A failed follow-up read must never describe a committed import as a failed write. */
export function ImportRefreshNotice() {
  const warning = useAppStore((state) => state.importRefreshWarning);
  const reconnect = useAppStore((state) => state.connectApi);
  const [loading, setLoading] = useState(false);
  if (!warning) return null;
  return (
    <div className="grid gap-2 rounded-xl border border-warning p-3 text-sm" role="alert">
      <p>{warning}</p>
      <Button
        variant="outline"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            await reconnect();
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? "Reloading…" : "Reload saved records"}
      </Button>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const errorMessages: Record<string, string> = {
  google_denied: "Google sign-in was cancelled. You can try again or use your password.",
  google_expired: "This Google sign-in request expired. Start again from StockCast.",
  google_account_exists:
    "This email already has a StockCast account. Sign in with your password, then connect Google in Inventory > Settings.",
  google_link_conflict:
    "This Google account or StockCast account is already connected to a different account.",
  google_link_expired:
    "Your session expired before Google could be connected. Sign in again, then reconnect Google in Inventory > Settings.",
  google_failed: "Google sign-in could not be completed. Please try again.",
};

export function AuthCallbackNotice({ signedIn }: { signedIn: boolean }) {
  const [notice, setNotice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("auth_error");
    const result = params.get("auth");
    if (error) {
      return {
        error: true,
        message: errorMessages[error] ?? "Google sign-in could not be completed. Please try again.",
      };
    }
    if (result === "google-linked")
      return { error: false, message: "Google is connected to your StockCast account." };
    if (result === "google") return { error: false, message: "You are signed in with Google." };
    return null;
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("auth") && !url.searchParams.has("auth_error")) return;
    url.searchParams.delete("auth");
    url.searchParams.delete("auth_error");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);

  if (!notice || (!notice.error && !signedIn)) return null;
  return (
    <div
      role={notice.error ? "alert" : "status"}
      className={
        signedIn
          ? "fixed inset-x-4 top-4 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm shadow-lg"
          : "mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm"
      }
    >
      <p className={notice.error ? "flex-1 text-danger" : "flex-1"}>{notice.message}</p>
      <Button type="button" variant="ghost" size="sm" onClick={() => setNotice(null)}>
        Dismiss
      </Button>
    </div>
  );
}

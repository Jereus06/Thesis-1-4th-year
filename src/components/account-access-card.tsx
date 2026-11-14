import { useEffect, useState } from "react";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type AuthOptions } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export function AccountAccessCard() {
  const session = useAppStore((state) => state.session);
  const [options, setOptions] = useState<AuthOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    let active = true;
    void api
      .authOptions()
      .then((value) => {
        if (active) setOptions(value);
      })
      .catch(() => {
        if (active) setError("Sign-in options could not be loaded. Reopen Settings to try again.");
      });
    return () => {
      active = false;
    };
  }, [session]);

  if (!session) return null;

  async function connectGoogle() {
    setBusy(true);
    setError("");
    try {
      const result = await api.startGoogle("link");
      window.location.assign(result.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Google could not be opened.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account</CardTitle>
        <CardDescription>Your sign-in details.</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-4">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted">Name</dt>
            <dd className="font-medium">{session.displayName}</dd>
          </div>
          <div>
            <dt className="text-muted">Email</dt>
            <dd className="break-all">{session.email}</dd>
          </div>
          <div>
            <dt className="text-muted">Access</dt>
            <dd className="capitalize">{session.role}</dd>
          </div>
        </dl>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Store reference</summary>
          <dl className="mt-2">
            <dt className="text-xs text-muted">Business ID</dt>
            <dd className="mt-1 break-all font-mono text-xs">{session.businessId}</dd>
          </dl>
        </details>
        {options?.googleEnabled && (
          <>
            <p className="text-sm text-muted">Connect your Google account for quicker sign-in.</p>
            <GoogleAuthButton
              label="Connect Google account"
              onClick={() => void connectGoogle()}
              busy={busy}
            />
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/lib/store";

export function ApiGate({ children }: { children: ReactNode }) {
  const mode = useAppStore((state) => state.dataMode);
  const session = useAppStore((state) => state.session);
  const status = useAppStore((state) => state.apiStatus);
  const error = useAppStore((state) => state.apiError);
  const connect = useAppStore((state) => state.connectApi);
  const signIn = useAppStore((state) => state.signIn);
  const [businessId, setBusinessId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void connect();
  }, [connect]);
  if (mode === "browser-demo") return <>{children}</>;
  if (session) return <>{children}</>;
  if (status === "loading")
    return <main className="grid min-h-screen place-items-center">Connecting to StockCast…</main>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await signIn(businessId, email, password);
    } catch {
      /* rendered from store */
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-surface-2 p-6">
      <form
        className="grid w-full max-w-md gap-4 rounded-2xl bg-surface p-6 shadow-sm"
        onSubmit={submit}
      >
        <div>
          <h1 className="text-2xl font-semibold">Sign in to StockCast</h1>
          <p className="text-sm text-muted">
            API mode uses the shared PostgreSQL business database.
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="business-id">Business ID</Label>
          <Input
            id="business-id"
            required
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Button type="submit">Sign in</Button>
      </form>
    </main>
  );
}

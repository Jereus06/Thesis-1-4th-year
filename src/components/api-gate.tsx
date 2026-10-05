import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AuthCallbackNotice } from "@/components/auth-callback-notice";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api, type AuthOptions, type BusinessRegistration, type GooglePending } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { saveBrowserLogin } from "@/lib/browser-login";

export function ApiGate({ children }: { children: ReactNode }) {
  const mode = useAppStore((state) => state.dataMode);
  const session = useAppStore((state) => state.session);
  const error = useAppStore((state) => state.apiError);
  const connect = useAppStore((state) => state.connectApi);
  const signIn = useAppStore((state) => state.signIn);
  const signUp = useAppStore((state) => state.signUp);
  const completeGoogle = useAppStore((state) => state.completeGoogle);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [options, setOptions] = useState<AuthOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [pending, setPending] = useState<GooglePending | null>(null);
  const [screen, setScreen] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState<"password" | "google" | null>(null);
  const [formError, setFormError] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saveLogin, setSaveLogin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessLocation, setBusinessLocation] = useState("");
  const [dataOrigin, setDataOrigin] = useState<BusinessRegistration["dataOrigin"]>("demo");
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (mode !== "api") return;
    let active = true;
    void Promise.all([
      connect(),
      api
        .authOptions()
        .then((value) => {
          if (active) setOptions(value);
        })
        .catch(() => {
          if (active)
            setOptionsError(
              "Sign-in options could not be loaded. Check the connection and refresh this page.",
            );
        }),
      api
        .googlePending()
        .then((value) => {
          if (active) setPending(value);
        })
        .catch(() => {
          // A missing or expired Google registration can be restarted from the sign-in screen.
        }),
    ]).finally(() => {
      if (active) setBootstrapping(false);
    });
    return () => {
      active = false;
    };
  }, [connect, mode]);

  function changeScreen(value: "sign-in" | "sign-up") {
    setScreen(value);
    setFormError("");
    useAppStore.setState({ apiError: null });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const creating = !!pending || screen === "sign-up";
    if (creating && (!businessName.trim() || (!pending && !displayName.trim()))) {
      setFormError("Enter your name and store name.");
      return;
    }
    if (creating && dataOrigin === "partner" && !authorized) {
      setFormError("Confirm that you have permission to store these business records.");
      return;
    }
    if (!pending && screen === "sign-up" && password !== confirmation) {
      setFormError("Passwords do not match.");
      return;
    }
    const submittedEmail = email.trim();
    const submittedPassword = password;
    const requestBrowserSave = !pending && saveLogin;
    setBusy("password");
    const business: BusinessRegistration = {
      businessName: businessName.trim(),
      businessLocation: businessLocation.trim() || undefined,
      dataOrigin,
    };
    try {
      if (pending) {
        await completeGoogle(business);
        setPending(null);
      } else if (screen === "sign-up") {
        await signUp({
          ...business,
          displayName: displayName.trim(),
          email: email.trim(),
          password,
        });
      } else {
        await signIn(businessId.trim() || undefined, email.trim(), password);
      }
      setPassword("");
      setConfirmation("");
      if (requestBrowserSave) {
        void saveBrowserLogin(submittedEmail, submittedPassword);
      }
    } catch {
      // The store exposes the server's authentication error for the form.
    } finally {
      setBusy(null);
    }
  }

  async function continueWithGoogle() {
    setBusy("google");
    setFormError("");
    useAppStore.setState({ apiError: null });
    try {
      const result = await api.startGoogle("sign-in");
      window.location.assign(result.url);
    } catch (failure) {
      setFormError(
        failure instanceof Error ? failure.message : "Google sign-in could not be opened.",
      );
      setBusy(null);
    }
  }

  if (mode === "browser-demo") return <>{children}</>;
  const resetToken = new URLSearchParams(window.location.search).get("reset");
  const invitationToken = new URLSearchParams(window.location.search).get("invitation");
  if (resetToken || invitationToken)
    return <TokenPasswordForm resetToken={resetToken} invitationToken={invitationToken} />;
  if (session)
    return (
      <>
        <AuthCallbackNotice signedIn />
        {children}
      </>
    );
  if (bootstrapping)
    return (
      <main className="grid min-h-dvh place-items-center bg-bg p-6 text-fg">
        <div role="status" className="text-center">
          <p className="font-display text-3xl italic">StockCast</p>
          <p className="mt-3 text-sm text-muted">Connecting to your store...</p>
        </div>
      </main>
    );

  const creating = !!pending || screen === "sign-up";
  const message = formError || error || optionsError;
  return (
    <main className="grid min-h-dvh place-items-center bg-surface-2 px-4 py-8 text-fg sm:p-8">
      <div className="w-full max-w-md">
        <AuthCallbackNotice signedIn={false} />
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <p className="font-display text-3xl italic tracking-tight">StockCast</p>
            <p className="mt-1 text-sm text-muted">
              Sales forecasts and inventory decisions for your store.
            </p>
          </div>
          {!pending && (
            <div
              role="group"
              aria-label="Account access"
              className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
            >
              <Button
                type="button"
                variant={screen === "sign-in" ? "outline" : "ghost"}
                aria-pressed={screen === "sign-in"}
                disabled={!!busy}
                onClick={() => changeScreen("sign-in")}
              >
                Sign in
              </Button>
              <Button
                type="button"
                variant={screen === "sign-up" ? "outline" : "ghost"}
                aria-pressed={screen === "sign-up"}
                disabled={!!busy || !options?.signUpEnabled}
                onClick={() => changeScreen("sign-up")}
              >
                Create account
              </Button>
            </div>
          )}
          <h1 className="text-xl font-semibold">
            {pending
              ? "Finish setting up your store"
              : creating
                ? "Create your StockCast account"
                : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {pending
              ? `Google verified ${pending.email}. Choose your store details to finish.`
              : creating
                ? "Create your own store with an empty catalog, ready for your records."
                : "Sign in to open your store's products, sales, and forecasts."}
          </p>
          {options?.googleEnabled && !pending && (
            <div className="mt-5">
              <GoogleAuthButton
                onClick={() => void continueWithGoogle()}
                disabled={!!busy}
                busy={busy === "google"}
              />
              <div className="my-5 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                <span>or use email</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}
          <form
            id={pending ? "store-setup-form" : creating ? "sign-up-form" : "sign-in-form"}
            name={pending ? "store-setup" : creating ? "sign-up" : "sign-in"}
            method="post"
            autoComplete="on"
            className="mt-5 grid gap-4"
            onSubmit={submit}
            aria-busy={busy === "password"}
          >
            {message && (
              <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
                {message}
              </p>
            )}
            <fieldset disabled={!!busy} className="grid min-w-0 gap-4">
              {creating && !pending && (
                <div className="grid gap-1.5">
                  <Label htmlFor="display-name">Your name</Label>
                  <Input
                    id="display-name"
                    name="display-name"
                    autoComplete="name"
                    required
                    maxLength={160}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </div>
              )}
              {!pending && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="auth-email">Email</Label>
                    <Input
                      id="auth-email"
                      name="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      type="email"
                      autoComplete="username"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="auth-password">Password</Label>
                    <Input
                      id="auth-password"
                      name="password"
                      type="password"
                      autoComplete={creating ? "new-password" : "current-password"}
                      required
                      minLength={creating ? 12 : undefined}
                      maxLength={creating ? 128 : 1024}
                      aria-describedby={creating ? "password-help" : undefined}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    {creating && (
                      <p id="password-help" className="text-xs text-muted">
                        Use at least 12 characters. A long, unique passphrase works well.
                      </p>
                    )}
                  </div>
                  {creating && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="confirm-password">Confirm password</Label>
                      <Input
                        id="confirm-password"
                        name="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                    </div>
                  )}
                </>
              )}
              {creating && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="business-name">Store name</Label>
                    <Input
                      id="business-name"
                      name="business-name"
                      autoComplete="organization"
                      required
                      maxLength={160}
                      value={businessName}
                      onChange={(event) => setBusinessName(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="business-location">
                      Store location <span className="font-normal text-muted">(optional)</span>
                    </Label>
                    <Input
                      id="business-location"
                      name="business-location"
                      autoComplete="address-level2"
                      maxLength={240}
                      value={businessLocation}
                      onChange={(event) => setBusinessLocation(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="data-origin">Records you plan to use</Label>
                    <Select
                      id="data-origin"
                      value={dataOrigin}
                      onChange={(event) => {
                        setDataOrigin(event.target.value as BusinessRegistration["dataOrigin"]);
                        setAuthorized(false);
                      }}
                      aria-describedby="data-origin-help"
                    >
                      <option value="demo">Test records</option>
                      <option value="partner">Authorized business records</option>
                    </Select>
                    <p id="data-origin-help" className="text-xs text-muted">
                      Choose test records for practice, or authorized business records for real
                      sales and stock you have permission to use. This labels your records; your
                      store starts empty.
                    </p>
                  </div>
                  {dataOrigin === "partner" && (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        required
                        checked={authorized}
                        onChange={(event) => setAuthorized(event.target.checked)}
                      />
                      <span>I have permission to store this business's records.</span>
                    </label>
                  )}
                </>
              )}
              {!creating && (
                <details className="rounded-xl border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Choose a specific business
                  </summary>
                  <div className="mt-3 grid gap-1.5">
                    <Label htmlFor="business-id">
                      Business ID <span className="font-normal text-muted">(optional)</span>
                    </Label>
                    <Input
                      id="business-id"
                      name="business-id"
                      autoComplete="off"
                      placeholder="Business UUID"
                      pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                      value={businessId}
                      onChange={(event) => setBusinessId(event.target.value)}
                      aria-describedby="business-id-help"
                    />
                    <p id="business-id-help" className="text-xs text-muted">
                      Use this when your email has access to more than one business. Your Business
                      ID is shown in Inventory &gt; Settings.
                    </p>
                  </div>
                </details>
              )}
              {!pending && (
                <div className="grid gap-1.5">
                  <label htmlFor="save-browser-login" className="flex items-start gap-2 text-sm">
                    <input
                      id="save-browser-login"
                      type="checkbox"
                      className="mt-1 size-4 accent-primary"
                      checked={saveLogin}
                      onChange={(event) => setSaveLogin(event.target.checked)}
                      aria-describedby="save-browser-login-help"
                    />
                    <span>Ask this browser to save my email and password</span>
                  </label>
                  <p id="save-browser-login-help" className="text-xs text-muted">
                    Your browser controls saving and autofill. You can confirm or decline its
                    prompt.
                  </p>
                </div>
              )}
              <Button type="submit">
                {busy === "password"
                  ? creating
                    ? "Creating your store..."
                    : "Signing in..."
                  : creating
                    ? "Create my store"
                    : "Sign in"}
              </Button>
            </fieldset>
          </form>
          {!pending && screen === "sign-in" && (
            <Button
              type="button"
              variant="ghost"
              className="mt-3 w-full"
              disabled={!!busy || !email.trim()}
              onClick={() =>
                void api
                  .requestRecovery(email.trim())
                  .then(() =>
                    setFormError(
                      "If that account exists and email is configured, a single-use reset link has been sent.",
                    ),
                  )
                  .catch((e: Error) => setFormError(e.message))
              }
            >
              Forgot password
            </Button>
          )}
          {pending && (
            <Button
              type="button"
              variant="ghost"
              className="mt-3 w-full"
              disabled={!!busy}
              onClick={() => {
                setPending(null);
                changeScreen("sign-in");
              }}
            >
              Back to sign in
            </Button>
          )}
          <p className="mt-5 text-xs text-muted">
            {creating
              ? "Your account will own this new store. Its Business ID is generated automatically."
              : "An active session is restored automatically when you reopen this browser."}
          </p>
        </div>
      </div>
    </main>
  );
}

function TokenPasswordForm({
  resetToken,
  invitationToken,
}: {
  resetToken: string | null;
  invitationToken: string | null;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (resetToken) await api.completeRecovery(resetToken, password);
      else {
        await api.acceptInvitation(invitationToken!, password);
      }
      window.location.assign("/");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-surface-2 p-6 text-fg">
      <form
        onSubmit={submit}
        className="grid w-full max-w-md gap-4 rounded-2xl border border-border bg-surface p-6"
      >
        <h1 className="text-xl font-semibold">
          {resetToken ? "Choose a new password" : "Accept staff invitation"}
        </h1>
        <p className="text-sm text-muted">This protected link expires and can be used only once.</p>
        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
        <Input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (12+ characters)"
        />
        <Input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder="Confirm password"
        />
        <Button disabled={busy} type="submit">
          {busy ? "Saving…" : resetToken ? "Reset password" : "Create staff account"}
        </Button>
      </form>
    </main>
  );
}

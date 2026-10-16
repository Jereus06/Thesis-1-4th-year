import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthCallbackNotice } from "@/components/auth-callback-notice";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api, type AuthOptions, type BusinessRegistration, type GooglePending } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { saveBrowserLogin } from "@/lib/browser-login";

function PasswordInput({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-12" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0"
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}

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
  const [screen, setScreen] = useState<"sign-in" | "sign-up" | "recovery">("sign-in");
  const [busy, setBusy] = useState<"password" | "google" | null>(null);
  const submitting = useRef(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
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

  function clearFeedback() {
    setFormError("");
    setNotice("");
    useAppStore.setState({ apiError: null });
  }

  function changeScreen(value: "sign-in" | "sign-up" | "recovery") {
    if (submitting.current) return;
    setScreen(value);
    setPassword("");
    setConfirmation("");
    setSaveLogin(false);
    setAuthorized(false);
    clearFeedback();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    clearFeedback();
    const creating = !!pending || screen === "sign-up";
    const recovering = !pending && screen === "recovery";
    if (creating && !pending && !displayName.trim()) {
      setFormError("Enter your name.");
      event.currentTarget.querySelector<HTMLInputElement>("#display-name")?.focus();
      return;
    }
    if (creating && !businessName.trim()) {
      setFormError("Enter your store name.");
      event.currentTarget.querySelector<HTMLInputElement>("#business-name")?.focus();
      return;
    }
    if (creating && dataOrigin === "partner" && !authorized) {
      setFormError("Confirm that you have permission to store these business records.");
      return;
    }
    if (!pending && screen === "sign-up" && password !== confirmation) {
      setFormError("Passwords do not match.");
      event.currentTarget.querySelector<HTMLInputElement>("#confirm-password")?.focus();
      return;
    }
    const submittedEmail = email.trim();
    const submittedPassword = password;
    const requestBrowserSave = !pending && !recovering && saveLogin;
    submitting.current = true;
    setBusy("password");
    const business: BusinessRegistration = {
      businessName: businessName.trim(),
      businessLocation: businessLocation.trim() || undefined,
      dataOrigin,
    };
    try {
      if (recovering) {
        await api.requestRecovery(submittedEmail, businessId.trim() || undefined);
        setNotice(
          "If this account can receive recovery email, you'll get a reset link. Check your inbox and spam folder.",
        );
        return;
      } else if (pending) {
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
      setSaveLogin(false);
      setScreen("sign-in");
      if (requestBrowserSave) {
        void saveBrowserLogin(submittedEmail, submittedPassword);
      }
    } catch (failure) {
      if (recovering)
        setFormError(
          failure instanceof Error
            ? failure.message
            : "The reset link could not be requested. Try again.",
        );
      // Other authentication errors are exposed by the store.
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }

  async function continueWithGoogle() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy("google");
    clearFeedback();
    try {
      const result = await api.startGoogle("sign-in");
      window.location.assign(result.url);
    } catch (failure) {
      setFormError(
        failure instanceof Error ? failure.message : "Google sign-in could not be opened.",
      );
      submitting.current = false;
      setBusy(null);
    }
  }

  if (mode === "browser-demo") return <>{children}</>;
  const resetToken = new URLSearchParams(window.location.search).get("reset");
  const invitationToken = new URLSearchParams(window.location.search).get("invitation");
  if (resetToken || invitationToken)
    return (
      <TokenPasswordForm
        resetToken={resetToken}
        invitationToken={invitationToken}
        signedIn={!!session}
      />
    );
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
  const recovering = screen === "recovery" && !pending;
  const message = formError || error;
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
          {!pending && !recovering && (
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
          <h1 id="auth-title" className="text-xl font-semibold">
            {pending
              ? "Finish setting up your store"
              : recovering
                ? "Reset your password"
                : creating
                  ? "Create your StockCast account"
                  : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {pending
              ? `Google verified ${pending.email}. Choose your store details to finish.`
              : recovering
                ? "Enter your account email to request a single-use password reset link."
                : creating
                  ? "Create your own store with an empty catalog, ready for your records."
                  : "Sign in to open your store's products, sales, and forecasts."}
          </p>
          {optionsError && (
            <p role="alert" className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
              {optionsError}
            </p>
          )}
          {options?.googleEnabled && !pending && !recovering && (
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
            key={pending ? "store-setup" : screen}
            id={
              pending
                ? "store-setup-form"
                : creating
                  ? "sign-up-form"
                  : recovering
                    ? "recovery-form"
                    : "sign-in-form"
            }
            name={
              pending ? "store-setup" : creating ? "sign-up" : recovering ? "recovery" : "sign-in"
            }
            method="post"
            autoComplete="on"
            className="mt-5 grid gap-4"
            onSubmit={submit}
            onChange={clearFeedback}
            aria-labelledby="auth-title"
            aria-busy={busy === "password"}
          >
            {message && (
              <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
                {message}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
                {notice}
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
                      autoComplete={recovering ? "email" : "username"}
                      required
                      maxLength={254}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  {!recovering && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="auth-password">Password</Label>
                      <PasswordInput
                        label="Password"
                        id="auth-password"
                        name="password"
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
                  )}
                  {creating && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="confirm-password">Confirm password</Label>
                      <PasswordInput
                        label="Confirm password"
                        id="confirm-password"
                        name="confirm-password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        aria-invalid={formError === "Passwords do not match." || undefined}
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
                      ID is shown in Your account in Inventory.
                    </p>
                  </div>
                </details>
              )}
              {!pending && !recovering && (
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
                  ? recovering
                    ? "Sending reset link…"
                    : creating
                      ? "Creating your store..."
                      : "Signing in..."
                  : recovering
                    ? "Send reset link"
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
              disabled={!!busy}
              onClick={() => changeScreen("recovery")}
            >
              Forgot password
            </Button>
          )}
          {(pending || recovering) && (
            <Button
              type="button"
              variant="ghost"
              className="mt-3 w-full"
              disabled={!!busy}
              onClick={() => {
                if (submitting.current) return;
                setPending(null);
                changeScreen("sign-in");
              }}
            >
              Back to sign in
            </Button>
          )}
          <p className="mt-5 text-xs text-muted">
            {recovering
              ? "Reset links expire after 30 minutes and can be used only once."
              : creating
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
  signedIn,
}: {
  resetToken: string | null;
  invitationToken: string | null;
  signedIn: boolean;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || completed) return;
    setMessage("");
    if (password !== confirmation) {
      setMessage("Passwords do not match.");
      event.currentTarget.querySelector<HTMLInputElement>("#token-confirm-password")?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      if (resetToken) await api.completeRecovery(resetToken, password);
      else await api.acceptInvitation(invitationToken!, password);
      setPassword("");
      setConfirmation("");
      setCompleted(true);
      if (!resetToken) window.location.replace("/");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Your password could not be saved. Try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-surface-2 p-6 text-fg">
      <form
        id={resetToken ? "reset-password-form" : "invitation-password-form"}
        name={resetToken ? "reset-password" : "invitation-password"}
        method="post"
        autoComplete="on"
        onSubmit={submit}
        onChange={() => setMessage("")}
        aria-labelledby="token-password-title"
        aria-busy={busy}
        className="grid w-full max-w-md gap-4 rounded-2xl border border-border bg-surface p-6"
      >
        <p className="font-display text-3xl italic tracking-tight">StockCast</p>
        <h1 id="token-password-title" className="text-xl font-semibold">
          {completed
            ? resetToken
              ? "Password updated"
              : "Staff account created"
            : resetToken
              ? "Choose a new password"
              : "Accept staff invitation"}
        </h1>
        {completed ? (
          <p role="status" className="text-sm">
            {resetToken
              ? "Your new password is saved. Use it the next time you sign in."
              : "Your staff account is ready. Opening your store…"}
          </p>
        ) : (
          <p className="text-sm text-muted">
            This protected link expires and can be used only once.
          </p>
        )}
        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
        {!completed && (
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="token-password">New password</Label>
              <PasswordInput
                id="token-password"
                name="new-password"
                label="New password"
                autoComplete="new-password"
                aria-describedby="token-password-help"
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p id="token-password-help" className="text-xs text-muted">
                Use at least 12 characters. A long, unique passphrase works well.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="token-confirm-password">Confirm password</Label>
              <PasswordInput
                id="token-confirm-password"
                name="confirm-password"
                label="Confirm password"
                autoComplete="new-password"
                aria-invalid={message === "Passwords do not match." || undefined}
                minLength={12}
                maxLength={128}
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>
            <Button type="submit">
              {busy ? "Saving…" : resetToken ? "Reset password" : "Create staff account"}
            </Button>
          </fieldset>
        )}
        <Button
          type="button"
          variant={completed ? "default" : "ghost"}
          disabled={busy}
          onClick={() => {
            if (!submitting.current) window.location.replace("/");
          }}
        >
          {completed && !resetToken
            ? "Open StockCast"
            : signedIn
              ? "Back to StockCast"
              : "Back to sign in"}
        </Button>
      </form>
    </main>
  );
}

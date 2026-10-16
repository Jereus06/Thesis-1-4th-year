type PasswordCredentialConstructor = new (details: { id: string; password: string }) => Credential;

type PasswordManagerWindow = Window & {
  PasswordCredential?: PasswordCredentialConstructor;
};

/** Ask the browser's password manager after successful password authentication. */
export async function saveBrowserLogin(email: string, password: string): Promise<void> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !window.isSecureContext ||
    window.top !== window ||
    typeof navigator.credentials?.store !== "function"
  ) {
    return;
  }

  const Password = (window as PasswordManagerWindow).PasswordCredential;
  if (typeof Password !== "function") return;

  try {
    await navigator.credentials.store(new Password({ id: email, password }));
  } catch {
    // Browser settings, unsupported storage, or dismissal must not affect sign-in.
  }
}

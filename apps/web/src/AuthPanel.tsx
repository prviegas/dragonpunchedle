import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { ApiError, fetchLoginProviders, logIn, providerStartUrl, signUp, type LoginProvider, type User } from "./api";
import { loadStrengthChecker, STRENGTH_LABELS } from "./passwordStrength";

interface AuthPanelProps {
  /** Why the last Discord/Google sign-in didn't work, if it didn't. */
  initialError?: string;
  onSignedIn: (user: User) => void;
  onClose: () => void;
}

type StrengthModule = Awaited<ReturnType<typeof loadStrengthChecker>>;

export function AuthPanel({ initialError, onSignedIn, onClose }: AuthPanelProps) {
  const id = useId();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [busy, setBusy] = useState(false);
  const [strengthModule, setStrengthModule] = useState<StrengthModule>();
  const registering = mode === "register";

  // Only the providers the server has keys for get a button.
  useEffect(() => {
    fetchLoginProviders().then(({ providers }) => setProviders(providers), () => undefined);
  }, []);

  // Fetch the strength checker the first time the sign-up form opens. If it
  // fails to download, the form still works: the server checks anyway.
  useEffect(() => {
    if (!registering || strengthModule) return;
    let cancelled = false;
    loadStrengthChecker()
      .then((module) => !cancelled && setStrengthModule(module))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [registering, strengthModule]);

  const strength = useMemo(
    () =>
      registering && strengthModule && password
        ? strengthModule.checkPasswordStrength(password, username.trim())
        : undefined,
    [registering, strengthModule, password, username],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { user } = await (registering ? signUp : logIn)(username.trim(), password);
      onSignedIn(user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const passwordHintId = `${id}-password-hint`;

  return (
    <section className="auth-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{registering ? "Create an account" : "Log in"}</h2>
      <p className="auth-why">Keep your guesses on every device and build a streak.</p>

      {providers.length > 0 && (
        <>
          <div className="auth-providers">
            {providers.map((provider) => (
              // A plain link: the browser leaves for Discord or Google and comes back signed in.
              <a
                key={provider.id}
                className={`button button--provider button--${provider.id}`}
                href={providerStartUrl(provider.id)}
              >
                Continue with {provider.label}
              </a>
            ))}
          </div>
          <p className="auth-divider">
            <span>or with a username</span>
          </p>
        </>
      )}

      <form onSubmit={submit}>
        <label htmlFor={`${id}-username`}>Username</label>
        <input
          id={`${id}-username`}
          autoComplete="username"
          required
          // The browser checks these too, but the server is what enforces them.
          pattern="[A-Za-z0-9_\-]{3,20}"
          title="3 to 20 letters, numbers, _ or -"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        {registering && <p className="hint">3 to 20 letters, numbers, _ or -</p>}

        <label htmlFor={`${id}-password`}>Password</label>
        <input
          id={`${id}-password`}
          type="password"
          // Lets password managers fill in a saved password, or suggest a new one.
          autoComplete={registering ? "new-password" : "current-password"}
          required
          minLength={registering ? 8 : undefined}
          maxLength={200}
          aria-describedby={registering ? passwordHintId : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {registering && (
          <>
            {strength && (
              // Decorative: the words below say the same thing for screen readers.
              <div className={`strength-meter ${strength.ok ? "is-ok" : "is-weak"}`} aria-hidden="true">
                {[1, 2, 3, 4].map((step) => (
                  <span key={step} className={step <= Math.max(strength.score, 1) ? "filled" : ""} />
                ))}
              </div>
            )}
            <p id={passwordHintId} className="hint" aria-live="polite">
              {!strength
                ? "At least 8 characters, hard to guess. A few unrelated words work well."
                : strength.ok
                  ? `${STRENGTH_LABELS[strength.score]}. Good to go.`
                  : `${STRENGTH_LABELS[strength.score]}. ${strength.advice}`}
            </p>
          </>
        )}

        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        <div className="auth-actions">
          {/* Blocked only when the meter has actually judged the password weak. */}
          <button type="submit" className="button" disabled={busy || strength?.ok === false}>
            {busy ? "One moment…" : registering ? "Create account" : "Log in"}
          </button>
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>

      <p className="auth-switch">
        {registering ? "Already have an account?" : "New here?"}{" "}
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(registering ? "login" : "register");
            setError(undefined);
          }}
        >
          {registering ? "Log in" : "Create an account"}
        </button>
      </p>
    </section>
  );
}

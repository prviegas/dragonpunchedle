import { useId, useState, type FormEvent } from "react";
import { ApiError, logIn, signUp, type User } from "./api";

interface AuthPanelProps {
  onSignedIn: (user: User) => void;
  onClose: () => void;
}

export function AuthPanel({ onSignedIn, onClose }: AuthPanelProps) {
  const id = useId();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

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

  return (
    <section className="auth-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{registering ? "Create an account" : "Log in"}</h2>
      <p className="auth-why">Keep your guesses on every device and build a streak.</p>

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
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {registering && <p className="hint">At least 8 characters.</p>}

        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        <div className="auth-actions">
          <button type="submit" className="button" disabled={busy}>
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

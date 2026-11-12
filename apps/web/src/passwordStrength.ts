// The sign-up form's strength meter runs the server's own check, imported
// straight from the API's source, so the page can never accept a password the
// server would refuse (or the other way round).
//
// It's a dynamic import(): Vite puts it in a separate file that downloads only
// when someone opens the sign-up form. Its word lists are large, and players
// who never make an account shouldn't pay for them.
type StrengthModule = typeof import("../../api/src/auth/password-strength");

let loading: Promise<StrengthModule> | undefined;

export function loadStrengthChecker(): Promise<StrengthModule> {
  loading ??= import("../../api/src/auth/password-strength").catch((error: unknown) => {
    loading = undefined; // a failed download (say, a flaky connection) can be retried
    throw error;
  });
  return loading;
}

export type { StrengthCheck } from "../../api/src/auth/password-strength";

/** Words for the meter, from score 0 (instantly guessed) to 4. */
export const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;

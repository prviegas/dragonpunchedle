import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as en from "@zxcvbn-ts/language-en";

// Password strength, judged the way an attacker would guess. zxcvbn knows tens
// of thousands of common passwords, names and words, plus patterns people
// lean on: keyboard rows (qwerty), sequences (1234), dates, repeats and l33t
// speak (p@ssw0rd). It estimates how many guesses a password would take and
// turns that into a score from 0 to 4.
//
// This is what current guidance (NIST SP 800-63B) asks for: block passwords
// that are common or predictable, rather than demanding "one capital, one
// symbol", which mostly produces Password1!.
//
// The sign-up form imports this same file to show the score as you type
// (apps/web/src/passwordStrength.ts), so the page and the server can never
// disagree. Only the server's verdict counts, though: anyone can skip the form.
// Keep this file free of Node-only imports, since it also runs in the browser.

/** 3 = "safely unguessable": about 10^10 guesses, out of reach even for
 *  someone who steals our scrypt hashes. */
export const MIN_SCORE = 3;

const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...en.dictionary },
  graphs: common.adjacencyGraphs,
  translations: {
    ...en.translations,
    warnings: { ...en.translations.warnings, userInputs: "Don't build it from your username or the site's name." },
  },
});

// Words anyone would try first against this particular site.
const SITE_WORDS = ["dragonpunchedle", "dragonpunch", "dragon", "punch", "fighter", "hadouken", "shoryuken"];

/** score: 0 (instantly guessed) to 4 (very strong). */
/** score: 0 (instantly guessed) to 4 (very strong). advice: what to change. */
export type StrengthCheck = { ok: true; score: number } | { ok: false; score: number; advice: string };

export function checkPasswordStrength(password: string, username: string): StrengthCheck {
  // Passing the username means "ryu_main" can't use "ryu_main123".
  const { score, feedback } = zxcvbn.check(password, [username, ...SITE_WORDS]);
  if (score >= MIN_SCORE) return { ok: true, score };

  const hint = feedback.warning ?? feedback.suggestions[0];
  return { ok: false, score, advice: `${hint ? `${hint} ` : ""}A few unrelated words together work well.` };
}

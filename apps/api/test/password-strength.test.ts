import { describe, expect, it } from "vitest";
import { checkPasswordStrength } from "../src/auth/password-strength.js";

describe("password strength", () => {
  it.each(["password123", "Password1!", "p@ssw0rd!!", "qwertyuiop", "11111111", "iloveyou2"])(
    "rejects the common or patterned password %s",
    (password) => {
      expect(checkPasswordStrength(password, "someone").ok).toBe(false);
    },
  );

  it("rejects passwords built from the username or the site's name", () => {
    expect(checkPasswordStrength("ryu_main123", "ryu_main").ok).toBe(false);
    expect(checkPasswordStrength("dragonpunchedle!", "someone").ok).toBe(false);
  });

  it.each(["violet kettle orbit", "tiger-uppercut", "mpr8#Lq2zk"])("accepts the strong password %s", (password) => {
    expect(checkPasswordStrength(password, "someone")).toMatchObject({ ok: true, score: expect.any(Number) });
  });

  it("explains a rejection in plain words", () => {
    const result = checkPasswordStrength("ryu_main123", "ryu_main");
    expect(result).toMatchObject({ ok: false, advice: expect.stringMatching(/username/) });
  });
});

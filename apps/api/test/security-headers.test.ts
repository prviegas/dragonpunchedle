import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("security headers", () => {
  const https = buildApp({ secureCookies: true });
  const http = buildApp({ secureCookies: false });

  afterAll(async () => {
    await https.close();
    await http.close();
  });

  it("allows scripts only from the site itself, and no framing", async () => {
    const { headers } = await https.inject({ method: "GET", url: "/api/health" });
    const csp = String(headers["content-security-policy"]);

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("sends the usual hardening headers", async () => {
    const { headers } = await https.inject({ method: "GET", url: "/api/health" });

    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  it("upgrades http links only when the site runs on HTTPS", async () => {
    const secure = await https.inject({ method: "GET", url: "/api/health" });
    const plain = await http.inject({ method: "GET", url: "/api/health" });

    expect(String(secure.headers["content-security-policy"])).toContain("upgrade-insecure-requests");
    expect(String(plain.headers["content-security-policy"])).not.toContain("upgrade-insecure-requests");
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

// A tiny stand-in for the built web app, so this test needs no build and no database.
describe("serving the web app", () => {
  let dir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dragonpunchedle-static-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>Dragonpunchedle</title>");
    await writeFile(join(dir, "assets", "index-abc123.js"), "console.log('game')");
    app = buildApp({ staticDir: dir });
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the page, which browsers must always check for a newer version", async () => {
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Dragonpunchedle</title>");
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("lets browsers keep hashed assets for a year", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("answers unknown page paths with the page itself", async () => {
    const response = await app.inject({ method: "GET", url: "/some/shared/link" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Dragonpunchedle</title>");
  });

  it("keeps unknown API paths as JSON 404s", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nothing-here" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found." });
  });

  it("never serves files from outside the folder", async () => {
    const response = await app.inject({ method: "GET", url: "/../package.json" });
    expect(response.body).not.toContain("dependencies");
  });

  it("still serves the API alongside the page", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.json()).toEqual({ status: "ok" });
  });
});

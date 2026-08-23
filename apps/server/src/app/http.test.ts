import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LATEST_SCHEMA_VERSION, openDatabase } from "@dealfinder/db";
import { afterEach, describe, expect, it } from "vitest";

import {
  closeHttpServer,
  createHttpServer,
  listenHttpServer
} from "./http.js";

describe("localhost HTTP server", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const action of cleanup.splice(0).reverse()) await action();
  });

  it("reports server and database health", async () => {
    const database = openDatabase({ filename: ":memory:" });
    const server = createHttpServer({
      database: () => database,
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });
    cleanup.push(() => database.close(), () => closeHttpServer(server));
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      database: { status: "ok", schemaVersion: LATEST_SCHEMA_VERSION },
      timestamp: "2026-01-01T00:00:00.000Z"
    });
  });

  it("serves the production dashboard with SPA fallback", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dealfinder-static-"));
    writeFileSync(join(directory, "index.html"), "<main>Dealfinder dashboard</main>");
    const database = openDatabase({ filename: ":memory:" });
    const server = createHttpServer({
      database: () => database,
      staticDirectory: directory
    });
    cleanup.push(
      () => rmSync(directory, { recursive: true, force: true }),
      () => database.close(),
      () => closeHttpServer(server)
    );
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });

    const response = await fetch(`http://127.0.0.1:${address.port}/deals`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Dealfinder dashboard");
  });

  it("refuses non-loopback listeners", async () => {
    const database = openDatabase({ filename: ":memory:" });
    const server = createHttpServer({ database: () => database });
    cleanup.push(() => database.close(), () => closeHttpServer(server));

    await expect(
      listenHttpServer(server, { host: "0.0.0.0", port: 0 })
    ).rejects.toThrow(/non-loopback/u);
    expect(server.listening).toBe(false);
  });

  it("exposes an explicit DeepSeek credit test and persisted pause status", async () => {
    const database = openDatabase({ filename: ":memory:" });
    let tests = 0;
    const server = createHttpServer({
      database: () => database,
      deepseek: () => ({
        testCreditAndResume: async () => {
          tests += 1;
          return tests > 1;
        }
      })
    });
    cleanup.push(() => database.close(), () => closeHttpServer(server));
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const status = await fetch(`${baseUrl}/api/integrations/deepseek/credit`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ state: "active", downstreamPaused: false });
    const failed = await fetch(`${baseUrl}/api/integrations/deepseek/credit`, { method: "POST" });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ available: false });
    const succeeded = await fetch(`${baseUrl}/api/integrations/deepseek/credit`, { method: "POST" });
    expect(succeeded.status).toBe(200);
    expect(await succeeded.json()).toMatchObject({ available: true });
  });
});

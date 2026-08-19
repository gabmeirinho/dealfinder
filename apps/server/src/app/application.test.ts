import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadServerConfig } from "../config/index.js";
import { createApplicationRuntime, type ApplicationRuntime } from "./application.js";

describe("application runtime", () => {
  let application: ApplicationRuntime | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await application?.stop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
    application = undefined;
    directory = undefined;
  });

  it("closes HTTP and SQLite during graceful shutdown", async () => {
    directory = mkdtempSync(join(tmpdir(), "dealfinder-runtime-"));
    const config = loadServerConfig({
      env: { DEALFINDER_DATA_DIR: directory }
    });
    config.server.port = 0;
    application = createApplicationRuntime({ config });
    const address = await application.start();
    const database = application.database?.database;

    expect(address.host).toBe("127.0.0.1");
    expect(application.server.listening).toBe(true);
    expect(database?.prepare("SELECT 1").get()).toEqual({ "1": 1 });

    await application.stop();

    expect(application.server.listening).toBe(false);
    expect(application.database).toBeUndefined();
    expect(() => database?.prepare("SELECT 1").get()).toThrow();
  });
});

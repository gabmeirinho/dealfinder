import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  loadServerConfig,
  redactConfig,
  serializeRedacted
} from "./index.js";

describe("server configuration", () => {
  it("derives default runtime paths beneath the configured data directory", () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), "dealfinder-config-")), "data");
    const config = loadServerConfig({
      env: { DEALFINDER_DATA_DIR: dataDir }
    });

    expect(config.server).toEqual({ host: "127.0.0.1", port: 3000 });
    expect(config.timezone).toBe("Europe/Lisbon");
    expect(config.paths.dataDir).toBe(dataDir);
    expect(config.paths.sqlitePath).toBe(join(dataDir, "dealfinder.sqlite"));
    expect(config.paths.chromiumProfileDir).toBe(join(dataDir, "browser-profile"));
    expect(config.paths.diagnosticsDir).toBe(join(dataDir, "diagnostics"));
    expect(config.paths.backupsDir).toBe(join(dataDir, "backups"));
    expect(config.deepseek.model).toBe("deepseek-v4-flash");
  });

  it("requires the Phase 4 DeepSeek model", () => {
    expect(() => loadServerConfig({
      env: { DEALFINDER_DEEPSEEK_MODEL: "deepseek-chat" }
    })).toThrow(/DEALFINDER_DEEPSEEK_MODEL.*deepseek-v4-flash/u);
  });

  it("loads optional credentials from the ignored local environment file", () => {
    const directory = mkdtempSync(join(tmpdir(), "dealfinder-env-"));
    const envFilePath = join(directory, ".env.local");

    writeFileSync(
      envFilePath,
      [
        "DEALFINDER_DATA_DIR=./application-data",
        "DEALFINDER_TELEGRAM_BOT_TOKEN=telegram-secret-token",
        "DEALFINDER_TELEGRAM_CHAT_ID=123456",
        "DEALFINDER_DEEPSEEK_API_KEY=deepseek-secret-key"
      ].join("\n")
    );

    const config = loadServerConfig({ cwd: directory, env: {} });

    expect(config.telegram).toMatchObject({
      enabled: true,
      botToken: "telegram-secret-token",
      chatId: "123456"
    });
    expect(config.deepseek).toMatchObject({
      enabled: true,
      apiKey: "deepseek-secret-key"
    });
    expect(config.paths.dataDir).toBe(join(directory, "application-data"));
  });

  it("rejects non-loopback binding and malformed values with actionable issues", () => {
    expect(() =>
      loadServerConfig({
        env: {
          DEALFINDER_HOST: "0.0.0.0",
          DEALFINDER_PORT: "not-a-port",
          DEALFINDER_TIMEZONE: "Not/A_Timezone",
          DEALFINDER_DIAGNOSTICS_ENABLED: "sometimes"
        }
      })
    ).toThrowError(ConfigValidationError);

    try {
      loadServerConfig({
        env: {
          DEALFINDER_HOST: "0.0.0.0",
          DEALFINDER_PORT: "not-a-port",
          DEALFINDER_TIMEZONE: "Not/A_Timezone"
        }
      });
      throw new Error("expected configuration validation to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(String(error)).toContain("DEALFINDER_HOST");
      expect(String(error)).toContain("DEALFINDER_PORT");
      expect(String(error)).toContain("DEALFINDER_TIMEZONE");
    }
  });

  it("redacts credentials from configuration views and serialized errors", () => {
    const config = loadServerConfig({
      env: {
        DEALFINDER_TELEGRAM_BOT_TOKEN: "telegram-secret-token",
        DEALFINDER_DEEPSEEK_API_KEY: "deepseek-secret-key"
      }
    });
    const publicConfig = redactConfig(config);
    const serialized = serializeRedacted(config);

    expect(publicConfig.telegram.botToken).toBe("[redacted]");
    expect(publicConfig.deepseek.apiKey).toBe("[redacted]");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("telegram-secret-token");
    expect(serialized).not.toContain("deepseek-secret-key");

    try {
      loadServerConfig({
        env: {
          DEALFINDER_DEEPSEEK_API_KEY: "deepseek-secret-key",
          DEALFINDER_PORT: "not-a-port"
        }
      });
      throw new Error("expected configuration validation to fail");
    } catch (error: unknown) {
      expect(JSON.stringify(error)).not.toContain("deepseek-secret-key");
    }
  });
});

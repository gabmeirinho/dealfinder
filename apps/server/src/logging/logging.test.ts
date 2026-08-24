import type { ServerConfig } from "@dealfinder/domain";

import { describe, expect, it } from "vitest";

import { createLogger } from "./index.js";

describe("structured logging", () => {
  it("redacts configured tokens and keys from context and messages", () => {
    const lines: string[] = [];
    const config = {
      telegram: { botToken: "telegram-secret-token" },
      deepseek: { apiKey: "deepseek-secret-key" }
    } as ServerConfig;
    const logger = createLogger({
      config,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      sink: (line) => lines.push(line)
    });

    logger.info("configured integration", {
      telegramBotToken: "telegram-secret-token",
      deepseekApiKey: "deepseek-secret-key"
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[redacted]");
    expect(lines[0]).not.toContain("telegram-secret-token");
    expect(lines[0]).not.toContain("deepseek-secret-key");
  });

  it("respects the configured minimum log level", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "warn",
      sink: (line) => lines.push(line)
    });

    logger.info("ignored");
    logger.warn("written");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level": "warn"');
  });
});


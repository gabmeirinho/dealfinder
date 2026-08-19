import type { LogLevel, ServerConfig } from "@dealfinder/domain";

import {
  collectSecretValues,
  serializeRedacted
} from "../config/redact.js";

export interface LoggerOptions {
  config?: ServerConfig;
  level?: LogLevel;
  now?: () => Date;
  sink?: (line: string) => void;
}

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimumPriority = LEVEL_PRIORITY[options.level ?? "info"] ?? LEVEL_PRIORITY.info;
  const secretValues = collectSecretValues(options.config);
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? console.log;

  function write(level: LogLevel, message: string, context?: unknown): void {
    if (LEVEL_PRIORITY[level] < minimumPriority) {
      return;
    }

    const entry = {
      timestamp: now().toISOString(),
      level,
      message,
      context
    };

    sink(serializeRedacted(entry, secretValues));
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context)
  };
}

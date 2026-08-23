import { isIP } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import {
  DEEPSEEK_ENRICHMENT_MODEL,
  type ConfigIssue,
  type LogLevel,
  type ServerConfig
} from "@dealfinder/domain";

import { ConfigValidationError } from "./errors.js";
import { readEnvFile } from "./env-file.js";

export interface LoadServerConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_TIMEZONE = "Europe/Lisbon";
const DEFAULT_DATA_DIR = join(homedir(), ".local", "share", "dealfinder");
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export function loadServerConfig(options: LoadServerConfigOptions = {}): ServerConfig {
  const cwd = options.cwd ?? process.cwd();
  const envFilePath = options.envFilePath ?? join(cwd, ".env.local");
  const fileEnv = readEnvFile(envFilePath);
  const environment = {
    ...fileEnv,
    ...(options.env ?? process.env)
  };
  const issues: ConfigIssue[] = [];

  const host = readHost(environment.DEALFINDER_HOST, issues);
  const port = readInteger(
    environment.DEALFINDER_PORT,
    "DEALFINDER_PORT",
    DEFAULT_PORT,
    1,
    65_535,
    issues
  );
  const timezone = readTimezone(environment.DEALFINDER_TIMEZONE, issues);
  const dataDir = readDataDir(environment.DEALFINDER_DATA_DIR, cwd, issues);

  const config: ServerConfig = {
    server: { host, port },
    timezone,
    paths: {
      dataDir,
      sqlitePath: readDataPath(
        environment.DEALFINDER_SQLITE_PATH,
        "DEALFINDER_SQLITE_PATH",
        dataDir,
        "dealfinder.sqlite",
        issues
      ),
      chromiumProfileDir: readDataPath(
        environment.DEALFINDER_CHROMIUM_PROFILE_DIR,
        "DEALFINDER_CHROMIUM_PROFILE_DIR",
        dataDir,
        "browser-profile",
        issues
      ),
      diagnosticsDir: readDataPath(
        environment.DEALFINDER_DIAGNOSTICS_DIR,
        "DEALFINDER_DIAGNOSTICS_DIR",
        dataDir,
        "diagnostics",
        issues
      ),
      backupsDir: readDataPath(
        environment.DEALFINDER_BACKUPS_DIR,
        "DEALFINDER_BACKUPS_DIR",
        dataDir,
        "backups",
        issues
      ),
      thumbnailsDir: readDataPath(
        environment.DEALFINDER_THUMBNAILS_DIR,
        "DEALFINDER_THUMBNAILS_DIR",
        dataDir,
        "thumbnails",
        issues
      )
    },
    diagnostics: {
      enabled: readBoolean(
        environment.DEALFINDER_DIAGNOSTICS_ENABLED,
        "DEALFINDER_DIAGNOSTICS_ENABLED",
        true,
        issues
      ),
      level: readLogLevel(environment.DEALFINDER_LOG_LEVEL, issues)
    },
    backups: {
      enabled: readBoolean(
        environment.DEALFINDER_BACKUPS_ENABLED,
        "DEALFINDER_BACKUPS_ENABLED",
        true,
        issues
      ),
      retentionDays: readInteger(
        environment.DEALFINDER_BACKUPS_RETENTION_DAYS,
        "DEALFINDER_BACKUPS_RETENTION_DAYS",
        30,
        1,
        3_650,
        issues
      )
    },
    telegram: {
      enabled: hasValue(environment.DEALFINDER_TELEGRAM_BOT_TOKEN),
      botToken: readOptional(environment.DEALFINDER_TELEGRAM_BOT_TOKEN),
      chatId: readOptional(environment.DEALFINDER_TELEGRAM_CHAT_ID)
    },
    deepseek: {
      enabled: hasValue(environment.DEALFINDER_DEEPSEEK_API_KEY),
      apiKey: readOptional(environment.DEALFINDER_DEEPSEEK_API_KEY),
      baseUrl: readUrl(
        environment.DEALFINDER_DEEPSEEK_BASE_URL,
        "DEALFINDER_DEEPSEEK_BASE_URL",
        DEFAULT_DEEPSEEK_BASE_URL,
        issues
      ),
      model: readDeepSeekModel(
        environment.DEALFINDER_DEEPSEEK_MODEL,
        issues
      )
    }
  };

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return config;
}

function readDeepSeekModel(
  raw: string | undefined,
  issues: { path: string; message: string }[]
): string {
  const value = readString(
    raw,
    "DEALFINDER_DEEPSEEK_MODEL",
    DEEPSEEK_ENRICHMENT_MODEL,
    issues
  );
  if (value !== DEEPSEEK_ENRICHMENT_MODEL) {
    issues.push({
      path: "DEALFINDER_DEEPSEEK_MODEL",
      message: `must be ${DEEPSEEK_ENRICHMENT_MODEL}`
    });
  }
  return DEEPSEEK_ENRICHMENT_MODEL;
}

function readHost(raw: string | undefined, issues: { path: string; message: string }[]): string {
  const host = readString(raw, "DEALFINDER_HOST", DEFAULT_HOST, issues);

  if (!isLoopbackHost(host)) {
    issues.push({
      path: "DEALFINDER_HOST",
      message: "must be a loopback address (127.0.0.1 or ::1)"
    });
  }

  return host;
}

function readTimezone(raw: string | undefined, issues: { path: string; message: string }[]): string {
  const timezone = readString(raw, "DEALFINDER_TIMEZONE", DEFAULT_TIMEZONE, issues);

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    issues.push({
      path: "DEALFINDER_TIMEZONE",
      message: "must be a valid IANA timezone such as Europe/Lisbon"
    });
  }

  return timezone;
}

function readDataDir(
  raw: string | undefined,
  cwd: string,
  issues: { path: string; message: string }[]
): string {
  const value = raw === undefined ? DEFAULT_DATA_DIR : raw.trim();

  if (value === "") {
    issues.push({
      path: "DEALFINDER_DATA_DIR",
      message: "must be a non-empty directory path"
    });
    return resolve(cwd, ".dealfinder-data");
  }

  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

function readDataPath(
  raw: string | undefined,
  name: string,
  dataDir: string,
  defaultName: string,
  issues: { path: string; message: string }[]
): string {
  const value = raw === undefined ? defaultName : raw.trim();

  if (value === "") {
    issues.push({
      path: name,
      message: "must be a non-empty path"
    });
    return join(dataDir, defaultName);
  }

  return isAbsolute(value) ? resolve(value) : resolve(dataDir, value);
}

function readString(
  raw: string | undefined,
  name: string,
  fallback: string,
  issues: { path: string; message: string }[]
): string {
  if (raw === undefined) {
    return fallback;
  }

  const value = raw.trim();

  if (value === "") {
    issues.push({
      path: name,
      message: "must be a non-empty value"
    });
    return fallback;
  }

  return value;
}

function readOptional(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function readInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  issues: { path: string; message: string }[]
): number {
  if (raw === undefined) {
    return fallback;
  }

  const value = raw.trim();

  if (!/^-?\d+$/u.test(value)) {
    issues.push({
      path: name,
      message: `must be an integer between ${minimum} and ${maximum}`
    });
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push({
      path: name,
      message: `must be an integer between ${minimum} and ${maximum}`
    });
    return fallback;
  }

  return parsed;
}

function readBoolean(
  raw: string | undefined,
  name: string,
  fallback: boolean,
  issues: { path: string; message: string }[]
): boolean {
  if (raw === undefined) {
    return fallback;
  }

  const value = raw.trim().toLowerCase();

  if (value === "true") return true;
  if (value === "false") return false;

  issues.push({
    path: name,
    message: "must be either true or false"
  });
  return fallback;
}

function readLogLevel(
  raw: string | undefined,
  issues: { path: string; message: string }[]
): LogLevel {
  const value = (raw ?? "info").trim().toLowerCase();

  if (LOG_LEVELS.includes(value as LogLevel)) {
    return value as LogLevel;
  }

  issues.push({
    path: "DEALFINDER_LOG_LEVEL",
    message: "must be one of debug, info, warn, or error"
  });
  return "info";
}

function readUrl(
  raw: string | undefined,
  name: string,
  fallback: string,
  issues: { path: string; message: string }[]
): string {
  const value = readString(raw, name, fallback, issues);

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    issues.push({
      path: name,
      message: "must be a valid HTTP or HTTPS URL"
    });
  }

  return value;
}

function hasValue(raw: string | undefined): boolean {
  return readOptional(raw) !== undefined;
}

function isLoopbackHost(host: string): boolean {
  if (host === "::1") {
    return true;
  }

  if (isIP(host) !== 4) {
    return false;
  }

  return host.split(".")[0] === "127";
}

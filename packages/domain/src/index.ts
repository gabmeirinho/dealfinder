export const packageName = "@dealfinder/domain" as const;

export type {
  ConfigIssue,
  LogLevel,
  PublicServerConfig,
  ServerConfig
} from "./config.js";
export type { Setting } from "./entities/setting.js";
export type { HealthResponse, ServiceHealth } from "./health.js";
export * from "./browser/index.js";
export * from "./searches/index.js";

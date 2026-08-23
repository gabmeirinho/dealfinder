export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ServerConfig {
  server: {
    host: string;
    port: number;
  };
  timezone: string;
  paths: {
    dataDir: string;
    sqlitePath: string;
    chromiumProfileDir: string;
    diagnosticsDir: string;
    backupsDir: string;
    thumbnailsDir: string;
  };
  diagnostics: {
    enabled: boolean;
    level: LogLevel;
  };
  backups: {
    enabled: boolean;
    retentionDays: number;
  };
  telegram: {
    enabled: boolean;
    botToken: string | undefined;
    chatId: string | undefined;
  };
  deepseek: {
    enabled: boolean;
    apiKey: string | undefined;
    baseUrl: string;
    model: string;
  };
}

export interface PublicServerConfig extends Omit<ServerConfig, "telegram" | "deepseek"> {
  telegram: Omit<ServerConfig["telegram"], "botToken"> & {
    botToken: "[redacted]" | undefined;
  };
  deepseek: Omit<ServerConfig["deepseek"], "apiKey"> & {
    apiKey: "[redacted]" | undefined;
  };
}

export interface ConfigIssue {
  path: string;
  message: string;
}

import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createApplicationRuntime, type ApplicationRuntime } from "./app/index.js";
import { loadServerConfig } from "./config/index.js";
import { createLogger } from "./logging/index.js";

export async function runMain(): Promise<ApplicationRuntime> {
  const config = loadServerConfig();
  const logger = createLogger({
    config,
    level: config.diagnostics.level
  });
  const staticDirectory = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const application = createApplicationRuntime({ config, staticDirectory, logger });
  const address = await application.start();

  logger.info("Dealfinder is ready", {
    url: `http://${formatHost(address.host)}:${address.port}`,
    schemaVersion: application.database?.migrationResult.currentVersion
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Stopping Dealfinder", { signal });

    try {
      await application.stop();
      logger.info("Dealfinder stopped");
    } catch (error: unknown) {
      logger.error("Shutdown failed", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  return application;
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  void runMain().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

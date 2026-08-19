import type { Server } from "node:http";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import type { ServerConfig } from "@dealfinder/domain";

import {
  closeHttpServer,
  createHttpServer,
  listenHttpServer,
  type BoundAddress
} from "./http.js";
import { LifecycleRuntime } from "./lifecycle.js";

export interface ApplicationOptions {
  config: ServerConfig;
  staticDirectory?: string;
}

export interface ApplicationRuntime {
  readonly database: DatabaseConnection | undefined;
  readonly server: Server;
  readonly address: BoundAddress | undefined;
  start(): Promise<BoundAddress>;
  stop(): Promise<void>;
}

export function createApplicationRuntime(
  options: ApplicationOptions
): ApplicationRuntime {
  let database: DatabaseConnection | undefined;
  let address: BoundAddress | undefined;
  const getDatabase = (): DatabaseConnection => {
    if (database === undefined) throw new Error("Database is not running");
    return database;
  };
  const server = createHttpServer({
    database: getDatabase,
    ...(options.staticDirectory === undefined
      ? {}
      : { staticDirectory: options.staticDirectory })
  });
  const lifecycle = new LifecycleRuntime([
    {
      name: "database",
      start: () => {
        database = openDatabase({ filename: options.config.paths.sqlitePath });
      },
      stop: () => {
        database?.close();
        database = undefined;
      }
    },
    {
      name: "http",
      start: async () => {
        address = await listenHttpServer(server, options.config.server);
      },
      stop: async () => {
        await closeHttpServer(server);
        address = undefined;
      }
    }
  ]);

  return {
    get database() {
      return database;
    },
    server,
    get address() {
      return address;
    },
    start: async () => {
      await lifecycle.start();
      if (address === undefined) throw new Error("HTTP server did not start");
      return address;
    },
    stop: () => lifecycle.stop()
  };
}

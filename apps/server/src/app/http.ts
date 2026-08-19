import { readFile, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, resolve, sep } from "node:path";

import type { DatabaseConnection } from "@dealfinder/db";
import type { HealthResponse } from "@dealfinder/domain";

import { handleBrowserRequest, type BrowserManager } from "../modules/browser/index.js";
import { handleSearchesRequest } from "../modules/searches/index.js";

export interface HttpServerOptions {
  database: () => DatabaseConnection;
  browser?: () => BrowserManager;
  staticDirectory?: string;
  now?: () => Date;
}

export interface ListenOptions {
  host: string;
  port: number;
}

export interface BoundAddress {
  host: string;
  port: number;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

export function createHttpServer(options: HttpServerOptions): Server {
  const now = options.now ?? (() => new Date());
  const staticDirectory = options.staticDirectory === undefined
    ? undefined
    : resolve(options.staticDirectory);

  return createServer((request, response) => {
    void handleRequest().catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Internal server error" });
      } else {
        response.destroy();
      }
    });

    async function handleRequest(): Promise<void> {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/api/health" && method === "GET") {
        sendHealth(response, options.database, now);
        return;
      }

      if (
        options.browser !== undefined &&
        await handleBrowserRequest(request, response, url, { browser: options.browser })
      ) return;

      if (await handleSearchesRequest(request, response, url, {
        database: options.database,
        now
      })) return;

      if ((method === "GET" || method === "HEAD") && staticDirectory !== undefined) {
        if (await serveStatic(response, method, url.pathname, staticDirectory)) return;
      }

      sendJson(response, 404, { error: "Not found" });
    }
  });
}

export async function listenHttpServer(
  server: Server,
  options: ListenOptions
): Promise<BoundAddress> {
  if (!isLoopbackHost(options.host)) {
    throw new Error(`Refusing to bind HTTP server to non-loopback host: ${options.host}`);
  }

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolvePromise();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP address");
  }

  return { host: options.host, port: address.port };
}

export async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => error === undefined ? resolvePromise() : reject(error));
  });
}

function sendHealth(
  response: ServerResponse,
  getDatabase: () => DatabaseConnection,
  now: () => Date
): void {
  let body: HealthResponse;
  let statusCode: number;

  try {
    const database = getDatabase();
    database.database.prepare("SELECT 1").get();
    body = {
      status: "ok",
      database: {
        status: "ok",
        schemaVersion: database.migrationResult.currentVersion
      },
      timestamp: now().toISOString()
    };
    statusCode = 200;
  } catch {
    body = {
      status: "degraded",
      database: { status: "unavailable", schemaVersion: null },
      timestamp: now().toISOString()
    };
    statusCode = 503;
  }

  sendJson(response, statusCode, body);
}

async function serveStatic(
  response: ServerResponse,
  method: string,
  rawPathname: string,
  staticDirectory: string
): Promise<boolean> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    sendJson(response, 400, { error: "Malformed URL" });
    return true;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(staticDirectory, `.${requestedPath}`);
  const insideStaticDirectory =
    candidate === staticDirectory || candidate.startsWith(`${staticDirectory}${sep}`);
  if (!insideStaticDirectory) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const file = await readExistingFile(candidate);
  if (file !== undefined) {
    sendFile(response, method, candidate, file);
    return true;
  }

  if (extname(pathname) === "") {
    const indexPath = resolve(staticDirectory, "index.html");
    const index = await readExistingFile(indexPath);
    if (index !== undefined) {
      sendFile(response, method, indexPath, index);
      return true;
    }
  }

  return false;
}

async function readExistingFile(path: string): Promise<Buffer | undefined> {
  try {
    const details = await stat(path);
    return details.isFile() ? await readFile(path) : undefined;
  } catch (error: unknown) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

function sendFile(
  response: ServerResponse,
  method: string,
  path: string,
  contents: Buffer
): void {
  response.writeHead(200, {
    "cache-control": path.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "content-length": contents.byteLength,
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
    "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff"
  });
  response.end(method === "HEAD" ? undefined : contents);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized)
  });
  response.end(serialized);
}

function isLoopbackHost(host: string): boolean {
  if (host === "::1") return true;
  return isIP(host) === 4 && host.split(".")[0] === "127";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}

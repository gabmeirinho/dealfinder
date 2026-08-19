import type { IncomingMessage, ServerResponse } from "node:http";

import type { BrowserStatus } from "@dealfinder/domain";

import { BrowserCommandError, BrowserManager } from "./manager.js";

export interface BrowserHttpOptions {
  browser: () => BrowserManager;
}

export async function handleBrowserRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: BrowserHttpOptions
): Promise<boolean> {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "browser") return false;

  try {
    const method = request.method ?? "GET";
    const browser = options.browser();

    if (segments.length === 2) {
      if (method !== "GET") throw methodNotAllowed("GET");
      sendStatus(response, browser.getStatus());
      return true;
    }

    if (segments.length !== 3) throw notFound();
    if (method !== "POST") throw methodNotAllowed("POST");

    const action = segments[2];
    if (action === "open") sendStatus(response, await browser.open());
    else if (action === "stop") sendStatus(response, await browser.stop());
    else if (action === "resume") sendStatus(response, await browser.resume());
    else throw notFound();
    return true;
  } catch (error: unknown) {
    if (error instanceof BrowserHttpError) {
      sendError(response, error.statusCode, error.code, error.message);
      return true;
    }
    if (error instanceof BrowserCommandError) {
      sendError(response, 409, error.code, error.message);
      return true;
    }
    throw error;
  }
}

class BrowserHttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function methodNotAllowed(allow: string): BrowserHttpError {
  return new BrowserHttpError(405, "METHOD_NOT_ALLOWED", `Use ${allow} for this endpoint`);
}

function notFound(): BrowserHttpError {
  return new BrowserHttpError(404, "NOT_FOUND", "Browser endpoint not found");
}

function sendStatus(response: ServerResponse, browser: BrowserStatus): void {
  sendJson(response, 200, { browser });
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string
): void {
  sendJson(response, statusCode, { error: { code, message } });
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

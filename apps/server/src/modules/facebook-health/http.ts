import type { IncomingMessage, ServerResponse } from "node:http";

import {
  FacebookHealthCommandError,
  type FacebookHealthService
} from "./service.js";

export interface FacebookHealthHttpOptions {
  health: () => FacebookHealthService;
}

export async function handleFacebookHealthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: FacebookHealthHttpOptions
): Promise<boolean> {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "facebook-health") return false;
  try {
    const service = options.health();
    const method = request.method ?? "GET";
    if (segments.length === 2 && method === "GET") {
      sendJson(response, 200, { facebook: service.status() });
      return true;
    }
    if (
      segments.length === 5 &&
      segments[2] === "pauses" &&
      segments[4] === "resume" &&
      method === "POST"
    ) {
      await service.resume(decodeId(segments[3]));
      sendJson(response, 200, { facebook: service.status() });
      return true;
    }
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Facebook health endpoint not found" } });
    return true;
  } catch (error: unknown) {
    if (error instanceof FacebookHealthCommandError) {
      sendJson(response, error.statusCode, { error: { code: error.code, message: error.message } });
      return true;
    }
    throw error;
  }
}

function decodeId(value: string | undefined): string {
  if (value === undefined) throw new FacebookHealthCommandError(404, "PAUSE_NOT_FOUND", "Active acquisition pause not found");
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.length === 0 || decoded.length > 100 || decoded.includes("/")) throw new Error();
    return decoded;
  } catch {
    throw new FacebookHealthCommandError(400, "MALFORMED_PAUSE_ID", "Pause ID is malformed");
  }
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

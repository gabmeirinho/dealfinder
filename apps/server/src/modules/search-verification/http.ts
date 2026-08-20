import type { IncomingMessage, ServerResponse } from "node:http";

import { BrowserCommandError } from "../browser/index.js";
import {
  SearchVerificationError,
  type SearchVerificationService
} from "./service.js";

export interface SearchVerificationHttpOptions {
  verification: () => SearchVerificationService;
}

export async function handleSearchVerificationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: SearchVerificationHttpOptions
): Promise<boolean> {
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments[0] !== "api" ||
    segments[1] !== "searches" ||
    segments[3] !== "verification" ||
    segments[4] !== "facebook"
  ) return false;

  try {
    if ((request.method ?? "GET") !== "POST") {
      throw new SearchVerificationError(405, "METHOD_NOT_ALLOWED", "Use POST for verification actions");
    }
    if (segments.length !== 6) {
      throw new SearchVerificationError(404, "NOT_FOUND", "Verification endpoint not found");
    }
    const searchId = parseSearchId(segments[2]);
    const service = options.verification();
    const action = segments[5];
    const result = action === "open"
      ? await service.openFacebook(searchId)
      : action === "confirm"
        ? service.confirmFacebook(searchId)
        : action === "reject"
          ? service.rejectFacebook(searchId)
          : undefined;
    if (result === undefined) {
      throw new SearchVerificationError(404, "NOT_FOUND", "Verification endpoint not found");
    }
    sendJson(response, action === "open" ? 202 : 200, { verification: result });
    return true;
  } catch (error: unknown) {
    if (error instanceof SearchVerificationError) {
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

function parseSearchId(segment: string | undefined): string {
  if (segment === undefined) {
    throw new SearchVerificationError(404, "SEARCH_NOT_FOUND", "Saved search not found");
  }
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    throw new SearchVerificationError(400, "MALFORMED_SEARCH_ID", "Search ID is malformed");
  }
  if (id.length === 0 || id.length > 100 || id.includes("/")) {
    throw new SearchVerificationError(400, "MALFORMED_SEARCH_ID", "Search ID is malformed");
  }
  return id;
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: { code, message } });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized)
  });
  response.end(serialized);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { StandvirtualScanError, type StandvirtualScanner } from "./scanner.js";

export async function handleStandvirtualRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: { scanner: () => StandvirtualScanner }
): Promise<boolean> {
  const match = /^\/api\/searches\/([^/]+)\/standvirtual\/scan$/u.exec(url.pathname);
  if (match === null) return false;
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end();
    return true;
  }
  try {
    const report = await options.scanner().scan(decodeURIComponent(match[1] as string));
    sendJson(response, 200, { report });
  } catch (error: unknown) {
    if (error instanceof StandvirtualScanError) {
      sendJson(response, error.statusCode, { error: { code: error.code, message: error.message } });
    } else {
      const message = error instanceof Error ? error.message : "Standvirtual scan failed";
      sendJson(response, 502, { error: { code: "STANDVIRTUAL_SCAN_FAILED", message } });
    }
  }
  return true;
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

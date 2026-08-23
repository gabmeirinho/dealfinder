import type { IncomingMessage, ServerResponse } from "node:http";

import type { DatabaseConnection } from "@dealfinder/db";

export interface DealScoresHttpDependencies {
  database: () => DatabaseConnection;
}

export async function handleDealScoresRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: DealScoresHttpDependencies
): Promise<boolean> {
  const match = /^\/api\/searches\/([^/]+)\/deal-scores$/u.exec(url.pathname);
  if (match === null) return false;
  if ((request.method ?? "GET") !== "GET") {
    response.writeHead(405, { allow: "GET" });
    response.end();
    return true;
  }
  const searchId = decodeURIComponent(match[1] as string);
  const database = dependencies.database();
  if (database.searches.get(searchId) === undefined) {
    sendJson(response, 404, { error: "Search not found" });
    return true;
  }
  sendJson(response, 200, { scores: database.dealScores.listRanked(searchId) });
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

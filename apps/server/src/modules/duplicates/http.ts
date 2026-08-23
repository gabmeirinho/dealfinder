import type { IncomingMessage, ServerResponse } from "node:http";

import type { DatabaseConnection } from "@dealfinder/db";

export async function handleDuplicateGroupsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: { database: () => DatabaseConnection }
): Promise<boolean> {
  if (request.method !== "GET" || url.pathname !== "/api/duplicate-groups") return false;
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ groups: options.database().duplicates.listGroups() }));
  return true;
}

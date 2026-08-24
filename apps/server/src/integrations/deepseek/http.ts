import type { IncomingMessage, ServerResponse } from "node:http";

import type { DatabaseConnection } from "@dealfinder/db";

export interface DeepSeekCreditController {
  testCreditAndResume(): Promise<boolean>;
}

export interface DeepSeekHttpDependencies {
  database: () => DatabaseConnection;
  worker: () => DeepSeekCreditController;
}

export async function handleDeepSeekRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: DeepSeekHttpDependencies
): Promise<boolean> {
  if (url.pathname !== "/api/integrations/deepseek/credit") return false;
  const method = request.method ?? "GET";
  if (method === "GET") {
    sendJson(response, 200, dependencies.database().enrichmentProcessing.getControl());
    return true;
  }
  if (method === "POST") {
    const available = await dependencies.worker().testCreditAndResume();
    sendJson(response, available ? 200 : 409, {
      available,
      control: dependencies.database().enrichmentProcessing.getControl()
    });
    return true;
  }
  response.writeHead(405, { allow: "GET, POST" });
  response.end();
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

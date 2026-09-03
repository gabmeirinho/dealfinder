import type { IncomingMessage, ServerResponse } from "node:http";

import type { ListingReviewState } from "@dealfinder/db";
import type { FactCorrection, NormalizedFactField } from "@dealfinder/domain";

import type { ListingReviewService } from "../../workflow/index.js";
import type { ListingDetailCaptureService } from "../detail-enrichment/index.js";

const MAX_BODY_BYTES = 32_000;
const STATES: readonly ListingReviewState[] = [
  "new", "shortlisted", "contacted", "viewing_arranged", "rejected", "bought"
];
const FIELDS: readonly NormalizedFactField[] = [
  "priceCents", "year", "mileageKm", "make", "model", "variant",
  "fuel", "transmission", "powerHp", "sellerType"
];

export async function handleListingReviewRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: {
    workflow: () => ListingReviewService;
    listingDetailCapture?: () => ListingDetailCaptureService;
    now?: () => Date;
  }
): Promise<boolean> {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") return false;
  const now = options.now ?? (() => new Date());
  const workflow = options.workflow();

  try {
    if (segments[1] === "normalization-rules" && segments.length === 4) {
      if (request.method !== "POST") return methodNotAllowed(response, "POST");
      const decision = segments[3];
      if (decision !== "approve" && decision !== "reject") return notFound(response);
      const proposal = workflow.decideRule(
        decodeURIComponent(segments[2] as string),
        decision === "approve" ? "approved" : "rejected",
        now().toISOString()
      );
      sendJson(response, 200, { proposal });
      return true;
    }

    if (segments[1] !== "listings") return false;
    if (segments.length === 2) {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      const stateValue = url.searchParams.get("state");
      const state = stateValue === null ? undefined : parseState(stateValue);
      const searchId = url.searchParams.get("searchId") ?? undefined;
      const query = url.searchParams.get("q") ?? undefined;
      const archived = url.searchParams.get("archived") === "true";
      const risk = url.searchParams.get("risk") === "true";
      sendJson(response, 200, {
        listings: workflow.list({
          ...(state === undefined ? {} : { state }),
          ...(searchId === undefined ? {} : { searchId }),
          ...(query === undefined ? {} : { query }),
          archived,
          risk
        })
      });
      return true;
    }

    const listingId = positiveInteger(segments[2]);
    if (segments.length === 3) {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      const listing = workflow.detail(listingId);
      if (listing === undefined) return notFound(response);
      sendJson(response, 200, { listing });
      return true;
    }

    if (request.method !== "POST" && request.method !== "PATCH") {
      return methodNotAllowed(response, "POST, PATCH");
    }
    const action = segments[3];
    const timestamp = now().toISOString();
    let listing: unknown;
    if (action === "workflow" && request.method === "PATCH") {
      const body = await readObject(request);
      listing = workflow.changeState(
        listingId,
        parseState(body.state),
        optionalString(body.rejectionReason, 1000),
        timestamp
      );
    } else if (action === "archive" && request.method === "POST") {
      const body = await readObject(request);
      listing = workflow.archive(listingId, body.archived === undefined ? true : boolean(body.archived), timestamp);
    } else if (action === "notes" && request.method === "POST") {
      const body = await readObject(request);
      listing = workflow.addNote(listingId, requiredString(body.body, 4000), timestamp);
    } else if (action === "sold" && request.method === "POST") {
      listing = workflow.markSold(listingId, timestamp);
    } else if (
      action === "description" &&
      request.method === "POST" &&
      options.listingDetailCapture !== undefined
    ) {
      await options.listingDetailCapture().capture(listingId);
      listing = workflow.detail(listingId);
    } else if (action === "corrections" && request.method === "POST") {
      const body = await readObject(request);
      const field = parseField(body.field);
      const correction: FactCorrection = { field, value: correctionValue(body.value) };
      listing = workflow.correct(
        listingId,
        correction,
        optionalString(body.reason, 1000),
        body.proposeRule === true,
        timestamp
      );
    } else {
      return notFound(response);
    }
    sendJson(response, 200, { listing });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid listing request";
    if (/not found/iu.test(message)) return notFound(response);
    sendJson(response, 400, { error: message });
    return true;
  }
}

function parseState(value: unknown): ListingReviewState {
  if (typeof value !== "string" || !STATES.includes(value as ListingReviewState)) {
    throw new Error("Invalid review state");
  }
  return value as ListingReviewState;
}

function parseField(value: unknown): NormalizedFactField {
  if (typeof value !== "string" || !FIELDS.includes(value as NormalizedFactField)) {
    throw new Error("Invalid correction field");
  }
  return value as NormalizedFactField;
}

function correctionValue(value: unknown): string | number | null {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw new Error("Correction value must be a string, number, or null");
}

function positiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Invalid listing ID");
  return parsed;
}

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new Error(`Text must contain 1-${maximum} characters`);
  }
  return value;
}

function optionalString(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, maximum);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean value");
  return value;
}

async function readObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function methodNotAllowed(response: ServerResponse, allow: string): true {
  response.writeHead(405, { allow });
  response.end();
  return true;
}

function notFound(response: ServerResponse): true {
  sendJson(response, 404, { error: "Listing not found" });
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

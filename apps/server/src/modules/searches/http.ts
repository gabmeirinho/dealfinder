import type { IncomingMessage, ServerResponse } from "node:http";

import type { DatabaseConnection } from "@dealfinder/db";
import {
  ACTIVE_SEARCH_SOFT_LIMIT,
  SearchValidationError,
  type SearchValidationIssue,
  type VehicleSearch,
  type VehicleSearchDraft
} from "@dealfinder/domain";

import {
  groupIssues,
  presentSearch,
  type SearchApiErrorResponse,
  type SearchListResponse,
  type SearchResponse,
  type SearchScanRequestResponse
} from "./contracts.js";

const MAX_REQUEST_BYTES = 1_000_000;

export interface SearchHttpOptions {
  database: () => DatabaseConnection;
  now?: () => Date;
}

export async function handleSearchesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: SearchHttpOptions
): Promise<boolean> {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "searches") return false;

  try {
    const method = request.method ?? "GET";
    const database = options.database();
    const now = options.now ?? (() => new Date());

    if (segments.length === 2) {
      if (method === "GET") {
        const body: SearchListResponse = {
          searches: database.searches.list().map(presentSearch)
        };
        sendJson(response, 200, body);
        return true;
      }
      if (method === "POST") {
        const payload = await readObjectBody(request);
        const draft = parseSearchDraft(payload);
        const overrideActiveLimit = parseOverride(payload);
        const search = database.transaction(() => {
          requireActivationConfirmation(database, draft.active, overrideActiveLimit);
          return database.searches.create(draft);
        });
        sendSearch(response, 201, search);
        return true;
      }
      throw methodNotAllowed("GET, POST");
    }

    if (segments.length === 3 && segments[2] === "priorities") {
      if (method !== "PUT") throw methodNotAllowed("PUT");
      const payload = await readObjectBody(request);
      const searchIds = parseSearchIds(payload);
      const searches = database.transaction(() => reprioritize(database, searchIds));
      const body: SearchListResponse = { searches: searches.map(presentSearch) };
      sendJson(response, 200, body);
      return true;
    }

    const id = parseSearchId(segments[2]);
    if (segments.length === 3) {
      if (method === "GET") {
        sendSearch(response, 200, requireSearch(database, id));
        return true;
      }
      if (method === "PUT") {
        const payload = await readObjectBody(request);
        const draft = parseSearchDraft(payload);
        const overrideActiveLimit = parseOverride(payload);
        const search = database.transaction(() => {
          const existing = requireSearch(database, id);
          requireActivationConfirmation(
            database,
            draft.active && !existing.active,
            overrideActiveLimit
          );
          return database.searches.update(id, draft) ?? missingSearch();
        });
        sendSearch(response, 200, search);
        return true;
      }
      if (method === "DELETE") {
        database.transaction(() => {
          requireSearch(database, id);
          if (!database.searches.delete(id)) missingSearch();
        });
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return true;
      }
      throw methodNotAllowed("GET, PUT, DELETE");
    }

    if (segments.length !== 4) throw notFound();
    const action = segments[3];
    if (method !== "POST") throw methodNotAllowed("POST");

    if (action === "duplicate") {
      const source = requireSearch(database, id);
      const duplicate = database.searches.create({
        ...toDraft(source),
        name: duplicateName(source.name),
        active: false
      });
      sendSearch(response, 201, duplicate);
      return true;
    }

    if (action === "activate") {
      const payload = await readOptionalObjectBody(request);
      const overrideActiveLimit = parseOverride(payload);
      const search = database.transaction(() => {
        const existing = requireSearch(database, id);
        if (existing.active) return existing;
        requireActivationConfirmation(database, true, overrideActiveLimit);
        return database.searches.update(id, { ...toDraft(existing), active: true }) ?? missingSearch();
      });
      sendSearch(response, 200, search);
      return true;
    }

    if (action === "pause") {
      const search = database.transaction(() => {
        const existing = requireSearch(database, id);
        if (!existing.active) return existing;
        return database.searches.update(id, { ...toDraft(existing), active: false }) ?? missingSearch();
      });
      sendSearch(response, 200, search);
      return true;
    }

    if (action === "scan") {
      const search = requireSearch(database, id);
      if (!search.active) {
        throw new SearchApiError(
          409,
          "SEARCH_INACTIVE",
          "Activate the search before requesting a manual scan"
        );
      }
      const body: SearchScanRequestResponse = {
        searchId: search.id,
        status: "pending",
        requestedAt: now().toISOString()
      };
      sendJson(response, 202, body);
      return true;
    }

    throw notFound();
  } catch (error: unknown) {
    if (error instanceof SearchValidationError) {
      sendApiError(response, 422, "SEARCH_VALIDATION_FAILED", error.message, {
        fieldErrors: error.fieldErrors
      });
      return true;
    }
    if (error instanceof SearchApiError) {
      sendApiError(response, error.statusCode, error.code, error.message, {
        ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
        ...(error.details === undefined ? {} : { details: error.details })
      });
      return true;
    }
    throw error;
  }
}

class SearchApiError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Readonly<Record<string, readonly string[]>>,
    public readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "SearchApiError";
  }
}

function requireActivationConfirmation(
  database: DatabaseConnection,
  wouldActivate: boolean,
  overrideActiveLimit: boolean
): void {
  if (!wouldActivate) return;
  const activeCount = database.searches.list().filter(({ active }) => active).length;
  if (activeCount < ACTIVE_SEARCH_SOFT_LIMIT || overrideActiveLimit) return;
  throw new SearchApiError(
    409,
    "ACTIVE_SEARCH_LIMIT_CONFIRMATION_REQUIRED",
    `Activating more than ${ACTIVE_SEARCH_SOFT_LIMIT} searches requires confirmation`,
    undefined,
    {
      activeCount,
      activeLimit: ACTIVE_SEARCH_SOFT_LIMIT,
      confirmationField: "overrideActiveLimit"
    }
  );
}

function reprioritize(
  database: DatabaseConnection,
  searchIds: readonly string[]
): VehicleSearch[] {
  const current = database.searches.list();
  const currentIds = new Set(current.map(({ id }) => id));
  if (
    searchIds.length !== current.length ||
    new Set(searchIds).size !== searchIds.length ||
    searchIds.some((id) => !currentIds.has(id))
  ) {
    throw new SearchApiError(
      409,
      "SEARCH_SET_CHANGED",
      "Refresh searches before reprioritizing; the submitted search set is stale"
    );
  }

  const byId = new Map(current.map((search) => [search.id, search]));
  for (const [index, id] of searchIds.entries()) {
    const existing = byId.get(id);
    if (existing === undefined) throw missingSearch();
    database.searches.update(id, { ...toDraft(existing), priority: index + 1 });
  }
  return database.searches.list();
}

function requireSearch(database: DatabaseConnection, id: string): VehicleSearch {
  return database.searches.get(id) ?? missingSearch();
}

function missingSearch(): never {
  throw new SearchApiError(404, "SEARCH_NOT_FOUND", "Saved search not found");
}

function notFound(): SearchApiError {
  return new SearchApiError(404, "NOT_FOUND", "Search endpoint not found");
}

function methodNotAllowed(allow: string): SearchApiError {
  return new SearchApiError(
    405,
    "METHOD_NOT_ALLOWED",
    `Use one of the supported methods: ${allow}`
  );
}

function toDraft(search: VehicleSearch): VehicleSearchDraft {
  return {
    name: search.name,
    priority: search.priority,
    active: search.active,
    criteria: search.criteria,
    location: search.location
  };
}

function duplicateName(name: string): string {
  return `${name.slice(0, 95).trimEnd()} copy`;
}

function parseSearchId(segment: string | undefined): string {
  if (segment === undefined) throw notFound();
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    throw new SearchApiError(400, "MALFORMED_SEARCH_ID", "Search ID is malformed");
  }
  if (id.length === 0 || id.length > 100 || id.includes("/")) {
    throw new SearchApiError(400, "MALFORMED_SEARCH_ID", "Search ID is malformed");
  }
  return id;
}

function parseOverride(payload: Readonly<Record<string, unknown>>): boolean {
  const value = payload.overrideActiveLimit;
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw invalidRequest([
      { path: "overrideActiveLimit", message: "must be a boolean" }
    ]);
  }
  return value;
}

function parseSearchIds(payload: Readonly<Record<string, unknown>>): string[] {
  if (!Array.isArray(payload.searchIds) || payload.searchIds.some((id) => typeof id !== "string")) {
    throw invalidRequest([
      { path: "searchIds", message: "must be an array of search IDs" }
    ]);
  }
  return payload.searchIds;
}

function parseSearchDraft(payload: Readonly<Record<string, unknown>>): VehicleSearchDraft {
  const issues: SearchValidationIssue[] = [];
  if (typeof payload.name !== "string") issue(issues, "name", "must be a string");
  if (typeof payload.priority !== "number") issue(issues, "priority", "must be a number");
  if (typeof payload.active !== "boolean") issue(issues, "active", "must be a boolean");
  if (!isRecord(payload.criteria)) issue(issues, "criteria", "must be an object");
  if (!isRecord(payload.location)) issue(issues, "location", "must be an object");

  if (isRecord(payload.criteria)) validateCriteriaShape(payload.criteria, issues);
  if (isRecord(payload.location)) validateLocationShape(payload.location, issues);
  if (issues.length > 0) throw invalidRequest(issues);
  return payload as unknown as VehicleSearchDraft;
}

function validateCriteriaShape(
  criteria: Readonly<Record<string, unknown>>,
  issues: SearchValidationIssue[]
): void {
  const keywordFields = [
    "makeKeywords",
    "modelKeywords",
    "variantKeywords",
    "requiredKeywords",
    "excludedKeywords"
  ] as const;
  const selectionFields = ["fuels", "transmissions"] as const;
  const numberFields = ["minimumYear", "maximumMileageKm", "minimumPowerHp"] as const;

  for (const field of keywordFields) {
    validateConstraintShape(criteria[field], `criteria.${field}`, "strings", issues);
  }
  for (const field of selectionFields) {
    validateConstraintShape(criteria[field], `criteria.${field}`, "strings", issues);
  }
  for (const field of numberFields) {
    validateConstraintShape(criteria[field], `criteria.${field}`, "number", issues);
  }
  validateConstraintShape(criteria.sellerPreference, "criteria.sellerPreference", "string", issues);
  validatePriceShape(criteria.priceRange, issues);
}

function validateConstraintShape(
  value: unknown,
  path: string,
  kind: "string" | "strings" | "number",
  issues: SearchValidationIssue[]
): void {
  if (value === null) return;
  if (!isRecord(value) || typeof value.strength !== "string") {
    issue(issues, path, "must be null or a constraint object");
    return;
  }
  const validValue = kind === "number"
    ? typeof value.value === "number"
    : kind === "string"
      ? typeof value.value === "string"
      : Array.isArray(value.value) && value.value.every((item) => typeof item === "string");
  if (!validValue) issue(issues, `${path}.value`, `has an invalid ${kind} value`);
}

function validatePriceShape(value: unknown, issues: SearchValidationIssue[]): void {
  if (value === null) return;
  if (!isRecord(value) || typeof value.strength !== "string" || !isRecord(value.value)) {
    issue(issues, "criteria.priceRange", "must be null or a price constraint object");
    return;
  }
  for (const field of ["minimumEur", "maximumEur"] as const) {
    const amount = value.value[field];
    if (amount !== null && typeof amount !== "number") {
      issue(issues, `criteria.priceRange.${field}`, "must be a number or null");
    }
  }
}

function validateLocationShape(
  location: Readonly<Record<string, unknown>>,
  issues: SearchValidationIssue[]
): void {
  if (typeof location.mode !== "string") issue(issues, "location.mode", "must be a string");
  if (location.origin !== null && typeof location.origin !== "string") {
    issue(issues, "location.origin", "must be a string or null");
  }
  if (location.radiusKm !== null && typeof location.radiusKm !== "number") {
    issue(issues, "location.radiusKm", "must be a number or null");
  }
}

function invalidRequest(issues: readonly SearchValidationIssue[]): SearchApiError {
  return new SearchApiError(
    400,
    "INVALID_REQUEST",
    "Request body is invalid",
    groupIssues(issues)
  );
}

async function readObjectBody(
  request: IncomingMessage
): Promise<Readonly<Record<string, unknown>>> {
  const body = await readBody(request);
  if (body.length === 0) {
    throw invalidRequest([{ path: "body", message: "is required" }]);
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalidRequest([{ path: "body", message: "must contain valid JSON" }]);
  }
  if (!isRecord(value)) {
    throw invalidRequest([{ path: "body", message: "must be a JSON object" }]);
  }
  return value;
}

async function readOptionalObjectBody(
  request: IncomingMessage
): Promise<Readonly<Record<string, unknown>>> {
  const body = await readBody(request);
  if (body.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalidRequest([{ path: "body", message: "must contain valid JSON" }]);
  }
  if (!isRecord(value)) {
    throw invalidRequest([{ path: "body", message: "must be a JSON object" }]);
  }
  return value;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new SearchApiError(413, "REQUEST_TOO_LARGE", "Request body exceeds 1 MB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(issues: SearchValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function sendSearch(response: ServerResponse, statusCode: number, search: VehicleSearch): void {
  const body: SearchResponse = { search: presentSearch(search) };
  sendJson(response, statusCode, body);
}

function sendApiError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  extras: Pick<SearchApiErrorResponse["error"], "fieldErrors" | "details"> = {}
): void {
  const body: SearchApiErrorResponse = {
    error: { code, message, ...extras }
  };
  sendJson(response, statusCode, body);
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

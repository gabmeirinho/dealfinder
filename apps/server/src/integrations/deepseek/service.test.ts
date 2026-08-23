import { createServer, type Server } from "node:http";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft, type VehicleEnrichment } from "@dealfinder/domain";

import { DeepSeekClient } from "./client.js";
import { DeepSeekEnrichmentService } from "./service.js";
import { createLogger } from "../../logging/index.js";
import { ListingIngestionService } from "../../modules/listings/index.js";

const AT = "2026-08-23T10:00:00.000Z";

describe("DeepSeek enrichment service", () => {
  let database: DatabaseConnection | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    database?.close();
    if (server !== undefined) {
      server.close();
      await once(server, "close");
    }
  });

  it("advances valid output but fails invalid output closed", async () => {
    let requests = 0;
    const url = await startServer((_path, response) => {
      requests += 1;
      const value = requests === 1 ? enrichment() : { ...enrichment(), explanation: "unsupported" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(completion(value)));
    });
    const { service, listingIds } = setupService(url, ["100000000000001", "100000000000002"]);

    await expect(service.processNext()).resolves.toBe("succeeded");
    await expect(service.processNext()).resolves.toBe("failed");
    expect(database!.enrichmentProcessing.getQueueItem(listingIds[0]!)?.state).toBe("completed");
    expect(database!.enrichmentProcessing.getEnrichment(listingIds[0]!)).toBeDefined();
    expect(database!.enrichmentProcessing.getQueueItem(listingIds[1]!)?.state).toBe("failed");
    expect(database!.enrichmentProcessing.getEnrichment(listingIds[1]!)).toBeUndefined();
  });

  it("keeps Facebook collection active during a credit pause and requires a successful credit test", async () => {
    let postRequests = 0;
    let balanceAvailable = false;
    const url = await startServer((path, response) => {
      response.writeHead(path === "/chat/completions" && postRequests === 0 ? 402 : 200, {
        "content-type": "application/json"
      });
      if (path === "/user/balance") {
        response.end(JSON.stringify({ is_available: balanceAvailable, balance_infos: [] }));
        return;
      }
      postRequests += 1;
      response.end(postRequests === 1
        ? JSON.stringify({ error: { message: "balance exhausted" } })
        : JSON.stringify(completion(enrichment())));
    });
    const logs: string[] = [];
    const setup = setupService(url, ["100000000000001"], logs);

    await expect(setup.service.processNext()).resolves.toBe("credit_paused");
    const second = ingest(setup.ingestion, setup.searchId, "2026-08-23T10:05:00.000Z", "100000000000002");
    expect(second.observationsInserted).toBe(1);
    expect(database!.enrichmentProcessing.getQueueItem(second.listings[0]!.id)?.state).toBe("queued");
    expect(await setup.service.processNext()).toBe("credit_paused");
    expect(postRequests).toBe(1);
    expect(database!.database.prepare("SELECT count(*) AS count FROM raw_candidate_observations").get())
      .toEqual({ count: 2 });
    expect(database!.database.prepare("SELECT count(*) AS count FROM processing_domain_events").get())
      .toEqual({ count: 1 });

    await expect(setup.service.testCreditAndResume()).resolves.toBe(false);
    expect(database!.enrichmentProcessing.getControl().state).toBe("credit_paused");
    balanceAvailable = true;
    await expect(setup.service.testCreditAndResume()).resolves.toBe(true);
    expect(database!.enrichmentProcessing.getControl().state).toBe("active");
    await expect(setup.service.processNext()).resolves.toBe("succeeded");

    const output = logs.join("\n");
    expect(output).not.toContain("deepseek-secret-test-key");
    expect(output).not.toMatch(/BMW 320d|79 500 km|balance exhausted|cookie|seller_contact|profile_url/i);
  });

  it("requeues rate limits without advancing", async () => {
    const url = await startServer((_path, response) => {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "rate limited" }));
    });
    const { service, listingIds } = setupService(url, ["100000000000001"]);

    await expect(service.processNext()).resolves.toBe("retry_queued");
    expect(database!.enrichmentProcessing.getQueueItem(listingIds[0]!)).toMatchObject({
      state: "queued", lastErrorCode: "rate_limited"
    });
    expect(database!.enrichmentProcessing.getEnrichment(listingIds[0]!)).toBeUndefined();
  });

  function startServer(
    responder: (path: string, response: import("node:http").ServerResponse) => void
  ): Promise<string> {
    server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume the request without retaining it */ }
      responder(request.url ?? "", response);
    });
    server.listen(0, "127.0.0.1");
    return once(server, "listening").then(() => {
      const address = server!.address();
      if (address === null || typeof address === "string") throw new Error("Fake server did not bind");
      return `http://127.0.0.1:${address.port}`;
    });
  }

  function setupService(baseUrl: string, sourceIds: string[], logs: string[] = []) {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("BMW search");
    draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
    const search = database.searches.create(draft);
    const ingestion = new ListingIngestionService(() => database as DatabaseConnection);
    const listingIds = sourceIds.map((id, index) =>
      ingest(ingestion, search.id, new Date(Date.parse(AT) + index * 1000).toISOString(), id).listings[0]!.id
    );
    const logger = createLogger({ sink: (line) => logs.push(line), level: "debug" });
    const client = new DeepSeekClient({ apiKey: "deepseek-secret-test-key", baseUrl });
    const service = new DeepSeekEnrichmentService({
      database: () => database as DatabaseConnection,
      client,
      enabled: true,
      logger,
      now: () => new Date("2026-08-23T10:10:00.000Z")
    });
    return { service, listingIds, ingestion, searchId: search.id };
  }
});

function ingest(
  ingestion: ListingIngestionService,
  searchId: string,
  observedAt: string,
  sourceListingId: string
) {
  return ingestion.ingestScan({
    searchId,
    observedAt,
    initialScan: false,
    completeSnapshot: false,
    candidates: [{
      source: "facebook",
      sourceListingId,
      url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
      title: "BMW 320d 2020",
      description: "79 500 km, diesel, caixa automática",
      displayedPrice: "24 900 €",
      location: "Lisboa",
      thumbnailUrl: null,
      rawCardFacts: ["190 cv"]
    }]
  });
}

function completion(value: unknown): unknown {
  return {
    id: "request-1",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }]
  };
}

function enrichment(): VehicleEnrichment {
  return {
    schemaVersion: 1,
    vehicle: {
      make: "BMW", model: "320d", variant: null, year: 2020, mileageKm: 79_500,
      fuel: "diesel", transmission: "automatic", powerHp: 190
    },
    price: { amountCents: 2_490_000, interpretation: "full_price" },
    sellerType: "dealer",
    indicators: { financing: false, monthlyPayment: false, deposit: false, damaged: false, imported: false },
    uncertainties: []
  };
}

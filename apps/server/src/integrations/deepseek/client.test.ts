import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { DeepSeekClient } from "./client.js";
import type { EnrichmentInput, VehicleEnrichment } from "@dealfinder/domain";

describe("DeepSeek client", () => {
  let fake: FakeDeepSeekServer | undefined;

  afterEach(async () => fake?.close());

  it("uses the required model, non-thinking JSON mode, and privacy-limited payload", async () => {
    fake = await FakeDeepSeekServer.start((_request, response) => json(response, 200, completion(enrichment())));
    const client = new DeepSeekClient({ apiKey: "deepseek-secret-test-key", baseUrl: fake.url });

    await expect(client.enrich({ ...input(), cookie: "must-not-leak" } as EnrichmentInput)).resolves.toMatchObject({
      enrichment: enrichment(), providerRequestId: "request-1"
    });
    const request = fake.requests[0]!;
    expect(request.authorization).toBe("Bearer deepseek-secret-test-key");
    expect(request.body).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      stream: false
    });
    const serialized = JSON.stringify(request.body);
    expect(serialized).toContain("Return JSON only");
    const messages = request.body.messages as Array<{ role: string; content: string }>;
    const userContent = messages.find(({ role }) => role === "user")?.content ?? "";
    expect(userContent).toContain('"description":"79 500 km, diesel"');
    expect(userContent).not.toMatch(/cookie|account_id|diagnostic|seller_contact|profile_url/i);
  });

  it("rejects seller contact data before making a provider request", async () => {
    fake = await FakeDeepSeekServer.start((_request, response) => json(response, 200, completion(enrichment())));
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: fake.url });

    await expect(client.enrich({
      ...input(), description: "Call +351 912 345 678"
    })).rejects.toMatchObject({ kind: "invalid_response" });
    expect(fake.requests).toEqual([]);
  });

  it("sends only the allowlisted mileage source metadata", async () => {
    fake = await FakeDeepSeekServer.start((_request, response) => json(response, 200, completion(enrichment())));
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: fake.url });

    await client.enrich({
      ...input(),
      sourceFacts: {
        mileageKm: {
          structuredKm: 297_000,
          descriptionKm: 287_000,
          cardKm: null,
          selectedKm: 297_000,
          source: "facebook_structured",
          conflict: true
        }
      },
      sellerName: "must-not-leak"
    } as EnrichmentInput);
    const messages = fake.requests[0]?.body.messages as Array<{ role: string; content: string }>;
    const userContent = messages.find(({ role }) => role === "user")?.content ?? "";
    expect(userContent).toContain('"structuredKm":297000');
    expect(userContent).toContain('"descriptionKm":287000');
    expect(userContent).toContain('"conflict":true');
    expect(userContent).not.toContain("sellerName");
  });

  it("sends allowlisted structured vehicle metadata as source facts", async () => {
    fake = await FakeDeepSeekServer.start((_request, response) => json(response, 200, completion(enrichment())));
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: fake.url });

    await client.enrich({
      ...input(),
      sourceFacts: {
        mileageKm: {
          structuredKm: null,
          descriptionKm: null,
          cardKm: null,
          selectedKm: null,
          source: "none",
          conflict: false
        },
        structuredVehicle: {
          year: 2020,
          mileageKm: null,
          make: "Volkswagen",
          model: "Golf",
          variant: null,
          fuel: "diesel",
          transmission: "manual",
          powerHp: null
        }
      }
    });
    const messages = fake.requests[0]?.body.messages as Array<{ role: string; content: string }>;
    const userContent = messages.find(({ role }) => role === "user")?.content ?? "";
    expect(userContent).toContain('"structuredVehicle"');
    expect(userContent).toContain('"make":"Volkswagen"');
    expect(userContent).toContain('"fuel":"diesel"');
  });

  it("fails closed for malformed or schema-invalid responses", async () => {
    let count = 0;
    fake = await FakeDeepSeekServer.start((_request, response) => {
      count += 1;
      json(response, 200, count === 1
        ? { id: "bad", choices: [{ finish_reason: "stop", message: { content: "not json" } }] }
        : completion({ ...enrichment(), unexpected: true }));
    });
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: fake.url });

    await expect(client.enrich(input())).rejects.toMatchObject({ kind: "invalid_response" });
    await expect(client.enrich(input())).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it.each([
    [402, "insufficient_credit"],
    [429, "rate_limited"],
    [401, "authentication"],
    [503, "upstream_failure"]
  ] as const)("classifies HTTP %i as %s without parsing the error body", async (status, kind) => {
    fake = await FakeDeepSeekServer.start((_request, response) => {
      json(response, status, { error: { message: "do not persist this provider detail" } });
    });
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: fake.url });

    await expect(client.enrich(input())).rejects.toMatchObject({ kind, httpStatus: status });
  });

  it("times out and does not accept a late response", async () => {
    fake = await FakeDeepSeekServer.start((_request, response) => {
      setTimeout(() => json(response, 200, completion(enrichment())), 50);
    });
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: fake.url, timeoutMs: 5 });

    await expect(client.enrich(input())).rejects.toMatchObject({ kind: "timeout" });
  });

  it("requires an explicit available balance", async () => {
    let available = false;
    fake = await FakeDeepSeekServer.start((request, response) => {
      expect(request.url).toBe("/user/balance");
      json(response, 200, { is_available: available, balance_infos: [] });
    });
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: fake.url });

    await expect(client.hasAvailableCredit()).resolves.toBe(false);
    available = true;
    await expect(client.hasAvailableCredit()).resolves.toBe(true);
  });
});

interface CapturedRequest {
  url: string | undefined;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

class FakeDeepSeekServer {
  public readonly requests: CapturedRequest[] = [];

  private constructor(
    private readonly server: Server,
    public readonly url: string
  ) {}

  public static async start(
    responder: (request: IncomingMessage, response: ServerResponse) => void
  ): Promise<FakeDeepSeekServer> {
    let instance: FakeDeepSeekServer;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");
      instance.requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body: raw === "" ? {} : JSON.parse(raw) as Record<string, unknown>
      });
      responder(request, response);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Fake server did not bind");
    instance = new FakeDeepSeekServer(server, `http://127.0.0.1:${address.port}`);
    return instance;
  }

  public async close(): Promise<void> {
    this.server.close();
    await once(this.server, "close");
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function completion(value: unknown): unknown {
  return {
    id: "request-1",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }]
  };
}

function input(): EnrichmentInput {
  return {
    title: "BMW 320d 2020",
    description: "79 500 km, diesel",
    facts: {
      priceCents: 2_490_000, year: 2020, mileageKm: 79_500, make: "BMW", model: "320d",
      variant: null, fuel: "diesel", transmission: "automatic", powerHp: 190,
      sellerType: "dealer",
      indicators: { financing: false, monthlyPayment: false, deposit: false, damaged: false, imported: false }
    }
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

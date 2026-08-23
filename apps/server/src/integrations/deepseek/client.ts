import {
  DEEPSEEK_ENRICHMENT_MODEL,
  parseVehicleEnrichmentJson,
  type EnrichmentInput,
  type VehicleEnrichment
} from "@dealfinder/domain";

export type DeepSeekFailureKind =
  | "invalid_response"
  | "timeout"
  | "rate_limited"
  | "insufficient_credit"
  | "authentication"
  | "upstream_failure";

export class DeepSeekError extends Error {
  public constructor(
    public readonly kind: DeepSeekFailureKind,
    message: string,
    public readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export interface DeepSeekResult {
  enrichment: VehicleEnrichment;
  providerRequestId: string | null;
}

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const SYSTEM_PROMPT = `You enrich vehicle marketplace listings. Return JSON only.
Never return seller identity, contact details, URLs, account data, diagnostics, credentials, or quoted evidence.
Use exactly this object shape and no additional fields:
{"schemaVersion":1,"vehicle":{"make":null,"model":null,"variant":null,"year":null,"mileageKm":null,"fuel":null,"transmission":null,"powerHp":null},"price":{"amountCents":null,"interpretation":"unknown"},"sellerType":null,"indicators":{"financing":false,"monthlyPayment":false,"deposit":false,"damaged":false,"imported":false},"uncertainties":[]}
Allowed fuel values: petrol, diesel, hybrid, plug_in_hybrid, electric, lpg, other, or null.
Allowed transmission values: manual, automatic, or null. Allowed sellerType: private, dealer, or null.
Allowed price interpretation: full_price, monthly_payment, deposit, unknown.
Allowed uncertainties: price_interpretation, vehicle_identity, year, mileage, fuel, transmission, power, seller_type, condition, import_status.`;

export class DeepSeekClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  public constructor(options: DeepSeekClientOptions) {
    if (options.apiKey.trim() === "") throw new Error("A DeepSeek API key is required");
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async enrich(input: EnrichmentInput): Promise<DeepSeekResult> {
    const providerInput = privacySafeInput(input);
    const response = await this.request("/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: DEEPSEEK_ENRICHMENT_MODEL,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        stream: false,
        max_tokens: 1000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Enrich this listing as JSON:\n${JSON.stringify(providerInput)}` }
        ]
      })
    });
    const body = await readJson(response);
    const root = object(body);
    const choices = root?.choices;
    const first = Array.isArray(choices) ? object(choices[0]) : undefined;
    const message = object(first?.message);
    if (first?.finish_reason !== "stop" || typeof message?.content !== "string" || message.content.trim() === "") {
      throw new DeepSeekError("invalid_response", "DeepSeek returned an incomplete response", response.status);
    }
    try {
      return {
        enrichment: parseVehicleEnrichmentJson(message.content),
        providerRequestId: typeof root?.id === "string" ? root.id.slice(0, 200) : null
      };
    } catch {
      throw new DeepSeekError("invalid_response", "DeepSeek returned schema-invalid JSON", response.status);
    }
  }

  /** A successful HTTP response is not enough: the balance must explicitly be available. */
  public async hasAvailableCredit(): Promise<boolean> {
    const response = await this.request("/user/balance", {
      method: "GET",
      headers: { authorization: `Bearer ${this.#apiKey}` }
    });
    const root = object(await readJson(response));
    if (typeof root?.is_available !== "boolean" || !Array.isArray(root.balance_infos)) {
      throw new DeepSeekError("invalid_response", "DeepSeek returned an invalid balance response", response.status);
    }
    return root.is_available;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, { ...init, signal: controller.signal });
      if (response.ok) return response;
      throw statusError(response.status);
    } catch (error: unknown) {
      if (error instanceof DeepSeekError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new DeepSeekError("timeout", "DeepSeek request timed out");
      }
      throw new DeepSeekError("upstream_failure", "DeepSeek request failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

const PROHIBITED_LISTING_TEXT = /(?:\b[\w.+-]+@[\w.-]+\.\w{2,}\b|(?:\+?\d[\s().-]*){9,}|wa\.me|whatsapp|facebook\.com\/(?:profile|people|user)|mailto:|tel:)/iu;

/** Reconstructs the allowlisted wire shape so runtime-added properties cannot escape. */
function privacySafeInput(input: EnrichmentInput): EnrichmentInput {
  if (PROHIBITED_LISTING_TEXT.test(input.title) ||
      (input.description !== null && PROHIBITED_LISTING_TEXT.test(input.description))) {
    throw new DeepSeekError("invalid_response", "Listing text contains prohibited seller contact data");
  }
  return {
    title: input.title,
    description: input.description,
    facts: {
      priceCents: input.facts.priceCents,
      year: input.facts.year,
      mileageKm: input.facts.mileageKm,
      make: input.facts.make,
      model: input.facts.model,
      variant: input.facts.variant,
      fuel: input.facts.fuel,
      transmission: input.facts.transmission,
      powerHp: input.facts.powerHp,
      sellerType: input.facts.sellerType,
      indicators: {
        financing: input.facts.indicators.financing,
        monthlyPayment: input.facts.indicators.monthlyPayment,
        deposit: input.facts.indicators.deposit,
        damaged: input.facts.indicators.damaged,
        imported: input.facts.indicators.imported
      }
    }
  };
}

function statusError(status: number): DeepSeekError {
  if (status === 402) return new DeepSeekError("insufficient_credit", "DeepSeek credit is exhausted", status);
  if (status === 429) return new DeepSeekError("rate_limited", "DeepSeek rate limited the request", status);
  if (status === 401 || status === 403) {
    return new DeepSeekError("authentication", "DeepSeek authentication failed", status);
  }
  return new DeepSeekError("upstream_failure", "DeepSeek returned an upstream error", status);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new DeepSeekError("invalid_response", "DeepSeek returned a non-JSON response", response.status);
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

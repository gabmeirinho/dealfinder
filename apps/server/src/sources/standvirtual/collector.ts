import { parseStandvirtualResults, validateSearchUrl } from "./parser.js";

const MAX_HTML_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 15;
const PAGE_PARSE_LIMIT = 50;
const MAX_LISTINGS = 800;

export type StandvirtualCollectionStopReason =
  | "listing_limit"
  | "results_end"
  | "no_progress"
  | "page_limit"
  | "request_error";

export interface StandvirtualCollectionOptions {
  limit?: number;
  fetchHtml?: (url: string) => Promise<string>;
}

/** Collects newest-first result pages while retaining safe partial results. */
export async function collectStandvirtualResults(
  inputUrl: string,
  options: StandvirtualCollectionOptions = {}
) {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LISTINGS) {
    throw new Error(`Limit must be between 1 and ${MAX_LISTINGS}.`);
  }
  const baseUrl = new URL(validateSearchUrl(inputUrl));
  baseUrl.searchParams.set("search[order]", "created_at_first:desc");
  baseUrl.searchParams.delete("page");
  const fetchHtml = options.fetchHtml ?? fetchResultsHtml;
  const listings: ReturnType<typeof parseStandvirtualResults>["listings"] = [];
  const seen = new Set<string>();
  let recognizedCards = 0;
  let rejectedCards = 0;
  let duplicateCards = 0;
  let pagesScanned = 0;
  let pagesWithoutProgress = 0;
  let stopReason: StandvirtualCollectionStopReason = "page_limit";
  let partialError: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = pageUrl(baseUrl, page);
    let parsed: ReturnType<typeof parseStandvirtualResults>;
    try {
      parsed = parseStandvirtualResults(await fetchHtml(url), PAGE_PARSE_LIMIT);
    } catch (error: unknown) {
      if (listings.length === 0) throw error;
      const message = error instanceof Error ? error.message : "Standvirtual page request failed";
      if (message.startsWith("No recognized Standvirtual listings.")) {
        stopReason = "results_end";
      } else {
        stopReason = "request_error";
        partialError = message;
      }
      break;
    }
    pagesScanned++;
    recognizedCards += parsed.recognizedCards;
    rejectedCards += parsed.rejectedCards;
    duplicateCards += parsed.duplicateCards;
    let added = 0;
    for (const listing of parsed.listings) {
      if (seen.has(listing.sourceListingId)) {
        duplicateCards++;
        continue;
      }
      seen.add(listing.sourceListingId);
      listings.push(listing);
      added++;
      if (listings.length === limit) break;
    }
    if (listings.length === limit) {
      stopReason = "listing_limit";
      break;
    }
    pagesWithoutProgress = added === 0 ? pagesWithoutProgress + 1 : 0;
    if (pagesWithoutProgress >= 2) {
      stopReason = "no_progress";
      break;
    }
  }

  return {
    source: "standvirtual" as const,
    parserVersion: 1,
    scope: "paginated" as const,
    order: "newest_first" as const,
    recognizedCards,
    rejectedCards,
    duplicateCards,
    limitReached: listings.length === limit,
    requestedLimit: limit,
    pagesScanned,
    stopReason,
    partialError,
    listings
  };
}

function pageUrl(baseUrl: URL, page: number): string {
  const url = new URL(baseUrl);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

async function fetchResultsHtml(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Standvirtual HTTP ${response.status}.`);
  }
  if (!response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    throw new Error("Expected an HTML results page.");
  }
  if (!response.body) throw new Error("Empty HTTP body.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_HTML_BYTES) throw new Error("HTML exceeds 10 MiB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

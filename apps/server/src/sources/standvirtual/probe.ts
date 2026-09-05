import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { collectStandvirtualResults } from "./collector.js";
import { parseStandvirtualResults, validateSearchUrl } from "./parser.js";
import { buildStandvirtualModelSearch } from "./search-builder.js";

const MAX_BYTES = 10 * 1024 * 1024;

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string" },
    make: { type: "string" },
    model: { type: "string" },
    fuel: { type: "string" },
    "max-price": { type: "string" },
    budget: { type: "string" },
    html: { type: "string" },
    browser: { type: "boolean", default: false },
    limit: { type: "string", default: "20" },
    help: { type: "boolean", default: false }
  } });
  if (values.help) {
    console.log("Standvirtual feasibility probe (paginated HTTP collection, no database writes)\n"
      + "--make <vehicle make> --model <vehicle model> [--fuel petrol] [--budget <EUR>] --limit <1-100>\n"
      + "--max-price <EUR>  Optional source cap; omit for unbiased market evidence\n"
      + "--url <public results URL> --limit <1-100>\n"
      + "--browser  Open visible Chromium; manually prepare results, then press Enter\n"
      + "--html <file>  Parse locally saved HTML without network access\n"
      + "JSON report goes to stdout; diagnostics go to stderr.");
    return;
  }
  if (values.html && values.browser) throw new Error("Choose --html or --browser, not both.");
  const hasModelTarget = values.make !== undefined || values.model !== undefined;
  if ((values.make === undefined) !== (values.model === undefined)) {
    throw new Error("Use --make and --model together.");
  }
  if (values.url !== undefined && hasModelTarget) {
    throw new Error("Choose --url or --make with --model, not both.");
  }
  if ((values.fuel !== undefined || values["max-price"] !== undefined) && !hasModelTarget) {
    throw new Error("Use --fuel and --max-price with --make and --model.");
  }
  if (values.fuel !== undefined && values.fuel !== "petrol") {
    throw new Error("The Standvirtual probe currently supports --fuel petrol.");
  }
  const maximumPriceEur = values["max-price"] === undefined
    ? undefined
    : Number(values["max-price"]);
  const personalBudgetEur = values.budget === undefined ? null : requireEuroAmount(values.budget, "Budget");
  const modelSearch = hasModelTarget
    ? buildStandvirtualModelSearch(values.make ?? "", values.model ?? "", {
      ...(values.fuel === "petrol" ? { fuel: "petrol" as const } : {}),
      ...(maximumPriceEur === undefined ? {} : { maximumPriceEur })
    })
    : null;
  const url = validateSearchUrl(modelSearch?.url ?? values.url ?? "https://www.standvirtual.com/carros");
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be between 1 and 100.");
  const mode = values.html ? "saved_html" : values.browser ? "browser" : "http";
  if (mode !== "http" && limit > 50) {
    throw new Error("Browser and saved HTML modes are single-page and support at most 50 listings.");
  }
  let report;
  if (values.html) {
    if ((await stat(values.html)).size > MAX_BYTES) throw new Error("HTML exceeds 10 MiB.");
    report = parseStandvirtualResults(await readFile(values.html, "utf8"), limit);
  } else if (values.browser) {
    if (!process.stdin.isTTY) throw new Error("Browser mode requires an interactive terminal.");
    const browser = await chromium.launch({ headless: false });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try { await prompt.question("Prepare the public results page in Chromium, then press Enter to capture: "); }
      finally { prompt.close(); }
      validateSearchUrl(page.url());
      report = parseStandvirtualResults(await page.content(), limit);
    } finally { await browser.close(); }
  } else {
    report = await collectStandvirtualResults(url, { limit });
  }
  const eligibleCount = personalBudgetEur === null ? null : report.listings.filter((listing) =>
    listing.facts.priceCents !== null && listing.facts.priceCents <= personalBudgetEur * 100).length;
  console.log(JSON.stringify({ ...report, mode, request: {
    url,
    modelTarget: modelSearch?.target ?? null,
    standvirtualIds: modelSearch?.standvirtualIds ?? null,
    filters: modelSearch?.filters ?? null,
    personalBudgetEur
  }, eligibility: personalBudgetEur === null ? null : {
    maximumPriceEur: personalBudgetEur,
    eligibleCount,
    ineligibleCount: report.listings.length - (eligibleCount ?? 0)
  }, capturedAt: new Date().toISOString(),
    warnings: ["Experimental parser: verify extracted facts against the page.",
      `${mode === "http" ? "Paginated" : "Single-page"} sample only; no deal ranking, database ingestion, or scheduled scans.`] }, null, 2));
}

function requireEuroAmount(value: string, label: string): number {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) {
    throw new Error(`${label} must be an integer between 1 and 10000000 EUR.`);
  }
  return amount;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ source: "standvirtual", status: "failed",
    error: error instanceof Error ? error.message : "Probe failed" }));
  process.exitCode = 1;
});

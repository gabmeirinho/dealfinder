import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { DatabaseConnection } from "@dealfinder/db";
import type {
  DiagnosticArtifactMetadata,
  FacebookFailureKind
} from "@dealfinder/domain";
import { parse } from "parse5";

interface HtmlAttribute {
  name: string;
  value: string;
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
}

export interface DiagnosticCaptureInput {
  failureKind: FacebookFailureKind;
  detail: string;
  searchId: string | null;
  pageUrl: string;
  rawHtml: string;
  screenshot: Uint8Array | null;
}

export interface DiagnosticsServiceOptions {
  directory: string;
  database: () => DatabaseConnection;
  enabled?: boolean;
  now?: () => Date;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const OMITTED_TAGS = new Set(["script", "style", "svg", "form", "input", "textarea", "meta", "link"]);
const SAFE_TAGS = new Set([
  "html", "body", "main", "section", "article", "div", "span", "a", "img",
  "h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "button", "header", "footer", "nav"
]);

export class DiagnosticsService {
  readonly #directory: string;
  readonly #database: () => DatabaseConnection;
  readonly #enabled: boolean;
  readonly #now: () => Date;

  public constructor(options: DiagnosticsServiceOptions) {
    this.#directory = resolve(options.directory);
    this.#database = options.database;
    this.#enabled = options.enabled ?? true;
    this.#now = options.now ?? (() => new Date());
  }

  public async capture(input: DiagnosticCaptureInput): Promise<DiagnosticArtifactMetadata> {
    await this.cleanupExpired();
    const createdAt = this.#now();
    const expiresAt = new Date(createdAt.getTime() + RETENTION_MS);
    let screenshotPath: string | null = null;
    let domPath: string | null = null;
    const written: string[] = [];

    try {
      if (this.#enabled) {
        await mkdir(this.#directory, { recursive: true, mode: 0o700 });
        const basename = `${createdAt.toISOString().replaceAll(":", "-")}-${randomUUID()}`;
        domPath = resolve(this.#directory, `${basename}.sanitized.html`);
        await writeFile(
          domPath,
          sanitizeDiagnosticDom(input.rawHtml, input.failureKind, input.detail, input.pageUrl),
          { encoding: "utf8", flag: "wx", mode: 0o600 }
        );
        written.push(domPath);
        if (input.screenshot !== null) {
          screenshotPath = resolve(this.#directory, `${basename}.png`);
          await writeFile(screenshotPath, input.screenshot, { flag: "wx", mode: 0o600 });
          written.push(screenshotPath);
        }
      }
      return this.#database().facebookHealth.createDiagnostic({
        failureKind: input.failureKind,
        searchId: input.searchId,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        screenshotPath,
        domPath
      });
    } catch (error: unknown) {
      await Promise.all(written.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }
  }

  public async cleanupExpired(): Promise<number> {
    const expired = this.#database().facebookHealth
      .listExpiredDiagnostics(this.#now().toISOString());
    for (const artifact of expired) {
      for (const path of [artifact.screenshotPath, artifact.domPath]) {
        if (path !== null && this.isOwnedPath(path)) await unlink(path).catch(() => undefined);
      }
      this.#database().facebookHealth.deleteDiagnostic(artifact.id);
    }
    return expired.length;
  }

  private isOwnedPath(path: string): boolean {
    const candidate = resolve(path);
    return candidate.startsWith(`${this.#directory}${sep}`);
  }
}

export function sanitizeDiagnosticDom(
  rawHtml: string,
  failureKind: FacebookFailureKind,
  detail: string,
  pageUrl: string
): string {
  const document = parse(rawHtml) as unknown as HtmlNode;
  const path = safePagePath(pageUrl);
  let remainingNodes = 20_000;

  const render = (node: HtmlNode, depth: number): string => {
    if (remainingNodes <= 0 || depth > 50) return "";
    remainingNodes -= 1;
    if (node.nodeName === "#text" || node.nodeName === "#comment") return "";
    const tag = node.tagName;
    if (tag === undefined) return (node.childNodes ?? []).map((child) => render(child, depth)).join("");
    if (OMITTED_TAGS.has(tag)) return "";
    const children = (node.childNodes ?? []).map((child) => render(child, depth + 1)).join("");
    if (!SAFE_TAGS.has(tag)) return children;
    const attributes = safeAttributes(node);
    return `<${tag}${attributes}>${children}</${tag}>`;
  };

  return `<!doctype html><html><body><header data-dealfinder-diagnostic="${failureKind}" data-page-path="${escapeHtml(path)}"><p>${escapeHtml(detail)}</p></header>${render(document, 0)}</body></html>`;
}

function safeAttributes(node: HtmlNode): string {
  const values: string[] = [];
  for (const attribute of node.attrs ?? []) {
    if (
      ["role", "data-testid", "aria-busy"].includes(attribute.name) &&
      /^[a-zA-Z0-9_-]{1,100}$/u.test(attribute.value)
    ) values.push(`${attribute.name}="${escapeHtml(attribute.value)}"`);
    if (attribute.name === "href") {
      const id = marketplaceItemId(attribute.value);
      if (id !== null) values.push(`data-marketplace-item="${id}"`);
    }
  }
  return values.length === 0 ? "" : ` ${values.join(" ")}`;
}

function marketplaceItemId(value: string): string | null {
  try {
    return new URL(value, "https://www.facebook.com").pathname
      .match(/^\/marketplace\/(?:(?:shops|np)\/)?item\/(\d+)(?:\/|$)/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function safePagePath(value: string): string {
  try {
    const safeSegments = new Set([
      "login", "checkpoint", "marketplace", "category", "vehicles", "item",
      "privacy", "consent"
    ]);
    const segments = new URL(value).pathname.split("/").filter(Boolean).map((segment) =>
      safeSegments.has(segment.toLocaleLowerCase("en")) ? segment : ":redacted"
    );
    return `/${segments.join("/")}${segments.length === 0 ? "" : "/"}`.slice(0, 500);
  } catch {
    return "unknown";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

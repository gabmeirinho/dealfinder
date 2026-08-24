import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { DatabaseConnection, StoredThumbnailMetadata } from "@dealfinder/db";
import { createImageDifferenceHash } from "@dealfinder/domain";
import sharp from "sharp";

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;
const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_CONTENT_TYPES = new Set(["image/avif", "image/jpeg", "image/png", "image/webp"]);

export interface CachedThumbnail {
  metadata: StoredThumbnailMetadata;
  imageDifferenceHash: string;
}

export interface ThumbnailStorageOptions {
  directory: string;
  database: () => DatabaseConnection;
  fetch?: typeof fetch;
  now?: () => Date;
  allowedHosts?: readonly string[];
}

export class ThumbnailStorage {
  readonly #directory: string;
  readonly #database: () => DatabaseConnection;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #allowedHosts: readonly string[] | undefined;

  public constructor(options: ThumbnailStorageOptions) {
    this.#directory = options.directory;
    this.#database = options.database;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#allowedHosts = options.allowedHosts;
  }

  public async cache(listingId: number, sourceUrl: string): Promise<CachedThumbnail> {
    const url = validateSourceUrl(sourceUrl, this.#allowedHosts);
    const sourceUrlSha256 = digest(url.href);
    const relativePath = `${listingId}.webp`;
    const path = join(this.#directory, relativePath);
    const existing = this.#database().duplicates.getThumbnail(listingId);
    const fingerprint = this.#database().duplicates.getFingerprint(listingId);
    if (existing?.sourceUrlSha256 === sourceUrlSha256 && fingerprint?.imageDifferenceHash != null) {
      try {
        await readFile(path);
        return { metadata: existing, imageDifferenceHash: fingerprint.imageDifferenceHash };
      } catch {
        // A missing cache file is repaired by downloading it again.
      }
    }

    const response = await this.#fetch(url, {
      headers: { accept: "image/avif,image/webp,image/jpeg,image/png" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Thumbnail download failed with HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType === undefined || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new Error("Thumbnail response is not a supported raster image");
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_DOWNLOAD_BYTES) {
      throw new Error("Thumbnail exceeds the download limit");
    }
    const input = await readBoundedBody(response, MAX_DOWNLOAD_BYTES);
    const processed = await processThumbnail(input);
    await mkdir(this.#directory, { recursive: true });
    const temporaryPath = join(this.#directory, `.${listingId}-${process.pid}.tmp`);
    await writeFile(temporaryPath, processed.webp, { mode: 0o600 });
    await rename(temporaryPath, path);
    const cachedAt = this.#now().toISOString();
    const metadata = this.#database().duplicates.saveThumbnail({
      listingId,
      sourceUrlSha256,
      relativePath,
      byteSize: processed.webp.byteLength,
      width: processed.width,
      height: processed.height,
      cachedAt,
      expiresAt: null
    });
    return { metadata, imageDifferenceHash: processed.imageDifferenceHash };
  }

  public syncRetention(listingId: number, inactiveAt: string | null): void {
    const expiresAt = inactiveAt === null
      ? null
      : new Date(Date.parse(inactiveAt) + RETENTION_MILLISECONDS).toISOString();
    this.#database().duplicates.setThumbnailExpiry(listingId, expiresAt);
  }

  public async cleanupExpired(at = this.#now().toISOString()): Promise<number> {
    let deleted = 0;
    for (const thumbnail of this.#database().duplicates.listDueThumbnails(at)) {
      const safeName = basename(thumbnail.relativePath);
      if (safeName !== thumbnail.relativePath || safeName !== `${thumbnail.listingId}.webp`) continue;
      try {
        await unlink(join(this.#directory, safeName));
      } catch (error: unknown) {
        if (!isMissingFile(error)) throw error;
      }
      if (this.#database().duplicates.deleteThumbnail(thumbnail.listingId)) deleted += 1;
    }
    return deleted;
  }
}

async function processThumbnail(input: Buffer): Promise<{
  webp: Buffer;
  width: number;
  height: number;
  imageDifferenceHash: string;
}> {
  const options = { failOn: "warning" as const, limitInputPixels: MAX_INPUT_PIXELS, pages: 1 };
  const output = await sharp(input, options)
    .rotate()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true });
  const greyscale = await sharp(input, options)
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  return {
    webp: output.data,
    width: output.info.width,
    height: output.info.height,
    imageDifferenceHash: createImageDifferenceHash(greyscale)
  };
}

async function readBoundedBody(response: Response, limit: number): Promise<Buffer> {
  if (response.body === null) throw new Error("Thumbnail response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Thumbnail exceeds the download limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function validateSourceUrl(raw: string, allowedHosts?: readonly string[]): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error("Thumbnail URL must be credential-free HTTPS");
  }
  const hostname = url.hostname.toLowerCase();
  const allowed = allowedHosts === undefined
    ? hostname === "facebook.com" || hostname.endsWith(".facebook.com") ||
      hostname.endsWith(".fbcdn.net") || hostname.endsWith(".fbsbx.com")
    : allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) throw new Error("Thumbnail host is not allowed");
  return url;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

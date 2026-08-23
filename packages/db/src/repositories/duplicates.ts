import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  DUPLICATE_FINGERPRINT_VERSION,
  type DuplicatePairEvidence,
  type ProbableDuplicateGroup,
  type VehicleDuplicateFingerprint
} from "@dealfinder/domain";

import { withTransaction } from "../transactions.js";

interface FingerprintRow {
  listing_id: number;
  text_sha256: string;
  text_token_count: number;
  vehicle_sha256: string;
  vehicle_fingerprint_json: string;
  image_difference_hash: string | null;
  computed_at: string;
}

interface ThumbnailRow {
  listing_id: number;
  source_url_sha256: string;
  relative_path: string;
  byte_size: number;
  width: number;
  height: number;
  cached_at: string;
  expires_at: string | null;
}

interface GroupRow {
  id: string;
  confidence: StoredDuplicateGroup["confidence"];
  explanation: string;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  listing_id: number;
  source: "facebook";
  source_listing_id: string;
  listing_url: string;
  title: string;
}

interface PairRow {
  left_listing_id: number;
  right_listing_id: number;
  confidence: DuplicatePairEvidence["confidence"];
  vehicle_similarity: number;
  text_similarity: number;
  image_similarity: number | null;
  explanation: string;
}

export interface StoredListingFingerprint {
  listingId: number;
  version: typeof DUPLICATE_FINGERPRINT_VERSION;
  textSha256: string;
  textTokenCount: number;
  vehicleSha256: string;
  vehicle: VehicleDuplicateFingerprint;
  imageDifferenceHash: string | null;
  computedAt: string;
}

export interface SaveThumbnailMetadata {
  listingId: number;
  sourceUrlSha256: string;
  relativePath: string;
  byteSize: number;
  width: number;
  height: number;
  cachedAt: string;
  expiresAt: string | null;
}

export interface StoredThumbnailMetadata extends SaveThumbnailMetadata {
  contentType: "image/webp";
}

export interface StoredDuplicateMember {
  listingId: number;
  source: "facebook";
  sourceListingId: string;
  listingUrl: string;
  title: string;
}

export interface StoredDuplicateGroup {
  id: string;
  confidence: "medium" | "high";
  explanation: string;
  members: StoredDuplicateMember[];
  pairEvidence: DuplicatePairEvidence[];
  createdAt: string;
  updatedAt: string;
}

export class DuplicatesRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public saveFingerprint(
    listingId: number,
    textTokens: readonly string[],
    vehicle: VehicleDuplicateFingerprint,
    imageDifferenceHash: string | null,
    computedAt: string
  ): StoredListingFingerprint {
    validateTimestamp(computedAt, "Computed at");
    if (imageDifferenceHash !== null && !/^[0-9a-f]{16}$/u.test(imageDifferenceHash)) {
      throw new Error("Image difference hash must be 64-bit lowercase hexadecimal");
    }
    const textSha256 = sha256(JSON.stringify([...textTokens].sort()));
    const vehicleJson = JSON.stringify(vehicle);
    const vehicleSha256 = sha256(vehicleJson);
    this.database.prepare(`
      INSERT INTO listing_fingerprints (
        listing_id, fingerprint_version, text_sha256, text_token_count,
        vehicle_sha256, vehicle_fingerprint_json, image_difference_hash, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        fingerprint_version = excluded.fingerprint_version,
        text_sha256 = excluded.text_sha256,
        text_token_count = excluded.text_token_count,
        vehicle_sha256 = excluded.vehicle_sha256,
        vehicle_fingerprint_json = excluded.vehicle_fingerprint_json,
        image_difference_hash = excluded.image_difference_hash,
        computed_at = excluded.computed_at
    `).run(
      listingId,
      DUPLICATE_FINGERPRINT_VERSION,
      textSha256,
      textTokens.length,
      vehicleSha256,
      vehicleJson,
      imageDifferenceHash,
      computedAt
    );
    return this.getFingerprint(listingId) as StoredListingFingerprint;
  }

  public getFingerprint(listingId: number): StoredListingFingerprint | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, text_sha256, text_token_count, vehicle_sha256,
             vehicle_fingerprint_json, image_difference_hash, computed_at
      FROM listing_fingerprints WHERE listing_id = ?
    `).get(listingId) as unknown as FingerprintRow | undefined;
    return row === undefined ? undefined : mapFingerprint(row);
  }

  public saveThumbnail(input: SaveThumbnailMetadata): StoredThumbnailMetadata {
    validateTimestamp(input.cachedAt, "Cached at");
    if (input.expiresAt !== null) validateTimestamp(input.expiresAt, "Expires at");
    if (!/^[0-9a-f]{64}$/u.test(input.sourceUrlSha256)) throw new Error("Source URL digest is invalid");
    this.database.prepare(`
      INSERT INTO listing_thumbnails (
        listing_id, source_url_sha256, relative_path, content_type, byte_size,
        width, height, cached_at, expires_at
      ) VALUES (?, ?, ?, 'image/webp', ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        source_url_sha256 = excluded.source_url_sha256,
        relative_path = excluded.relative_path,
        content_type = excluded.content_type,
        byte_size = excluded.byte_size,
        width = excluded.width,
        height = excluded.height,
        cached_at = excluded.cached_at,
        expires_at = excluded.expires_at
    `).run(
      input.listingId,
      input.sourceUrlSha256,
      input.relativePath,
      input.byteSize,
      input.width,
      input.height,
      input.cachedAt,
      input.expiresAt
    );
    return this.getThumbnail(input.listingId) as StoredThumbnailMetadata;
  }

  public getThumbnail(listingId: number): StoredThumbnailMetadata | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, source_url_sha256, relative_path, byte_size,
             width, height, cached_at, expires_at
      FROM listing_thumbnails WHERE listing_id = ?
    `).get(listingId) as unknown as ThumbnailRow | undefined;
    return row === undefined ? undefined : mapThumbnail(row);
  }

  public setThumbnailExpiry(listingId: number, expiresAt: string | null): void {
    if (expiresAt !== null) validateTimestamp(expiresAt, "Expires at");
    this.database.prepare(`
      UPDATE listing_thumbnails SET expires_at = ? WHERE listing_id = ?
    `).run(expiresAt, listingId);
  }

  public listDueThumbnails(at: string): StoredThumbnailMetadata[] {
    validateTimestamp(at, "Expiry time");
    return (this.database.prepare(`
      SELECT listing_id, source_url_sha256, relative_path, byte_size,
             width, height, cached_at, expires_at
      FROM listing_thumbnails
      WHERE expires_at IS NOT NULL AND expires_at <= ?
      ORDER BY expires_at ASC, listing_id ASC
    `).all(at) as unknown as ThumbnailRow[]).map(mapThumbnail);
  }

  public deleteThumbnail(listingId: number): boolean {
    return Number(this.database.prepare(`
      DELETE FROM listing_thumbnails WHERE listing_id = ?
    `).run(listingId).changes) === 1;
  }

  public replaceGroups(groups: readonly ProbableDuplicateGroup[], updatedAt: string): StoredDuplicateGroup[] {
    validateTimestamp(updatedAt, "Updated at");
    return withTransaction(this.database, () => {
      const createdById = new Map((this.database.prepare(`
        SELECT id, created_at FROM duplicate_groups
      `).all() as unknown as Array<{ id: string; created_at: string }>).map((row) => [row.id, row.created_at]));
      this.database.prepare("DELETE FROM duplicate_groups").run();
      for (const group of groups) {
        const members = [...group.memberListingIds].sort((left, right) => left - right);
        if (members.length < 2 || new Set(members).size !== members.length) {
          throw new Error("Duplicate groups require at least two unique members");
        }
        const id = sha256(members.join(","));
        this.database.prepare(`
          INSERT INTO duplicate_groups (id, confidence, explanation, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, group.confidence, group.explanation, createdById.get(id) ?? updatedAt, updatedAt);
        const insertMember = this.database.prepare(`
          INSERT INTO duplicate_group_members (group_id, listing_id, ordinal) VALUES (?, ?, ?)
        `);
        members.forEach((listingId, ordinal) => insertMember.run(id, listingId, ordinal));
        const insertPair = this.database.prepare(`
          INSERT INTO duplicate_pair_evidence (
            group_id, left_listing_id, right_listing_id, confidence,
            vehicle_similarity, text_similarity, image_similarity, explanation
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const pair of group.pairEvidence) {
          insertPair.run(
            id,
            pair.leftListingId,
            pair.rightListingId,
            pair.confidence,
            pair.vehicleSimilarity,
            pair.textSimilarity,
            pair.imageSimilarity,
            pair.explanation
          );
        }
      }
      return this.listGroups();
    });
  }

  public listGroups(): StoredDuplicateGroup[] {
    const groups = this.database.prepare(`
      SELECT id, confidence, explanation, created_at, updated_at
      FROM duplicate_groups ORDER BY id ASC
    `).all() as unknown as GroupRow[];
    return groups.map((group) => ({
      id: group.id,
      confidence: group.confidence,
      explanation: group.explanation,
      members: (this.database.prepare(`
        SELECT listings.id AS listing_id, listings.source, listings.source_listing_id,
               listings.listing_url, listings.title
        FROM duplicate_group_members members
        JOIN listings ON listings.id = members.listing_id
        WHERE members.group_id = ? ORDER BY members.ordinal ASC
      `).all(group.id) as unknown as MemberRow[]).map((row) => ({
        listingId: row.listing_id,
        source: row.source,
        sourceListingId: row.source_listing_id,
        listingUrl: row.listing_url,
        title: row.title
      })),
      pairEvidence: (this.database.prepare(`
        SELECT left_listing_id, right_listing_id, confidence, vehicle_similarity,
               text_similarity, image_similarity, explanation
        FROM duplicate_pair_evidence WHERE group_id = ?
        ORDER BY left_listing_id ASC, right_listing_id ASC
      `).all(group.id) as unknown as PairRow[]).map(mapPair),
      createdAt: group.created_at,
      updatedAt: group.updated_at
    }));
  }
}

function mapFingerprint(row: FingerprintRow): StoredListingFingerprint {
  return {
    listingId: row.listing_id,
    version: DUPLICATE_FINGERPRINT_VERSION,
    textSha256: row.text_sha256,
    textTokenCount: row.text_token_count,
    vehicleSha256: row.vehicle_sha256,
    vehicle: JSON.parse(row.vehicle_fingerprint_json) as VehicleDuplicateFingerprint,
    imageDifferenceHash: row.image_difference_hash,
    computedAt: row.computed_at
  };
}

function mapThumbnail(row: ThumbnailRow): StoredThumbnailMetadata {
  return {
    listingId: row.listing_id,
    sourceUrlSha256: row.source_url_sha256,
    relativePath: row.relative_path,
    contentType: "image/webp",
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    cachedAt: row.cached_at,
    expiresAt: row.expires_at
  };
}

function mapPair(row: PairRow): DuplicatePairEvidence {
  return {
    leftListingId: row.left_listing_id,
    rightListingId: row.right_listing_id,
    confidence: row.confidence,
    vehicleSimilarity: row.vehicle_similarity,
    textSimilarity: row.text_similarity,
    imageSimilarity: row.image_similarity,
    explanation: row.explanation
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

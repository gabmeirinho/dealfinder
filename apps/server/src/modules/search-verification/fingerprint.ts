import { createHash } from "node:crypto";

import type { VehicleSearch } from "@dealfinder/domain";

export function fingerprintSearchCriteria(
  search: Pick<VehicleSearch, "criteria" | "location">
): string {
  return createHash("sha256")
    .update(stableSerialize({ criteria: search.criteria, location: search.location }))
    .digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

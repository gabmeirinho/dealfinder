import type { PublicServerConfig, ServerConfig } from "@dealfinder/domain";

export const REDACTED_VALUE = "[redacted]" as const;

const SECRET_KEY_PATTERN = /(token|api[-_]?key|secret|password|cookie|authorization)/iu;

export function redactConfig(config: ServerConfig): PublicServerConfig {
  return redactSecrets(config) as PublicServerConfig;
}

export function collectSecretValues(value: unknown): string[] {
  const values: string[] = [];
  collectSecrets(value, values);
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

export function serializeRedacted(
  value: unknown,
  secretValues: readonly string[] = collectSecretValues(value)
): string {
  return JSON.stringify(redactText(redactSecrets(value), secretValues), null, 2);
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SECRET_KEY_PATTERN.test(key) && typeof nestedValue === "string"
        ? REDACTED_VALUE
        : redactSecrets(nestedValue)
    ])
  );
}

function collectSecrets(value: unknown, values: string[], parentKey?: string): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSecrets(item, values, parentKey);
    }
    return;
  }

  if (!isRecord(value)) {
    if (typeof value === "string" && parentKey !== undefined && SECRET_KEY_PATTERN.test(parentKey)) {
      addSecretValue(value, values);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key) && typeof nestedValue === "string") {
      addSecretValue(nestedValue, values);
      continue;
    }

    collectSecrets(nestedValue, values, key);
  }
}

function addSecretValue(value: string, values: string[]): void {
  if (value.length > 0) {
    values.push(value);
  }
}

function redactText(value: unknown, secretValues: readonly string[]): unknown {
  if (typeof value === "string") {
    return secretValues.reduce(
      (result, secretValue) => result.split(secretValue).join(REDACTED_VALUE),
      value
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactText(item, secretValues));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      redactText(nestedValue, secretValues)
    ])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

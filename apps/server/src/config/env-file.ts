import { readFileSync } from "node:fs";

import { ConfigValidationError } from "./errors.js";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function readEnvFile(filePath: string): Record<string, string> {
  let source: string;

  try {
    source = readFileSync(filePath, "utf8");
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    throw new ConfigValidationError([
      {
        path: filePath,
        message: "could not be read; check that the file is accessible"
      }
    ]);
  }

  return parseEnvFile(source, filePath);
}

export function parseEnvFile(
  source: string,
  filePath = ".env.local"
): Record<string, string> {
  const values: Record<string, string> = {};
  const issues = [];

  for (const [index, sourceLine] of source.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const line = sourceLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = assignment.indexOf("=");

    if (separatorIndex < 1) {
      issues.push({
        path: `${filePath}:${lineNumber}`,
        message: "expected an environment assignment in KEY=VALUE form"
      });
      continue;
    }

    const key = assignment.slice(0, separatorIndex).trim();
    const rawValue = assignment.slice(separatorIndex + 1).trim();

    if (!ENV_KEY_PATTERN.test(key)) {
      issues.push({
        path: `${filePath}:${lineNumber}`,
        message: "environment variable names must contain only letters, numbers, and underscores"
      });
      continue;
    }

    const value = parseValue(rawValue);

    if (value === undefined) {
      issues.push({
        path: `${filePath}:${lineNumber}`,
        message: "quoted values must have matching quotation marks"
      });
      continue;
    }

    values[key] = value;
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return values;
}

function parseValue(value: string): string | undefined {
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      return undefined;
    }

    return value.slice(1, -1).replace(/\\([\\"nrt])/gu, (_, character: string) => {
      if (character === "n") return "\n";
      if (character === "r") return "\r";
      if (character === "t") return "\t";
      return character;
    });
  }

  if (value.startsWith("'")) {
    return value.endsWith("'") && value.length >= 2 ? value.slice(1, -1) : undefined;
  }

  return value;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}


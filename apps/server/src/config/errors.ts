import type { ConfigIssue } from "@dealfinder/domain";

export class ConfigValidationError extends Error {
  public readonly issues: readonly ConfigIssue[];

  public constructor(issues: readonly ConfigIssue[]) {
    const message = [
      "Invalid server configuration:",
      ...issues.map((issue) => `- ${issue.path}: ${issue.message}`)
    ].join("\n");

    super(message);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }

  public toJSON(): {
    name: string;
    message: string;
    issues: readonly ConfigIssue[];
  } {
    return {
      name: this.name,
      message: this.message,
      issues: this.issues
    };
  }
}


import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const directory = resolve("apps/server/test/fixtures/facebook");
const files = readdirSync(directory).filter((name) => name.endsWith(".html"));
const failures = [];
const forbidden = [
  [/<script\b/iu, "scripts"],
  [/<form\b/iu, "forms"],
  [/\b(?:cookie|access_token|session_key|fb_dtsg)\b/iu, "session data"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu, "email address"],
  [/(?:tel:|mailto:|\/profile\.php|\/people\/)/iu, "contact or profile link"],
  [/(?:\+351\s*)?(?:2\d{8}|9\d{8})\b/u, "Portuguese phone number"],
  [/reviewed:\s*pending/iu, "pending manual review"],
  [/REVIEW REQUIRED/u, "unreviewed inferred field"]
];

for (const file of files) {
  const html = readFileSync(join(directory, file), "utf8");
  if (!/dealfinder-fixture: facebook-results; contract: \d+; captured: [\w-]+; reviewed: \d{4}-\d{2}-\d{2}/u.test(html)) {
    failures.push(`${file}: missing fixture provenance and completed review date`);
  }
  for (const [pattern, label] of forbidden) {
    if (pattern.test(html)) failures.push(`${file}: contains prohibited ${label}`);
  }
  for (const match of html.matchAll(/(?:href|src)="(https?:[^"#]+)"/gu)) {
    const value = match[1];
    if (
      !/^https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?(?:\?[^"#]*)?$/u.test(value) &&
      !/^https:\/\/example\.invalid\/vehicle-thumbnail-\d+\.jpg$/u.test(value)
    ) failures.push(`${file}: contains an unapproved external URL: ${value}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Checked ${files.length} sanitized Facebook fixture(s).\n`);

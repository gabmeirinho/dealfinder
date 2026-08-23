import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import {
  FacebookFailureCoordinator,
  type FacebookFailureNotice
} from "../../sources/facebook/failures/index.js";
import { DiagnosticsService } from "./service.js";

describe("privacy-safe Facebook diagnostics", () => {
  let database: DatabaseConnection | undefined;
  let directory: string | undefined;

  afterEach(() => {
    database?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  it("stores local artifacts, redacts DOM content, and sends text-only notices", async () => {
    directory = mkdtempSync(join(tmpdir(), "dealfinder-diagnostics-"));
    database = openDatabase({ filename: ":memory:" });
    const searchId = createSearch(database);
    let now = new Date("2026-08-23T09:00:00.000Z");
    const diagnostics = new DiagnosticsService({
      directory,
      database: () => database as DatabaseConnection,
      now: () => now
    });
    const browser = new FakeFailureBrowser();
    const notices: FacebookFailureNotice[] = [];
    const coordinator = new FacebookFailureCoordinator({
      database: () => database as DatabaseConnection,
      diagnostics,
      browser: () => browser,
      notifier: { notify: (notice) => { notices.push(notice); } },
      now: () => now
    });
    const rawHtml = `<!doctype html><html><body>
      <script>document.cookie = "secret-cookie"</script>
      <a href="https://www.facebook.com/profile.php?id=42">Seller Name</a>
      <p>owner@example.com +351 912345678 private message</p>
      <div role="main" data-testid="checkpoint">Log in to Facebook</div>
    </body></html>`;

    const pause = await coordinator.pause(searchId, {
      kind: "login_required",
      scope: "browser",
      detail: "Facebook requires a manual login"
    }, {
      cards: [],
      atEnd: false,
      page: {
        url: "https://www.facebook.com/login/?next=private",
        title: "Facebook",
        bodyText: "Log in to Facebook",
        html: rawHtml,
        loading: false
      }
    });

    const metadata = database.facebookHealth.getDiagnostic(pause.diagnosticId ?? "");
    expect(metadata).toMatchObject({
      failureKind: "login_required",
      searchId,
      createdAt: "2026-08-23T09:00:00.000Z",
      expiresAt: "2026-08-30T09:00:00.000Z"
    });
    expect(metadata?.screenshotPath).not.toBeNull();
    expect(metadata?.domPath).not.toBeNull();
    expect(readFileSync(metadata?.screenshotPath ?? "")).toEqual(Buffer.from([137, 80, 78, 71]));
    const sanitized = readFileSync(metadata?.domPath ?? "", "utf8");
    expect(sanitized).toContain("data-testid=\"checkpoint\"");
    expect(sanitized).toContain("data-page-path=\"/login/\"");
    expect(sanitized).not.toMatch(/Seller Name|owner@example|912345678|private message|secret-cookie|profile\.php/u);
    expect(browser.pauses).toEqual([{
      reason: "login_required",
      detail: "Facebook requires a manual login"
    }]);
    expect(notices).toEqual([{
      kind: "login_required",
      scope: "browser",
      searchId,
      detail: "Facebook requires a manual login"
    }]);
    expect(JSON.stringify(notices)).not.toMatch(/screenshot|\.png|diagnostic/i);

    const screenshotPath = metadata?.screenshotPath ?? "";
    const domPath = metadata?.domPath ?? "";
    now = new Date("2026-08-31T09:00:00.000Z");
    expect(await diagnostics.cleanupExpired()).toBe(1);
    expect(existsSync(screenshotPath)).toBe(false);
    expect(existsSync(domPath)).toBe(false);
    expect(database.facebookHealth.getDiagnostic(metadata?.id ?? "")).toBeUndefined();
    expect(database.facebookHealth.getPause(pause.id)?.diagnosticId).toBeNull();
  });
});

class FakeFailureBrowser {
  public readonly pauses: Array<{ reason: string; detail: string | null | undefined }> = [];

  public async captureDiagnosticScreenshot(): Promise<Uint8Array> {
    return new Uint8Array([137, 80, 78, 71]);
  }

  public async pauseForAttention(reason: "login_required", detail?: string | null): Promise<void> {
    this.pauses.push({ reason, detail });
  }
}

function createSearch(database: DatabaseConnection): string {
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  return database.searches.create(draft).id;
}

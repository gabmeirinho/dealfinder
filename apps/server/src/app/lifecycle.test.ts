import { describe, expect, it } from "vitest";

import { LifecycleRuntime, type RuntimeService } from "./lifecycle.js";

describe("runtime lifecycle", () => {
  it("starts in order and stops in reverse order once", async () => {
    const events: string[] = [];
    const service = (name: string): RuntimeService => ({
      name,
      start: () => { events.push(`start:${name}`); },
      stop: () => { events.push(`stop:${name}`); }
    });
    const runtime = new LifecycleRuntime([service("database"), service("http")]);

    await runtime.start();
    await runtime.stop();
    await runtime.stop();

    expect(events).toEqual([
      "start:database",
      "start:http",
      "stop:http",
      "stop:database"
    ]);
  });

  it("cleans up started services after startup failure", async () => {
    const events: string[] = [];
    const runtime = new LifecycleRuntime([
      {
        name: "database",
        start: () => { events.push("start:database"); },
        stop: () => { events.push("stop:database"); }
      },
      {
        name: "http",
        start: () => {
          throw new Error("address unavailable");
        },
        stop: () => { events.push("stop:http"); }
      }
    ]);

    await expect(runtime.start()).rejects.toThrow("address unavailable");
    expect(events).toEqual(["start:database", "stop:database"]);
  });
});

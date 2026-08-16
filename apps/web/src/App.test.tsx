import { describe, expect, it } from "vitest";
import { App, appName } from "./App.js";

describe("web workspace", () => {
  it("has a compileable React entry point", () => {
    expect(appName).toBe("Dealfinder");
    expect(App()).toBeTruthy();
  });
});


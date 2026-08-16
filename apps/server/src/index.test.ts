import { describe, expect, it } from "vitest";
import { workspaceName } from "./index.js";

describe("server workspace", () => {
  it("has a compileable entry point", () => {
    expect(workspaceName).toBe("@dealfinder/server");
  });
});


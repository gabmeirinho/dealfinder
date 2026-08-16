import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("domain package", () => {
  it("has a compileable entry point", () => {
    expect(packageName).toBe("@dealfinder/domain");
  });
});


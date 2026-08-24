import { describe, expectTypeOf, it } from "vitest";
import type { LogLevel, ServerConfig } from "./config.js";

describe("server configuration contract", () => {
  it("defines the validated runtime configuration shape", () => {
    expectTypeOf<ServerConfig["server"]["host"]>().toBeString();
    expectTypeOf<ServerConfig["server"]["port"]>().toBeNumber();
    expectTypeOf<ServerConfig["paths"]["sqlitePath"]>().toBeString();
    expectTypeOf<ServerConfig["telegram"]["botToken"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<ServerConfig["deepseek"]["apiKey"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<LogLevel>().toEqualTypeOf<
      "debug" | "info" | "warn" | "error"
    >();
  });
});


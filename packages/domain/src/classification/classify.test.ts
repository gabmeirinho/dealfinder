import { describe, expect, it } from "vitest";

import { classifyListing } from "./classify.js";

describe("listing classification", () => {
  it.each([
    ["Hot Wheels Porsche 1/43", "collectible", "collectible"],
    ["Hot Wheel Volkswagen Golf MK2", "collectible", "collectible"],
    ["Jantes BMW série 3", "part_or_accessory", "part"],
    ["Faróis Audi A3", "part_or_accessory", "body_or_light"],
    ["Aileron/Spoiler Volkswagen Golf", "part_or_accessory", "body_or_light"],
    ["Módulo de sofagem Golf", "part_or_accessory", "mechanical_or_electrical"],
    ["Catálogo Renault Clio", "printed_material", "printed_material"]
  ] as const)("excludes %s", (title, subject, category) => {
    expect(classifyListing({ title })).toMatchObject({
      subject,
      condition: "unknown",
      decision: "exclude",
      matchedPatterns: expect.arrayContaining([expect.objectContaining({ category })])
    });
  });

  it("keeps a parts-only vehicle distinct from an accessory", () => {
    expect(classifyListing({ title: "Volkswagen Golf só para peças" })).toEqual({
      version: 1,
      subject: "whole_vehicle",
      condition: "parts_only",
      decision: "exclude",
      matchedPatterns: [{ category: "parts_only", pattern: "só para peças" }]
    });
  });

  it("matches accents, punctuation variants, and whole terms", () => {
    expect(classifyListing({ title: "CAPO / PARA CHOQUE Peugeot" }).matchedPatterns).toEqual([
      { category: "body_or_light", pattern: "capô" },
      { category: "body_or_light", pattern: "para-choque" }
    ]);
    expect(classifyListing({ title: "Motorizada Yamaha" }).decision).toBe("continue");
  });

  it("continues ordinary vehicle titles", () => {
    expect(classifyListing({ title: "Volkswagen Golf 1.6 TDI 2018" })).toEqual({
      version: 1,
      subject: "unknown",
      condition: "unknown",
      decision: "continue",
      matchedPatterns: []
    });
  });
});

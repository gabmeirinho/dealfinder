import { describe, expect, it } from "vitest";

import { classifyListing } from "./classify.js";

describe("listing classification", () => {
  it.each([
    {
      title: "Hotwheels Volkswagen Golf MK2",
      subject: "collectible",
      patterns: [{ category: "collectible", pattern: "hotwheels" }]
    },
    {
      title: "Hot Wheel Volkswagen Golf MK2",
      subject: "collectible",
      patterns: [{ category: "collectible", pattern: "hot wheel" }]
    },
    {
      title: "Hot Wheels Porsche 1/43",
      subject: "collectible",
      patterns: [
        { category: "collectible", pattern: "hot wheels" },
        { category: "collectible", pattern: "1/43" }
      ]
    },
    {
      title: "Miniatura Volkswagen Golf 3 - 1/18",
      subject: "collectible",
      patterns: [
        { category: "collectible", pattern: "miniatura" },
        { category: "collectible", pattern: "1/18" }
      ]
    },
    {
      title: "Volante Volkswagen Golf",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "volante" }]
    },
    {
      title: "Volantes volkswagen",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "volantes" }]
    },
    {
      title: "Bancos Volkswagen Golf 4",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "bancos" }]
    },
    {
      title: "Calha da água Golf V",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "calha da água" }]
    },
    {
      title: "Jante suplente Volkswagen Golf",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "jante" }]
    },
    {
      title: "Pneu Volkswagen Golf",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "pneu" }]
    },
    {
      title: "Macaco e chave de rodas Volkswagen Golf",
      subject: "part_or_accessory",
      patterns: [
        { category: "part", pattern: "chave de rodas" },
        { category: "part", pattern: "macaco" }
      ]
    },
    {
      title: "Alargadores Volkswagen Golf",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "alargadores" }]
    },
    {
      title: "Teto de abrir Volkswagen Golf",
      subject: "part_or_accessory",
      patterns: [{ category: "body_or_light", pattern: "teto de abrir" }]
    },
    {
      title: "Apoio Palas Volkswagen Golf 3",
      subject: "part_or_accessory",
      patterns: [{ category: "part", pattern: "palas" }]
    },
    {
      title: "Módulos de Bateria – Volkswagen Golf GTE 2019",
      subject: "part_or_accessory",
      patterns: [
        { category: "mechanical_or_electrical", pattern: "bateria" },
        { category: "mechanical_or_electrical", pattern: "módulos" }
      ]
    },
    {
      title: "Módulo de sofagem Golf",
      subject: "part_or_accessory",
      patterns: [
        { category: "mechanical_or_electrical", pattern: "módulo" },
        { category: "mechanical_or_electrical", pattern: "sofagem" }
      ]
    },
    {
      title: "Barra estabilizadora para Volkswagen Golf VI",
      subject: "part_or_accessory",
      patterns: [{ category: "mechanical_or_electrical", pattern: "barra estabilizadora" }]
    },
    {
      title: "Aileron/Spoiler Volkswagen Golf",
      subject: "part_or_accessory",
      patterns: [
        { category: "body_or_light", pattern: "aileron" },
        { category: "body_or_light", pattern: "spoiler" }
      ]
    },
    {
      title: "Catálogo Renault Clio",
      subject: "printed_material",
      patterns: [{ category: "printed_material", pattern: "catálogo" }]
    },
    {
      title: "- APRESENTAÇÃO: VOLKSWAGEN GOLF - SCIROCCO - JETTA",
      subject: "printed_material",
      patterns: [{ category: "printed_material", pattern: "apresentação" }]
    }
  ] as const)("excludes observed non-vehicle title: $title", ({ title, subject, patterns }) => {
    const classification = classifyListing({ title });
    expect(classification).toMatchObject({
      subject,
      condition: "unknown",
      decision: "exclude"
    });
    expect(classification.matchedPatterns).toEqual(patterns);
  });

  it("keeps a parts-only vehicle distinct from an accessory", () => {
    expect(classifyListing({ title: "Volkswagen Golf só para peças" })).toEqual({
      version: 2,
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

  it.each([
    "Volkswagen Golf 1.6 TDI 2018",
    "Vendo Volkswagen Golf carrinha",
    "2009 Volkswagen golf vi 2.0tdi 110cv",
    "2021 Volkswagen golf r mk8 pack performance com garantia",
    "Volkswagen Golf VII GTE 204cv Plug-in Hybrid | Full LED | Histórico Completo",
    "Oeiras",
    "Lisboa"
  ])("continues ordinary or unmatched title: %s", (title) => {
    expect(classifyListing({ title })).toEqual({
      version: 2,
      subject: "unknown",
      condition: "unknown",
      decision: "continue",
      matchedPatterns: []
    });
  });
});

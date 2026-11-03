import { describe, expect, it } from "vitest";
import { parseAmount, parsePrice } from "../src/core/price";

describe("parsePrice", () => {
  it("parses symbol-before-number prices", () => {
    expect(parsePrice("₪800")).toEqual({ amount: 800, currency: "ILS", free: false, previous: null });
    expect(parsePrice("$1,200")).toEqual({ amount: 1200, currency: "USD", free: false, previous: null });
    expect(parsePrice("€50")).toEqual({ amount: 50, currency: "EUR", free: false, previous: null });
    expect(parsePrice("£20")).toEqual({ amount: 20, currency: "GBP", free: false, previous: null });
    expect(parsePrice("¥1000")).toEqual({ amount: 1000, currency: "JPY", free: false, previous: null });
    expect(parsePrice("zł100")).toEqual({ amount: 100, currency: "PLN", free: false, previous: null });
  });

  it("parses symbol-after-number prices", () => {
    expect(parsePrice("800 ₪")).toEqual({ amount: 800, currency: "ILS", free: false, previous: null });
    expect(parsePrice("1.200,50 €")).toEqual({ amount: 1200.5, currency: "EUR", free: false, previous: null });
  });

  it("parses standalone word currency tokens", () => {
    expect(parsePrice("ILS 800")).toEqual({ amount: 800, currency: "ILS", free: false, previous: null });
    expect(parsePrice("NIS 800")).toEqual({ amount: 800, currency: "ILS", free: false, previous: null });
    expect(parsePrice("800 USD")).toEqual({ amount: 800, currency: "USD", free: false, previous: null });
    expect(parsePrice("US$ 800")).toEqual({ amount: 800, currency: "USD", free: false, previous: null });
    expect(parsePrice("CHF 5")).toEqual({ amount: 5, currency: "CHF", free: false, previous: null });
    expect(parsePrice("PLN 100")).toEqual({ amount: 100, currency: "PLN", free: false, previous: null });
    expect(parsePrice("AED 100")).toEqual({ amount: 100, currency: "AED", free: false, previous: null });
    expect(parsePrice("SAR 100")).toEqual({ amount: 100, currency: "SAR", free: false, previous: null });
    expect(parsePrice("100 kr")).toEqual({ amount: 100, currency: "kr", free: false, previous: null });
  });

  it("detects R$ as BRL before $", () => {
    expect(parsePrice("R$ 1.500")).toEqual({ amount: 1500, currency: "BRL", free: false, previous: null });
  });

  it("parses two back-to-back prices", () => {
    expect(parsePrice("₪800₪1,000")).toEqual({ amount: 800, currency: "ILS", free: false, previous: 1000 });
    expect(parsePrice("$1,200 $1,500")).toEqual({ amount: 1200, currency: "USD", free: false, previous: 1500 });
  });

  it("parses free listings", () => {
    expect(parsePrice("Free")).toEqual({ amount: 0, currency: "", free: true, previous: null });
    expect(parsePrice("חינם")).toEqual({ amount: 0, currency: "", free: true, previous: null });
    expect(parsePrice("GRATIS")).toEqual({ amount: 0, currency: "", free: true, previous: null });
  });

  it("returns null for non-prices", () => {
    for (const s of [
      "Kraków",
      "Saratoga",
      "Ninja NIS-style blender",
      "iPhone 13 128GB",
      "2",
      "Tel Aviv",
      "",
      "   ",
    ]) {
      expect(parsePrice(s)).toBeNull();
    }
  });
});

describe("parseAmount", () => {
  const cases: Array<[string, number]> = [
    ["1,200", 1200],
    ["1.200", 1200],
    ["1 200", 1200],
    ["1 200", 1200],
    ["1 200", 1200],
    ["1,200.50", 1200.5],
    ["1.200,50", 1200.5],
    ["12.5", 12.5],
    ["12,5", 12.5],
    ["800", 800],
  ];

  it.each(cases)("parseAmount(%j) -> %i", (s, expected) => {
    expect(parseAmount(s)).toBe(expected);
  });

  it("returns null for non-numbers", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("$5")).toBeNull();
  });
});

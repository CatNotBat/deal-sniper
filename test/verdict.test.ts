import { describe, expect, it } from "vitest";
import { compareDeals, computeVerdict, midpoint } from "../src/core/verdict";
import type { DealResult } from "../src/core/types";

function baseResult(overrides: Partial<DealResult> = {}): DealResult {
  return {
    listing: {
      id: "1",
      title: "x",
      price: 100,
      previousPrice: null,
      currency: "USD",
      priceText: "$100",
      location: "",
      url: "https://www.facebook.com/marketplace/item/1/",
      imageUrl: "",
      condition: "",
      listedAge: "",
    },
    skipped: false,
    skipReason: "",
    product: "",
    category: "other",
    marketLow: 100,
    marketHigh: 200,
    confidence: "high",
    reasoning: "",
    ratio: null,
    savings: null,
    verdict: "unknown",
    verification: null,
    ...overrides,
  };
}

describe("midpoint", () => {
  it("computes the midpoint", () => {
    expect(midpoint(100, 200)).toBe(150);
  });

  it("returns null for invalid ranges", () => {
    expect(midpoint(null, 200)).toBeNull();
    expect(midpoint(100, null)).toBeNull();
    expect(midpoint(200, 100)).toBeNull();
    expect(midpoint(0, 0)).toBeNull();
  });
});

describe("computeVerdict", () => {
  it("maps ratio to verdicts at the boundaries", () => {
    expect(computeVerdict(60, 100, 100, "high").verdict).toBe("steal");
    expect(computeVerdict(75, 100, 100, "high").verdict).toBe("great");
    expect(computeVerdict(85, 100, 100, "high").verdict).toBe("good");
    expect(computeVerdict(110, 100, 100, "high").verdict).toBe("fair");
    expect(computeVerdict(111, 100, 100, "high").verdict).toBe("overpriced");
  });

  it("treats a free item with mid > 0 as a steal with ratio 0", () => {
    expect(computeVerdict(0, 100, 200, "high")).toEqual({ ratio: 0, savings: 150, verdict: "steal" });
  });

  it("caps low-confidence verdicts at good", () => {
    expect(computeVerdict(50, 100, 100, "low").verdict).toBe("good");
    expect(computeVerdict(70, 100, 100, "low").verdict).toBe("good");
    expect(computeVerdict(120, 100, 100, "low").verdict).toBe("overpriced");
  });

  it("returns unknown for null price or null midpoint", () => {
    expect(computeVerdict(null, 100, 100, "high")).toEqual({ ratio: null, savings: null, verdict: "unknown" });
    expect(computeVerdict(100, null, null, "high").verdict).toBe("unknown");
  });
});

describe("compareDeals sorting", () => {
  it("sorts steal first (regression for the old `|| 3` bug)", () => {
    const steal = baseResult({ verdict: "steal", ratio: 0.5, savings: 100 });
    const overpriced = baseResult({ verdict: "overpriced", ratio: 1.5, savings: -50 });
    const sorted = [overpriced, steal].sort(compareDeals);
    expect(sorted[0]!.verdict).toBe("steal");
  });

  it("sorts by ratio ascending within the same verdict", () => {
    const a = baseResult({ verdict: "great", ratio: 0.7 });
    const b = baseResult({ verdict: "great", ratio: 0.65 });
    const sorted = [a, b].sort(compareDeals);
    expect(sorted[0]!.ratio).toBe(0.65);
  });
});

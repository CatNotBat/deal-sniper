import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DealResult } from "../src/core/types";
import { compareDeals, computeVerdict } from "../src/core/verdict";

const data = JSON.parse(
  readFileSync(new URL("../site/demo.json", import.meta.url), "utf8"),
) as { results: DealResult[]; costUsd: number };

describe("demo data", () => {
  it("contains the expected number of results", () => {
    expect(data.results).toHaveLength(18);
  });

  it("has a plausible cost", () => {
    expect(data.costUsd).toBeGreaterThan(0);
    expect(data.costUsd).toBeLessThan(0.5);
  });

  it("gives each result the verdict computeVerdict would", () => {
    for (const r of data.results) {
      const { verdict } = computeVerdict(r.listing.price, r.marketLow, r.marketHigh, r.confidence);
      expect(r.verdict, `id=${r.listing.id}`).toBe(verdict);
    }
  });

  it("is ordered by compareDeals", () => {
    const sorted = [...data.results].sort(compareDeals);
    expect(data.results.map((r) => r.listing.id)).toEqual(sorted.map((r) => r.listing.id));
  });

  it("has no real listing urls and no images", () => {
    for (const r of data.results) {
      expect(r.listing.url).toBe("https://www.facebook.com/marketplace/");
      expect(r.listing.imageUrl).toBe("");
    }
  });
});

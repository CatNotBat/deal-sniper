import { describe, expect, it } from "vitest";
import { canonicalItemUrl, extractItemId, looksLikeNonElectronics, parseCardLines } from "../src/core/card";

describe("extractItemId", () => {
  it("matches absolute and relative marketplace/item paths", () => {
    expect(extractItemId("https://www.facebook.com/marketplace/item/1234567890/")).toBe("1234567890");
    expect(extractItemId("/marketplace/item/42/")).toBe("42");
  });

  it("matches item_id", () => {
    expect(extractItemId("https://www.facebook.com/marketplace/item/?item_id=999")).toBe("999");
  });

  it("is case-insensitive", () => {
    expect(extractItemId("HTTPS://WWW.FACEBOOK.COM/MARKETPLACE/ITEM/77/")).toBe("77");
  });

  it("returns null when there is no id", () => {
    expect(extractItemId("https://example.com/")).toBeNull();
  });
});

describe("canonicalItemUrl", () => {
  it("builds the canonical url", () => {
    expect(canonicalItemUrl("123")).toBe("https://www.facebook.com/marketplace/item/123/");
  });
});

describe("parseCardLines", () => {
  it("parses a typical English card", () => {
    const r = parseCardLines(["$500", "iPhone 12 64GB", "Tucson, AZ", "Used", "2 hours ago"]);
    expect(r).toMatchObject({
      title: "iPhone 12 64GB",
      price: 500,
      currency: "USD",
      priceText: "$500",
      location: "Tucson, AZ",
      condition: "Used",
      listedAge: "2 hours ago",
    });
  });

  it("parses a Hebrew card", () => {
    const r = parseCardLines(["₪1,800", "iPhone 13 128GB", "תל אביב", "כמו חדש", "לפני שעה"]);
    expect(r).toMatchObject({
      title: "iPhone 13 128GB",
      price: 1800,
      currency: "ILS",
      location: "תל אביב",
      condition: "כמו חדש",
    });
  });

  it("captures a struck price on its own line", () => {
    const r = parseCardLines(["$800", "$1,000", "MacBook Air M1", "Boston, MA"]);
    expect(r).toMatchObject({
      title: "MacBook Air M1",
      price: 800,
      previousPrice: 1000,
      currency: "USD",
      location: "Boston, MA",
    });
  });

  it("handles the location-as-title case", () => {
    const r = parseCardLines(["$500", "צפת, Z", "iPhone 12 64GB"]);
    expect(r).toMatchObject({ title: "iPhone 12 64GB", location: "צפת, Z", price: 500 });
  });

  it("handles a card with no price line", () => {
    const r = parseCardLines(["iPhone 13", "Tel Aviv"]);
    expect(r).toMatchObject({ title: "iPhone 13", location: "Tel Aviv", price: null, priceText: "" });
  });

  it("returns null for empty input", () => {
    expect(parseCardLines([])).toBeNull();
    expect(parseCardLines(["   ", ""])).toBeNull();
  });
});

describe("looksLikeNonElectronics", () => {
  it("flags furniture, vehicles, and Hebrew non-electronics", () => {
    expect(looksLikeNonElectronics("IKEA sofa")).toBe(true);
    expect(looksLikeNonElectronics("used car")).toBe(true);
    expect(looksLikeNonElectronics("ספה מקטיפה")).toBe(true);
    expect(looksLikeNonElectronics("דירה 3 חדרים")).toBe(true);
  });

  it("does not flag electronics", () => {
    expect(looksLikeNonElectronics("iPhone case")).toBe(false);
    expect(looksLikeNonElectronics("MacBook Pro 14")).toBe(false);
    expect(looksLikeNonElectronics("Plantronics headset")).toBe(false);
  });
});

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DealResult, Listing } from "../src/core/types";
import { FILTERS, formatMoney, renderDeal, renderFilters, renderSkipped } from "../src/app/render";

const html = readFileSync(join(process.cwd(), "site", "app.html"), "utf8");
document.open();
document.write(html);
document.close();
const doc = document;
const tpl = doc.getElementById("tpl-deal") as HTMLTemplateElement;

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "1",
    title: "Test item",
    price: 100,
    previousPrice: null,
    currency: "USD",
    priceText: "$100",
    location: "",
    url: "https://www.facebook.com/marketplace/item/1/",
    imageUrl: "",
    condition: "",
    listedAge: "",
    ...overrides,
  };
}

function result(overrides: Partial<DealResult> = {}): DealResult {
  return {
    listing: listing(),
    skipped: false,
    skipReason: "",
    product: "Test Product",
    category: "other",
    marketLow: 80,
    marketHigh: 120,
    confidence: "high",
    reasoning: "because",
    ratio: 0.8,
    savings: 20,
    verdict: "good",
    verification: null,
    ...overrides,
  };
}

describe("formatMoney", () => {
  it("handles null, free, ISO currency and raw tokens", () => {
    expect(formatMoney(null, "ILS")).toBe("—");
    expect(formatMoney(0, "ILS")).toBe("Free");
    expect(formatMoney(1234, "ILS")).toBe("₪1,234");
    expect(formatMoney(500, "kr")).toBe("500 kr");
  });
});

describe("renderDeal", () => {
  it("renders a malicious title as literal text, never as markup", () => {
    const li = renderDeal(
      doc,
      tpl,
      result({ listing: listing({ title: "<img src=x onerror=alert(1)>" }) }),
    );
    expect(li.querySelector(".deal-title a")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(li.querySelector("img[onerror]")).toBeNull();
    expect(li.querySelector("script")).toBeNull();
  });

  it("refuses javascript: listing and image urls", () => {
    const li = renderDeal(
      doc,
      tpl,
      result({ listing: listing({ url: "javascript:alert(1)", imageUrl: "javascript:alert(1)" }) }),
    );
    expect(li.querySelector(".deal-media")!.getAttribute("href")).toBeNull();
    expect(li.querySelector(".deal-title a")!.getAttribute("href")).toBeNull();
    expect(li.querySelector(".deal-media img")).toBeNull();
    expect(li.querySelector(".deal-media .glyph")).not.toBeNull();
  });

  it("drops javascript: source links but keeps http(s) ones", () => {
    const li = renderDeal(
      doc,
      tpl,
      result({
        verification: {
          status: "ok",
          summary: "s",
          redFlags: [],
          sources: [
            { url: "https://www.ebay.com/", title: "eBay" },
            { url: "javascript:alert(1)", title: "bad" },
          ],
        },
      }),
    );
    const sources = li.querySelectorAll(".sources a");
    expect(sources).toHaveLength(1);
    expect(sources[0]!.textContent).toBe("ebay.com");
  });

  it("sets and clamps the range custom properties", () => {
    const li = renderDeal(doc, tpl, result({ marketLow: 100, marketHigh: 1000, listing: listing({ price: 200 }) }));
    const range = li.querySelector<HTMLElement>(".range")!;
    expect(range.hidden).toBe(false);
    const lo = parseFloat(range.style.getPropertyValue("--lo"));
    const hi = parseFloat(range.style.getPropertyValue("--hi"));
    const at = parseFloat(range.style.getPropertyValue("--at"));
    for (const v of [lo, hi, at]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(lo).toBeLessThanOrEqual(hi);
  });

  it("hides the range when there is no market range", () => {
    const li = renderDeal(doc, tpl, result({ marketLow: null }));
    expect(li.querySelector<HTMLElement>(".range")!.hidden).toBe(true);
  });

  it("shows a spinner in the pending state", () => {
    const li = renderDeal(doc, tpl, result({}), "pending");
    const verify = li.querySelector<HTMLElement>(".verify")!;
    expect(verify.hidden).toBe(false);
    expect(verify.classList.contains("pending")).toBe(true);
    expect(li.querySelector(".verify .spinner")).not.toBeNull();
  });

  it("renders a verification error as Couldn't verify", () => {
    const li = renderDeal(doc, tpl, result({ verification: { status: "error", message: "boom" } }));
    expect(li.querySelector(".verify-head")!.textContent).toBe("Couldn't verify");
    expect(li.querySelector(".verify-summary")!.textContent).toBe("boom");
    expect(li.querySelector(".verify")!.classList.contains("failed")).toBe(true);
  });

  it("renders a successful verification with flags and sources", () => {
    const li = renderDeal(
      doc,
      tpl,
      result({
        verification: {
          status: "ok",
          summary: "summary here",
          redFlags: ["flag one"],
          sources: [{ url: "https://www.ebay.com/", title: "eBay" }],
        },
      }),
    );
    expect(li.querySelector(".verify-head")!.textContent).toBe("✓ Verified with web search");
    expect(li.querySelector(".verify-summary")!.textContent).toBe("summary here");
    expect(li.querySelectorAll(".flags li")).toHaveLength(1);
    expect(li.querySelectorAll(".sources a")).toHaveLength(1);
  });
});

describe("renderSkipped", () => {
  it("lists title and reason", () => {
    const ul = doc.createElement("ul");
    renderSkipped(doc, ul, [
      result({ skipped: true, skipReason: "accessory", listing: listing({ title: "case" }) }),
    ]);
    expect(ul.querySelector("li")!.textContent).toBe("case — accessory");
  });
});

describe("renderFilters", () => {
  it("builds five chips with counts and an active state", () => {
    const container = doc.createElement("div");
    let picked = "";
    renderFilters(
      doc,
      container,
      [result({ verdict: "steal" }), result({ verdict: "overpriced" })],
      "deals",
      (k) => {
        picked = k;
      },
    );
    expect(container.querySelectorAll("button.chip")).toHaveLength(FILTERS.length);
    const active = container.querySelector('button.chip[aria-pressed="true"]');
    expect(active!.textContent).toContain("Deals");
    (container.querySelectorAll("button.chip")[1] as HTMLButtonElement).click();
    expect(picked).toBe("steal");
  });
});

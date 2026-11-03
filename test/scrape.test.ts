// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cardRootFor, findItemAnchors, scrapeDocument, textLines } from "../src/bookmarklet/scrape";

function fixtureDocument(): Document {
  document.body.innerHTML = `
    <div class="grid">
      <div class="card">
        <div class="inner">
          <a href="https://www.facebook.com/marketplace/item/111/">
            <div class="media"><img src="https://scontent.example/111.jpg"></div>
            <span class="price">$500</span>
            <span class="was">$650</span>
            <span class="title">iPhone 12 64GB</span>
            <span class="loc">Tucson, AZ</span>
          </a>
          <a href="https://www.facebook.com/marketplace/item/111/">dupe</a>
        </div>
      </div>
      <div class="card">
        <a href="https://www.facebook.com/marketplace/item/222/">
          <img src="http://insecure.example.com/222.jpg">
          <span class="price">₪1,800</span>
          <span class="title">אייפון 13 128GB</span>
          <span class="loc">תל אביב</span>
        </a>
      </div>
      <div class="card">
        <a href="https://www.facebook.com/marketplace/item/333/">
          <img src="https://cdn.example.net/333.jpg">
          <span class="title">MacBook Air M1</span>
          <span class="loc">Haifa</span>
        </a>
      </div>
      <div class="card">
        <a href="https://www.facebook.com/marketplace/item/444/">
          <span class="price">€900</span>
          <span class="title">Sony WH-1000XM5</span>
          <span class="loc">Berlin</span>
        </a>
      </div>
      <a href="https://www.facebook.com/groups/123/about/">non-item link</a>
    </div>
  `;
  return document;
}

describe("findItemAnchors", () => {
  it("finds item anchors deduped by id (first wins)", () => {
    fixtureDocument();
    const anchors = findItemAnchors(document);
    const ids = anchors.map((a) => a.getAttribute("href"));
    expect(ids).toHaveLength(4);
    expect(ids[0]).toContain("/marketplace/item/111/");
    expect(ids[1]).toContain("/marketplace/item/222/");
    expect(ids[2]).toContain("/marketplace/item/333/");
    expect(ids[3]).toContain("/marketplace/item/444/");
  });
});

describe("textLines", () => {
  it("walks text nodes when innerText is unavailable (jsdom)", () => {
    fixtureDocument();
    const card = document.querySelector(".card .inner")!;
    expect(textLines(card)).toContain("iPhone 12 64GB");
  });
});

describe("cardRootFor", () => {
  it("does not climb into a container holding neighbouring cards", () => {
    fixtureDocument();
    const a = document.querySelector<HTMLAnchorElement>('a[href*="/marketplace/item/111/"]')!;
    const root = cardRootFor(a);
    expect(root.classList.contains("card")).toBe(true);
    expect(textLines(root).join("\n")).not.toContain("MacBook Air M1");
    expect(textLines(root).join("\n")).not.toContain("אייפון 13");
  });
});

describe("scrapeDocument", () => {
  it("parses four cards with correct fields and no neighbour leakage", () => {
    fixtureDocument();
    const listings = scrapeDocument(document);
    expect(listings).toHaveLength(4);

    const byId = new Map(listings.map((l) => [l.id, l]));
    const first = byId.get("111")!;
    expect(first.title).toBe("iPhone 12 64GB");
    expect(first.price).toBe(500);
    expect(first.previousPrice).toBe(650);
    expect(first.currency).toBe("USD");
    expect(first.location).toBe("Tucson, AZ");
    expect(first.url).toBe("https://www.facebook.com/marketplace/item/111/");
    expect(first.imageUrl).toBe("https://scontent.example/111.jpg");

    const hebrew = byId.get("222")!;
    expect(hebrew.title).toBe("אייפון 13 128GB");
    expect(hebrew.price).toBe(1800);
    expect(hebrew.currency).toBe("ILS");
    expect(hebrew.location).toBe("תל אביב");
    expect(hebrew.imageUrl).toBe(""); // http image is rejected

    const noPrice = byId.get("333")!;
    expect(noPrice.title).toBe("MacBook Air M1");
    expect(noPrice.price).toBeNull();
    expect(noPrice.imageUrl).toBe("https://cdn.example.net/333.jpg");

    const euro = byId.get("444")!;
    expect(euro.price).toBe(900);
    expect(euro.currency).toBe("EUR");
    expect(euro.imageUrl).toBe("");
  });

  it("keeps neighbouring card text out of every field", () => {
    fixtureDocument();
    const listings = scrapeDocument(document);
    const first = listings.find((l) => l.id === "111")!;
    for (const value of Object.values(first)) {
      if (typeof value === "string") {
        expect(value).not.toContain("MacBook Air");
        expect(value).not.toContain("אייפון 13");
        expect(value).not.toContain("Sony");
      }
    }
  });
});

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Category, Confidence, DealResult, Listing, Source } from "../src/core/types";
import { compareDeals, computeVerdict } from "../src/core/verdict";

const ZAP: Source = { url: "https://www.zap.co.il/", title: "Zap — price comparison" };
const YAD2: Source = { url: "https://www.yad2.co.il/", title: "Yad2 — classifieds" };
const EBAY: Source = { url: "https://www.ebay.com/", title: "eBay — sold listings" };
const SWAPPA: Source = { url: "https://swappa.com/", title: "Swappa — used marketplace" };

interface ItemConfig {
  id: string;
  title: string;
  price: number | null;
  previousPrice?: number | null;
  location: string;
  condition?: string;
  listedAge?: string;
  product: string;
  category: Category;
  marketLow: number | null;
  marketHigh: number | null;
  confidence: Confidence;
  reasoning: string;
  skipReason?: string;
  verification?: DealResult["verification"];
}

const items: ItemConfig[] = [
  {
    id: "demo-01",
    title: "אייפון 14 פרו 256 במצב מעולה",
    price: 2000,
    location: "תל אביב",
    condition: "כמו חדש",
    listedAge: "לפני שעה",
    product: "iPhone 14 Pro 256GB",
    category: "phone",
    marketLow: 3200,
    marketHigh: 3800,
    confidence: "high",
    reasoning: "256 GB iPhone 14 Pro in excellent shape; these trade around ₪3,200–3,800 used.",
    verification: {
      status: "ok",
      summary:
        "Recent sold listings for a 256 GB iPhone 14 Pro in good condition cluster around ₪3,300–3,700, so the asking price looks well under market.",
      redFlags: ["Ask for the iCloud lock to be removed in front of you"],
      sources: [ZAP, YAD2, EBAY],
    },
  },
  {
    id: "demo-02",
    title: "MacBook Air M1 8/256 like new",
    price: 1400,
    previousPrice: 1800,
    location: "Haifa",
    condition: "Like new",
    listedAge: "2 hours ago",
    product: "MacBook Air M1 8/256",
    category: "laptop",
    marketLow: 2200,
    marketHigh: 2600,
    confidence: "high",
    reasoning: "Base M1 Air; used units sell around ₪2,200–2,600.",
    verification: {
      status: "ok",
      summary:
        "Base M1 MacBook Airs in good shape sell for about ₪2,200–2,600 used; this one is listed well below that.",
      redFlags: [],
      sources: [EBAY, SWAPPA],
    },
  },
  {
    id: "demo-03",
    title: "PS5 disc + 2 controllers",
    price: 1450,
    location: "Ramat Gan",
    condition: "Used",
    listedAge: "Yesterday",
    product: "PS5 Disc with 2 controllers",
    category: "console",
    marketLow: 1800,
    marketHigh: 2200,
    confidence: "medium",
    reasoning: "PS5 disc console with two controllers; bundles go for ₪1,800–2,200.",
    verification: {
      status: "ok",
      summary:
        "PS5 disc consoles with two controllers usually sell between ₪1,800 and ₪2,200 in Israel, close to this asking price.",
      redFlags: ["Check that the disc drive reads games before paying"],
      sources: [ZAP, YAD2],
    },
  },
  {
    id: "demo-04",
    title: 'Dell U2720Q 27" 4K monitor',
    price: 1250,
    location: "Jerusalem",
    condition: "Open box",
    listedAge: "Today",
    product: 'Dell U2720Q 27" 4K monitor',
    category: "monitor",
    marketLow: 1500,
    marketHigh: 1900,
    confidence: "medium",
    reasoning: "27-inch 4K USB-C monitor; open-box units list around ₪1,500–1,900.",
    verification: {
      status: "unconfirmed",
      summary: "Searches found store listings but no recent used or open-box prices for this model in Israel, so the range above is the original estimate.",
      redFlags: [],
      sources: [{ url: "https://www.zap.co.il/", title: "Zap" }],
    },
  },
  {
    id: "demo-05",
    title: "RTX 3070 FE",
    price: 1150,
    location: "Be'er Sheva",
    condition: "Used",
    listedAge: "3 days ago",
    product: "RTX 3070 Founders Edition",
    category: "gpu",
    marketLow: 1400,
    marketHigh: 1800,
    confidence: "high",
    reasoning: "3070 FE; used boards move around ₪1,400–1,800.",
  },
  {
    id: "demo-06",
    title: "Sony WH-1000XM5",
    price: 650,
    location: "Tel Aviv",
    condition: "Like new",
    listedAge: "1 day ago",
    product: "Sony WH-1000XM5",
    category: "audio",
    marketLow: 700,
    marketHigh: 900,
    confidence: "high",
    reasoning: "XM5 headphones; like-new pairs sell around ₪700–900.",
  },
  {
    id: "demo-07",
    title: "iPad Air 5 64GB wifi",
    price: 1500,
    location: "Haifa",
    condition: "Used",
    listedAge: "1 week ago",
    product: "iPad Air 5 64GB Wi-Fi",
    category: "tablet",
    marketLow: 1600,
    marketHigh: 2000,
    confidence: "high",
    reasoning: "64 GB iPad Air 5; used units go for ₪1,600–2,000.",
  },
  {
    id: "demo-08",
    title: "Galaxy S23 Ultra 512",
    price: 2600,
    location: "Ramat Gan",
    condition: "Used",
    listedAge: "Yesterday",
    product: "Galaxy S23 Ultra 512GB",
    category: "phone",
    marketLow: 2800,
    marketHigh: 3400,
    confidence: "high",
    reasoning: "512 GB S23 Ultra; used phones list around ₪2,800–3,400.",
  },
  {
    id: "demo-09",
    title: "ThinkPad T14 Gen 3 i7 16GB",
    price: 2300,
    location: "Jerusalem",
    condition: "Refurbished",
    listedAge: "5 days ago",
    product: "ThinkPad T14 Gen 3 i7 16GB",
    category: "laptop",
    marketLow: 2200,
    marketHigh: 2600,
    confidence: "medium",
    reasoning: "T14 Gen 3 with i7 and 16 GB; refurbished units around ₪2,200–2,600.",
  },
  {
    id: "demo-10",
    title: "Nintendo Switch OLED",
    price: 1000,
    previousPrice: 1150,
    location: "Tel Aviv",
    condition: "Used",
    listedAge: "2 days ago",
    product: "Nintendo Switch OLED",
    category: "console",
    marketLow: 900,
    marketHigh: 1100,
    confidence: "high",
    reasoning: "Switch OLED; used consoles sell around ₪900–1,100.",
  },
  {
    id: "demo-11",
    title: "Apple Watch Series 8 45mm",
    price: 1150,
    location: "Be'er Sheva",
    condition: "Like new",
    listedAge: "4 days ago",
    product: "Apple Watch Series 8 45mm",
    category: "watch",
    marketLow: 1000,
    marketHigh: 1300,
    confidence: "medium",
    reasoning: "45 mm Series 8; used watches around ₪1,000–1,300.",
  },
  {
    id: "demo-12",
    title: "Canon EOS R6 body",
    price: 7200,
    location: "Haifa",
    condition: "Used",
    listedAge: "1 week ago",
    product: "Canon EOS R6 body",
    category: "camera",
    marketLow: 5500,
    marketHigh: 6500,
    confidence: "medium",
    reasoning: "R6 body; used bodies sell around ₪5,500–6,500.",
  },
  {
    id: "demo-13",
    title: "iPhone 11 64GB",
    price: 1400,
    location: "Ramat Gan",
    condition: "Used",
    listedAge: "Today",
    product: "iPhone 11 64GB",
    category: "phone",
    marketLow: 800,
    marketHigh: 1000,
    confidence: "high",
    reasoning: "64 GB iPhone 11; used phones go for ₪800–1,000.",
  },
  {
    id: "demo-14",
    title: "Xbox Series X",
    price: 1900,
    location: "Jerusalem",
    condition: "Used",
    listedAge: "3 days ago",
    product: "Xbox Series X",
    category: "console",
    marketLow: 1700,
    marketHigh: 2100,
    confidence: "high",
    reasoning: "Series X; used consoles list around ₪1,700–2,100.",
  },
  {
    id: "demo-15",
    title: "ספה 3 מושבים אפורה",
    price: 1200,
    location: "תל אביב",
    condition: "Used",
    listedAge: "Yesterday",
    product: "Sofa",
    category: "other",
    marketLow: null,
    marketHigh: null,
    confidence: "low",
    reasoning: "Not electronics (local filter)",
    skipReason: "Not electronics (local filter)",
  },
  {
    id: "demo-16",
    title: "iPhone 14 Pro clear case",
    price: 80,
    location: "Haifa",
    condition: "New",
    listedAge: "Today",
    product: "iPhone case",
    category: "other",
    marketLow: null,
    marketHigh: null,
    confidence: "low",
    reasoning: "Accessory (phone case)",
    skipReason: "Accessory (phone case)",
  },
  {
    id: "demo-17",
    title: "קונה מחשבים ניידים במצב טוב",
    price: null,
    location: "Jerusalem",
    listedAge: "Today",
    product: "",
    category: "other",
    marketLow: null,
    marketHigh: null,
    confidence: "low",
    reasoning: "Wanted ad",
    skipReason: "Looking to buy",
  },
  {
    id: "demo-18",
    title: "AirPods Pro 2",
    price: null,
    location: "Tel Aviv",
    condition: "Used",
    listedAge: "6 days ago",
    product: "AirPods Pro 2",
    category: "audio",
    marketLow: 600,
    marketHigh: 750,
    confidence: "low",
    reasoning: "AirPods Pro 2; asking price missing.",
  },
];

function toListing(c: ItemConfig): Listing {
  return {
    id: c.id,
    title: c.title,
    price: c.price,
    previousPrice: c.previousPrice ?? null,
    currency: c.price === null ? "" : "ILS",
    priceText: c.price === null ? "" : "₪" + c.price.toLocaleString("en-US"),
    location: c.location,
    url: "https://www.facebook.com/marketplace/",
    imageUrl: "",
    condition: c.condition ?? "",
    listedAge: c.listedAge ?? "",
  };
}

function toResult(c: ItemConfig): DealResult {
  const listing = toListing(c);
  if (c.skipReason !== undefined) {
    return {
      listing,
      skipped: true,
      skipReason: c.skipReason,
      product: c.product,
      category: c.category,
      marketLow: null,
      marketHigh: null,
      confidence: c.confidence,
      reasoning: c.reasoning,
      ratio: null,
      savings: null,
      verdict: "unknown",
      verification: c.verification ?? null,
    };
  }
  const { ratio, savings, verdict } = computeVerdict(
    listing.price,
    c.marketLow,
    c.marketHigh,
    c.confidence,
  );
  return {
    listing,
    skipped: false,
    skipReason: "",
    product: c.product,
    category: c.category,
    marketLow: c.marketLow,
    marketHigh: c.marketHigh,
    confidence: c.confidence,
    reasoning: c.reasoning,
    ratio,
    savings,
    verdict,
    verification: c.verification ?? null,
  };
}

const results = items.map(toResult).sort(compareDeals);
// 18 listings screened with Haiku plus 4 web-search checks with Sonnet, at measured prices.
const costUsd = 0.29;

const outPath = fileURLToPath(new URL("../site/demo.json", import.meta.url));
writeFileSync(outPath, JSON.stringify({ results, costUsd }, null, 2) + "\n");
console.log(`Wrote ${results.length} demo results to ${outPath}`);

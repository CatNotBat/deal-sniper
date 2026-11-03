import type { Env, FBListing, EbayPriceResult, ClaudeVerdict } from "./types";

// === Phase 1 Prompt: Extract product identifiers for eBay search ===
const EXTRACT_PROMPT = `You are a product identification expert for Facebook Marketplace listings in Israel. You understand Hebrew, English, and transliterated brand names fluently.

For each listing, identify the product and output an optimized English search query for eBay.

Hebrew brand/product translations you MUST know:
אייפון=iPhone, מקבוק=MacBook, גלקסי=Galaxy, סוני=Sony, פלייסטיישן=PlayStation, אייפד=iPad, סמסונג=Samsung, לנובו=Lenovo, דל=Dell, אסוס=Asus, פרו=Pro, מקס=Max, אולטרה=Ultra, נייד=laptop/portable, נייח=desktop, גיימינג=gaming, מסך=monitor/screen, כרטיס מסך=GPU, מצלמה=camera, אוזניות=headphones, שעון=watch, טאבלט=tablet, מקלדת=keyboard, עכבר=mouse, רמקול=speaker

Respond with ONLY a JSON array, no markdown fences:
[{"index":1,"query":"Lenovo ThinkPad T480 i5 8th gen laptop","category":"laptop"},{"index":5,"skip":true}]

Rules:
- "query" = English search query optimized for eBay. Include: brand, model, key specs (CPU, RAM, storage, screen size). Exclude: condition words, Hebrew filler, seller notes.
- "category" = one of: laptop, desktop, phone, tablet, monitor, gpu, console, camera, headphones, watch, speaker, other
- Set "skip":true (omit query/category) for: non-electronics (furniture, vehicles, jewelry, food, clothing), unidentifiable items (no brand or model), accessories only (cases, chargers, cables), placeholder prices
- Keep queries 3-7 words. Be specific: "iPhone 14 Pro Max 256GB" not just "iPhone".
- EVERY listing must appear in output (either with query or skip:true).

Listings:`;

// === Phase 3 Prompt: Judge deals with real eBay price data ===
const ASSESS_PROMPT = `You are a deal-finding expert for Facebook Marketplace in Israel. You understand Hebrew and English fluently.

You will receive listings with their REAL market prices from eBay. Your job is to surface every genuine deal — err on the side of flagging, not hiding.

Respond with ONLY a JSON array, no markdown fences:
[{"index":1,"verdict":"GREAT","score":82,"reasoning":"iPhone 14 Pro Max at $320 vs $427 eBay median. 25% below market."}]

Verdict tiers:
- "STEAL" — >40% below eBay market price. Flag even if suspiciously cheap — user verifies.
- "GREAT" — 25-40% below market.
- "GOOD" — 15-25% below market.

Rules:
- Compare the FB price (in USD) against the eBay median price provided. The math is straightforward.
- For items marked "[NO EBAY DATA]": use your knowledge of current USED market prices. Used electronics in Israel typically sell for 50-70% of US retail. Flag if the FB price seems notably low even by used-market standards. When unsure, lean toward flagging — the user verifies.
- "score" is 1-100 for ranking within tiers.
- Keep "reasoning" to 1 SHORT sentence (under 20 words), in English. Include the key numbers.
- ONLY output STEAL/GREAT/GOOD entries. Omit everything else (fair-priced or overpriced).
- This is a deal-finding tool, NOT a scam detector. Cheap = potentially good. User verifies in person.
- DO NOT skip items just because they look suspiciously cheap — that's the user's call.

Listings:`;

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
}

export async function fetchUsdIlsRate(): Promise<number> {
  try {
    const resp = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!resp.ok) return 3.6;
    const data: { rates?: { ILS?: number } } = await resp.json();
    return data.rates?.ILS ?? 3.6;
  } catch {
    return 3.6;
  }
}

// === Phase 1: Extract product identifiers ===

export interface ProductInfo {
  searchQuery: string;
  category: string;
  skip: boolean;
}

export async function extractProducts(
  listings: FBListing[],
  env: Env,
  rate: number,
): Promise<Map<string, ProductInfo>> {
  const results = new Map<string, ProductInfo>();
  if (listings.length === 0) return results;

  const BATCH = 60;
  for (let b = 0; b < listings.length; b += BATCH) {
    const batch = listings.slice(b, b + BATCH);
    const batchResults = await extractBatch(batch, env, rate, b);
    for (const [id, info] of batchResults) {
      results.set(id, info);
    }
  }

  return results;
}

async function extractBatch(
  listings: FBListing[],
  env: Env,
  rate: number,
  indexOffset: number,
): Promise<Map<string, ProductInfo>> {
  const results = new Map<string, ProductInfo>();

  const listingsText = listings
    .map((l, i) => {
      const cur = l.currency || "ILS";
      const priceUsd = cur === "USD" ? l.price : Math.round(l.price / rate);
      const symbol = cur === "USD" ? "$" : "₪";
      const priceStr = cur === "USD"
        ? `$${l.price}`
        : `${symbol}${l.price} (~$${priceUsd})`;
      const extras: string[] = [];
      if (l.condition) extras.push(`condition: ${l.condition}`);
      // Include raw card text if it adds context beyond the parsed title
      if (l.rawText && l.rawText.length > l.title.length + 10) {
        const snippet = l.rawText.replace(/\n/g, " ").substring(0, 120).trim();
        if (snippet !== l.title) extras.push(`card text: ${snippet}`);
      }
      const extraStr = extras.length ? ` [${extras.join(", ")}]` : "";
      return `[${indexOffset + i + 1}] "${l.title}" — ${priceStr}${extraStr}`;
    })
    .join("\n");

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        messages: [
          { role: "user", content: EXTRACT_PROMPT + "\n" + listingsText },
        ],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${errBody}`);
    }

    const data: ClaudeResponse = await resp.json();
    const text = data.content?.[0]?.text || "";
    console.log("Phase 1 (extract) raw:", text.substring(0, 500));

    const parsed = parseJsonResponse(text);

    for (const item of parsed) {
      const idx = item.index - 1;
      const listingIdx = idx - indexOffset;
      if (listingIdx >= 0 && listingIdx < listings.length) {
        results.set(listings[listingIdx].id, {
          searchQuery: item.query || "",
          category: item.category || "other",
          skip: !!item.skip,
        });
      }
    }
  } catch (err) {
    console.error("Phase 1 (extract) failed:", err);
  }

  return results;
}

// === Phase 3: Assess deals with real eBay data ===

export interface DealAssessment {
  verdict: string;
  score: number;
  reasoning: string;
}

export async function assessDeals(
  listings: FBListing[],
  ebayData: Map<string, EbayPriceResult | null>,
  env: Env,
  rate: number,
): Promise<Map<string, DealAssessment>> {
  const results = new Map<string, DealAssessment>();
  if (listings.length === 0) return results;

  const BATCH = 60;
  for (let b = 0; b < listings.length; b += BATCH) {
    const batch = listings.slice(b, b + BATCH);
    const batchResults = await assessBatch(batch, ebayData, env, rate, b);
    for (const [id, assessment] of batchResults) {
      results.set(id, assessment);
    }
  }

  return results;
}

async function assessBatch(
  listings: FBListing[],
  ebayData: Map<string, EbayPriceResult | null>,
  env: Env,
  rate: number,
  indexOffset: number,
): Promise<Map<string, DealAssessment>> {
  const results = new Map<string, DealAssessment>();

  const rateNote = `\n\nCurrent exchange rate: 1 USD = ${rate.toFixed(2)} ILS\n`;

  const listingsText = listings
    .map((l, i) => {
      const cur = l.currency || "ILS";
      const priceUsd = cur === "USD" ? l.price : Math.round(l.price / rate);
      const symbol = cur === "USD" ? "$" : "₪";
      const priceStr = cur === "USD"
        ? `$${l.price}`
        : `${symbol}${l.price} (~$${priceUsd})`;

      const ebay = ebayData.get(l.id);
      const ebayStr = ebay && ebay.sampleSize >= 1
        ? `eBay median: $${ebay.medianPrice} (${ebay.sampleSize} listings, range $${ebay.lowPrice}-$${ebay.highPrice})`
        : "[NO EBAY DATA — use your knowledge of used market prices]";

      const extras: string[] = [];
      if (l.condition) extras.push(`condition: ${l.condition}`);
      const extraStr = extras.length ? ` [${extras.join(", ")}]` : "";

      return `[${indexOffset + i + 1}] "${l.title}" — ${priceStr}${extraStr} | ${ebayStr}`;
    })
    .join("\n");

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        messages: [
          { role: "user", content: ASSESS_PROMPT + rateNote + "\n" + listingsText },
        ],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${errBody}`);
    }

    const data: ClaudeResponse = await resp.json();
    const text = data.content?.[0]?.text || "";
    console.log("Phase 3 (assess) raw:", text.substring(0, 500));

    const parsed = parseJsonResponse(text);
    console.log(`Phase 3 parsed ${parsed.length} entries from batch at offset ${indexOffset}`);

    for (const v of parsed) {
      const idx = v.index - 1;
      const listingIdx = idx - indexOffset;
      if (listingIdx >= 0 && listingIdx < listings.length) {
        results.set(listings[listingIdx].id, {
          verdict: v.verdict,
          score: v.score ?? 50,
          reasoning: v.reasoning || "",
        });
      } else {
        console.log(`Phase 3: index ${v.index} out of range (offset ${indexOffset}, batch size ${listings.length})`);
      }
    }
  } catch (err) {
    console.error("Phase 3 (assess) failed:", err);
  }

  return results;
}

// === Shared JSON parsing ===

function parseJsonResponse(text: string): any[] {
  let jsonStr = text.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    // Try to recover truncated JSON
    const lastBrace = jsonStr.lastIndexOf("}");
    if (lastBrace > 0) {
      jsonStr = jsonStr.substring(0, lastBrace + 1) + "]";
      return JSON.parse(jsonStr);
    }
    throw new Error("Could not parse Claude response");
  }
}

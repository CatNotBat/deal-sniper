import type { Env, EbayPriceResult } from "./types";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getEbayToken(env: Env): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!resp.ok) {
    throw new Error(`eBay auth failed: ${resp.status}`);
  }

  const data: { access_token: string; expires_in: number } = await resp.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// Hebrew brand names / product types → English (multi-word first, then single-word)
const HEBREW_TRANSLATIONS: [RegExp, string][] = [
  // Multi-word phrases (must come before single-word)
  [/מחשב\s*נייד/g, "laptop"],
  [/מחשב\s*גיימינג/g, "gaming PC"],
  [/מחשב\s*נייח/g, "desktop PC"],
  [/מחשב\s*שולחני/g, "desktop PC"],
  [/מחשב\s*מיני/g, "mini PC"],
  [/מסך\s*גיימינג/g, "gaming monitor"],
  [/מסך\s*מחשב/g, "monitor"],
  [/כרטיס\s*מסך/g, "GPU"],
  [/לוח\s*אם/g, "motherboard"],
  [/ספק\s*כוח/g, "power supply"],
  [/מארז\s*מחשב/g, "PC case"],
  // Brands (Hebrew transliterations)
  [/לנובו/g, "Lenovo"],
  [/דל/g, "Dell"],
  [/סמסונג/g, "Samsung"],
  [/אפל/g, "Apple"],
  [/מקבוק/g, "MacBook"],
  [/אסוס/g, "Asus"],
  [/אייפון/g, "iPhone"],
  [/אייפד/g, "iPad"],
  [/נייד/g, "laptop"],
  // Generic product types (single-word, after multi-word)
  [/מחשב/g, "PC"],
  [/מסך/g, "monitor"],
  [/מקלדת/g, "keyboard"],
  [/עכבר/g, "mouse"],
  [/אוזניות/g, "headphones"],
  [/רמקול/g, "speaker"],
  [/מצלמה/g, "camera"],
  [/טלוויזיה/g, "TV"],
  [/מדפסת/g, "printer"],
];

export function cleanSearchQuery(title: string): string {
  // Translate Hebrew brand names and product types before stripping
  let translated = title;
  for (const [pattern, replacement] of HEBREW_TRANSLATIONS) {
    translated = translated.replace(pattern, replacement);
  }

  return translated
    // Strip remaining Hebrew/Arabic/CJK characters
    .replace(/[\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(obo|firm|pick\s*up|local|cash|sale|deal|price|urgent|asap|must\s*go|brand\s*new|like\s*new|mint|sealed)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length >= 2)
    .slice(0, 6)
    .join(" ");
}

// eBay category IDs for electronics to filter out accessories/parts
const CATEGORY_MAP: Record<string, string> = {
  laptop:       "175672",   // Laptops & Netbooks
  macbook:      "175672",
  notebook:     "175672",
  thinkpad:     "175672",
  ideapad:      "175672",
  desktop:      "179",      // Desktops & All-In-Ones
  pc:           "179",
  nuc:          "179",
  monitor:      "80053",    // Monitors
  gpu:          "27386",    // Graphics/Video Cards
  geforce:      "27386",
  rtx:          "27386",
  radeon:       "27386",
  motherboard:  "1244",     // Motherboards
  iphone:       "9355",     // Cell Phones & Smartphones
  galaxy:       "9355",
  pixel:        "9355",
  samsung:      "9355",
  phone:        "9355",
  ipad:         "171485",   // Tablets
  tablet:       "171485",
  playstation:  "139971",   // Video Game Consoles
  ps5:          "139971",
  ps4:          "139971",
  xbox:         "139971",
  nintendo:     "139971",
  switch:       "139971",
  camera:       "31388",    // Digital Cameras
  canon:        "31388",
  nikon:        "31388",
  sony:         "31388",
  watch:        "178893",   // Smartwatches
  garmin:       "178893",
  "apple watch": "178893",
};

function detectCategory(query: string): string | null {
  const lower = query.toLowerCase();
  for (const [keyword, catId] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return catId;
  }
  return null;
}

export async function getEbayPrices(
  title: string,
  env: Env,
  searchQuery?: string,
): Promise<EbayPriceResult | null> {
  const token = await getEbayToken(env);
  const query = searchQuery || cleanSearchQuery(title);

  if (query.length < 3) return null;

  // Detect category from query to filter out accessories
  const categoryId = detectCategory(query);

  const params = new URLSearchParams({
    q: query,
    limit: "50",
    filter: "buyingOptions:{FIXED_PRICE}",
    // No condition filter — too restrictive, many used items listed as "new"/"refurbished"
  });

  if (categoryId) {
    params.set("category_ids", categoryId);
  }

  const resp = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    }
  );

  if (!resp.ok) {
    console.error(`eBay search failed: ${resp.status} for query "${query}"`);
    return null;
  }

  const data: { itemSummaries?: Array<{ price?: { value?: string } }> } =
    await resp.json();

  if (!data.itemSummaries || data.itemSummaries.length === 0) return null;

  const prices = data.itemSummaries
    .map((item) => parseFloat(item.price?.value || "0"))
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  if (prices.length < 1) return null;

  // Trim top/bottom 20% to remove accessory/outlier contamination (only when we have enough data)
  const trimStart = prices.length >= 5 ? Math.floor(prices.length * 0.2) : 0;
  const trimEnd = prices.length >= 5 ? Math.ceil(prices.length * 0.8) : prices.length;
  const trimmed = prices.slice(trimStart, trimEnd);

  if (trimmed.length === 0) return null;

  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const median = trimmed[Math.floor(trimmed.length / 2)];

  return {
    query,
    medianPrice: Math.round(median),
    avgPrice: Math.round(avg),
    sampleSize: prices.length,
    lowPrice: prices[0],
    highPrice: prices[prices.length - 1],
  };
}

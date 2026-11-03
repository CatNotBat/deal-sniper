import type { DealResult, Listing } from "./types";

export const SCREEN_SYSTEM = `You appraise second-hand listings from Facebook Marketplace. Listings may be in any language (often Hebrew or English) and any currency.

For each listing:
1. Identify the exact product: brand, model, and the specs that move the price (storage, RAM, CPU/GPU, screen size, generation). Write it as a short English product name in "product".
2. Decide whether to skip it. Skip when it is not consumer electronics, is only an accessory (case, charger, cable, box), is a wanted/buying ad, has a placeholder price (1, 123, 1234 and similar), or is too vague to identify a model. Set "skip": true and give a short "skipReason"; fill the other fields with your best guess or null.
3. Estimate what this item typically sells for USED, in good working condition, in the listing's own currency and country, as a realistic range "marketLow"–"marketHigh". Use the seller's location and currency as the market. Base it on second-hand prices, not new retail. If the listing has no usable price or currency, still give the range in the currency most likely for its location.
4. "confidence": high when the exact model and key specs are clear and you know its used price well; medium when specs are partly missing; low when you are guessing.
5. "reasoning": one short sentence in English, under 20 words, naming the key fact behind your estimate (e.g. "M1 2020 base model; these trade around ₪1,800–2,200 used.").

Do not judge whether it is a good deal; only estimate the market. Return every listing id exactly once.`;

export function buildScreenUser(listings: Listing[]): string {
  const lines = listings.map((l) => {
    const o: Record<string, unknown> = { id: l.id };
    if (l.title !== "") o.title = l.title;
    if (l.price !== null) o.price = l.price;
    if (l.previousPrice !== null) o.previousPrice = l.previousPrice;
    if (l.currency !== "") o.currency = l.currency;
    if (l.location !== "") o.location = l.location;
    if (l.condition !== "") o.condition = l.condition;
    if (l.listedAge !== "") o.listedAge = l.listedAge;
    return JSON.stringify(o);
  });
  return "Listings (JSON lines):\n" + lines.join("\n");
}

export const VERIFY_SYSTEM = `You double-check a used-market price estimate for one Facebook Marketplace listing, using web search. Search for recent second-hand prices of this exact product in the listing's country and currency (local classifieds, price comparison sites, completed sales). Two or three searches are enough.

Then answer with a short paragraph, and end your reply with a JSON object in a \`\`\`json fenced block:
{"marketLow": number, "marketHigh": number, "summary": "one or two sentences on what the sources show", "redFlags": ["..."]}

Prices are in the listing's currency. "redFlags" lists concrete reasons to be careful with THIS listing (price far below any source, model often counterfeited, iCloud/activation-lock risk, missing specs); use [] if none.`;

export function buildVerifyUser(r: DealResult): string {
  const l = r.listing;
  const out: string[] = [];
  out.push(`title: ${l.title}`);
  out.push(`price: ${l.price === null ? "unknown" : l.price} ${l.currency}`.trim());
  if (l.previousPrice !== null) {
    out.push(`previousPrice: ${l.previousPrice} ${l.currency}`.trim());
  }
  if (l.location !== "") out.push(`location: ${l.location}`);
  if (l.condition !== "") out.push(`condition: ${l.condition}`);
  out.push(`url: ${l.url}`);
  out.push(`estimated product: ${r.product}`);
  out.push(`estimated used range: ${r.marketLow ?? "?"}–${r.marketHigh ?? "?"} ${l.currency}`.trim());
  out.push(`estimate reasoning: ${r.reasoning}`);
  return out.join("\n");
}

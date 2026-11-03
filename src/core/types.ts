export interface Listing {
  id: string; // FB item id (digits)
  title: string;
  price: number | null; // null = could not parse; 0 = free
  previousPrice: number | null; // struck-through original price if the card shows one
  currency: string; // ISO 4217 when unambiguous ("ILS","USD","EUR","GBP","BRL","JPY","CHF","PLN","AED","SAR"), else the raw token ("kr"), "" if none
  priceText: string; // raw price line as shown
  location: string;
  url: string; // canonical https://www.facebook.com/marketplace/item/<id>/
  imageUrl: string; // "" if none
  condition: string; // "" if none
  listedAge: string; // "" if none
}

export type Category =
  | "phone"
  | "laptop"
  | "desktop"
  | "tablet"
  | "monitor"
  | "gpu"
  | "console"
  | "camera"
  | "audio"
  | "watch"
  | "other";

export type Verdict = "steal" | "great" | "good" | "fair" | "overpriced" | "unknown";
export type Confidence = "low" | "medium" | "high";

export interface Source {
  url: string;
  title: string;
}

export interface DealResult {
  listing: Listing;
  skipped: boolean;
  skipReason: string;
  product: string; // normalised English product name
  category: Category;
  marketLow: number | null;
  marketHigh: number | null; // used-market range, listing currency
  confidence: Confidence;
  reasoning: string; // one short sentence
  ratio: number | null; // price / midpoint
  savings: number | null; // midpoint - price (can be negative)
  verdict: Verdict;
  verification:
    | null
    | { status: "ok"; summary: string; redFlags: string[]; sources: Source[] }
    | { status: "error"; message: string };
}

export type PipelineEvent =
  | { type: "screen-progress"; done: number; total: number } // listings screened so far
  | { type: "screened"; results: DealResult[] }
  | { type: "verify-start"; id: string }
  | { type: "verified"; result: DealResult }
  | { type: "cost"; usd: number } // cumulative, emitted after every API call
  | { type: "warning"; message: string };

export interface Env {
  EBAY_CLIENT_ID: string;
  EBAY_CLIENT_SECRET: string;
  ANTHROPIC_API_KEY: string;
  AUTH_TOKEN: string;
  EBAY_VERIFICATION_TOKEN: string;
}

/** What the bookmarklet sends */
export interface FBListing {
  id: string;
  title: string;
  price: number;
  currency?: string;
  location: string;
  url: string;
  imageUrl: string;
  condition?: string;
  listedAge?: string;
  rawText?: string;
}

/** Aggregated eBay price data for a search query */
export interface EbayPriceResult {
  query: string;
  medianPrice: number;
  avgPrice: number;
  sampleSize: number;
  lowPrice: number;
  highPrice: number;
}

/** A scored deal returned to the bookmarklet */
export interface DealResult {
  listing: FBListing;
  ebayMedian: number;
  ebaySampleSize: number;
  savingsPercent: number;
  claudeVerdict: string;
  claudeScore: number;
  claudeReasoning: string;
}

export interface AnalyzeRequest {
  listings: FBListing[];
}

export interface AnalyzeResponse {
  deals: DealResult[];
  errors: string[];
}

export interface ClaudeVerdict {
  index: number;
  verdict: "STEAL" | "GREAT" | "GOOD" | "MEH" | "BAD" | "HORRIBLE";
  score?: number;
  reasoning: string;
}

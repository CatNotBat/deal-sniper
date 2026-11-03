import type { Confidence, DealResult, Verdict } from "./types";

export const VERDICT_RANK: Record<Verdict, number> = {
  steal: 0,
  great: 1,
  good: 2,
  fair: 3,
  overpriced: 4,
  unknown: 5,
};

export function midpoint(low: number | null, high: number | null): number | null {
  if (low === null || high === null) return null;
  if (high < low || high <= 0) return null;
  return (low + high) / 2;
}

export function computeVerdict(
  price: number | null,
  low: number | null,
  high: number | null,
  confidence: Confidence,
): { ratio: number | null; savings: number | null; verdict: Verdict } {
  const mid = midpoint(low, high);
  if (price === null || mid === null) {
    return { ratio: null, savings: null, verdict: "unknown" };
  }

  const ratio = price / mid;
  const savings = mid - price;

  let verdict: Verdict;
  if (price === 0) verdict = "steal";
  else if (ratio <= 0.6) verdict = "steal";
  else if (ratio <= 0.75) verdict = "great";
  else if (ratio <= 0.85) verdict = "good";
  else if (ratio <= 1.1) verdict = "fair";
  else verdict = "overpriced";

  if (confidence === "low" && VERDICT_RANK[verdict] < VERDICT_RANK.good) {
    verdict = "good";
  }

  return { ratio, savings, verdict };
}

export function compareDeals(a: DealResult, b: DealResult): number {
  const ra = VERDICT_RANK[a.verdict];
  const rb = VERDICT_RANK[b.verdict];
  if (ra !== rb) return ra - rb;

  if (a.ratio === null || b.ratio === null) {
    if (a.ratio === null && b.ratio !== null) return 1;
    if (b.ratio === null && a.ratio !== null) return -1;
  } else if (a.ratio !== b.ratio) {
    return a.ratio - b.ratio;
  }

  if (a.savings === null || b.savings === null) {
    if (a.savings === null && b.savings !== null) return 1;
    if (b.savings === null && a.savings !== null) return -1;
    return 0;
  }
  return b.savings - a.savings;
}

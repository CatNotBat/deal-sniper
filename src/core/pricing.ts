export const MODELS = {
  screen: "claude-haiku-5-5",
  verify: "claude-sonnet-5-5",
} as const;

// USD per million tokens.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export const WEB_SEARCH_USD = 0.01;

export function costOf(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    server_tool_use?: { web_search_requests?: number | null } | null;
  },
): number {
  const price = MODEL_PRICES[model] ?? MODEL_PRICES["claude-opus-5-5"]!;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const webSearches = usage.server_tool_use?.web_search_requests ?? 0;

  return (
    (usage.input_tokens * price.input) / 1_000_000 +
    (usage.output_tokens * price.output) / 1_000_000 +
    (cacheWrite * price.input * 1.25) / 1_000_000 +
    (cacheRead * price.input * 0.1) / 1_000_000 +
    webSearches * WEB_SEARCH_USD
  );
}

export function formatUsd(x: number): string {
  if (x < 0.01) return "<$0.01";
  return "$" + x.toFixed(2);
}

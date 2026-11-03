import { describe, expect, it } from "vitest";
import { costOf, formatUsd } from "../src/core/pricing";

describe("costOf", () => {
  it("computes a simple input+output cost", () => {
    expect(costOf("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(
      0.1 + 0.5,
    );
  });

  it("applies cache write (1.25x) and read (0.1x) multipliers", () => {
    const cost = costOf("claude-sonnet-5-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2.5 + 0.2);
  });

  it("adds web search costs", () => {
    const cost = costOf("claude-haiku-5-5", {
      input_tokens: 0,
      output_tokens: 0,
      server_tool_use: { web_search_requests: 3 },
    });
    expect(cost).toBeCloseTo(0.03);
  });

  it("uses the opus price for an unknown model", () => {
    expect(costOf("mystery-model", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
  });
});

describe("formatUsd", () => {
  it("formats below one cent", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
  });

  it("formats with two decimals", () => {
    expect(formatUsd(0.03)).toBe("$0.03");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

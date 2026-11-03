import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AuthenticationError } from "@anthropic-ai/sdk";
import { runPipeline } from "../src/core/pipeline";
import { costOf } from "../src/core/pricing";
import type { Listing, PipelineEvent } from "../src/core/types";

const USAGE = {
  input_tokens: 1000,
  output_tokens: 100,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  server_tool_use: null,
};

function listing(id: string, title = "iPhone 12 64GB"): Listing {
  return {
    id,
    title,
    price: 100,
    previousPrice: null,
    currency: "USD",
    priceText: "$100",
    location: "Tel Aviv",
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    imageUrl: "",
    condition: "Used",
    listedAge: "2 hours ago",
  };
}

function item(id: string) {
  return {
    id,
    skip: false,
    skipReason: "",
    product: "iPhone 12 64GB",
    category: "phone",
    marketLow: 180,
    marketHigh: 220,
    confidence: "high",
    reasoning: "test",
  };
}

function okScreen(items: unknown[]) {
  return { stop_reason: "end_turn", parsed_output: { items }, usage: USAGE };
}

function idsFromCall(call: unknown[]): string[] {
  const params = call[0] as { messages: Array<{ content: string }> };
  return [...params.messages[0]!.content.matchAll(/"id":"(\d+)"/g)].map((m) => m[1]!);
}

function fakeClient(parse: unknown, create: unknown): Pick<Anthropic, "messages"> {
  return { messages: { parse, create } } as unknown as Pick<Anthropic, "messages">;
}

describe("runPipeline", () => {
  it("batches by batchSize and respects concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const parse = vi.fn(async (params: unknown) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      const ids = idsFromCall([params]);
      return okScreen(ids.map(item));
    });
    const create = vi.fn();

    const res = await runPipeline(
      [listing("1"), listing("2"), listing("3"), listing("4")],
      { client: fakeClient(parse, create), batchSize: 2, concurrency: 2 },
    );

    expect(parse).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    const sizes = parse.mock.calls.map((c) => idsFromCall(c as unknown[]).length).sort();
    expect(sizes).toEqual([2, 2]);
    expect(res.results).toHaveLength(4);
  });

  it("skips local non-electronics without any API call", async () => {
    const parse = vi.fn();
    const create = vi.fn();

    const res = await runPipeline([listing("1", "IKEA sofa")], {
      client: fakeClient(parse, create),
    });

    expect(parse).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(res.results[0]!.skipped).toBe(true);
    expect(res.results[0]!.skipReason).toBe("Not electronics (local filter)");
  });

  it("marks listings missing from the response as unknown", async () => {
    const parse = vi.fn(async () => okScreen([]));
    const create = vi.fn();

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    expect(res.results[0]!.verdict).toBe("unknown");
    expect(res.results[0]!.reasoning).toBe("No estimate returned");
  });

  it("handles a refusal by marking the batch unknown and warning", async () => {
    const parse = vi.fn(async () => ({ stop_reason: "refusal", parsed_output: null, usage: USAGE }));
    const create = vi.fn();
    const events: PipelineEvent[] = [];

    const res = await runPipeline([listing("1")], {
      client: fakeClient(parse, create),
      onEvent: (e) => events.push(e),
    });

    expect(res.results[0]!.verdict).toBe("unknown");
    expect(res.results[0]!.skipReason).toBe("Model declined");
    expect(events.some((e) => e.type === "warning")).toBe(true);
  });

  it("splits a max_tokens batch of 4 into 2+2", async () => {
    const parse = vi.fn(async (params: unknown) => {
      const ids = idsFromCall([params]);
      if (ids.length === 4) {
        return { stop_reason: "max_tokens", parsed_output: null, usage: USAGE };
      }
      return okScreen(ids.map(item));
    });
    const create = vi.fn();

    const res = await runPipeline([listing("1"), listing("2"), listing("3"), listing("4")], {
      client: fakeClient(parse, create),
      batchSize: 4,
      concurrency: 1,
    });

    const sizes = parse.mock.calls.map((c) => idsFromCall(c as unknown[]).length).sort();
    expect(sizes).toEqual([2, 2, 4]);
    expect(res.results).toHaveLength(4);
  });

  it("verifies the top N candidates", async () => {
    const parse = vi.fn(async (params: unknown) => okScreen(idsFromCall([params]).map(item)));
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [
        {
          type: "text",
          text: '```json\n{"marketLow": 180, "marketHigh": 220, "summary": "ok", "redFlags": []}\n```',
          citations: [{ type: "web_search_result_location", title: "S", url: "https://s.com/1" }],
        },
      ],
    }));

    const res = await runPipeline([listing("1"), listing("2"), listing("3")], {
      client: fakeClient(parse, create),
      verifyTop: 2,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(res.results.filter((r) => r.verification?.status === "ok")).toHaveLength(2);
  });

  it("resumes a pause_turn", async () => {
    const parse = vi.fn(async () => okScreen([item("1")]));
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "pause_turn",
        usage: USAGE,
        content: [{ type: "text", text: "searching...", citations: null }],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        usage: USAGE,
        content: [
          {
            type: "text",
            text: '```json\n{"marketLow": 180, "marketHigh": 220, "summary": "ok", "redFlags": []}\n```',
            citations: [{ type: "web_search_result_location", title: "S", url: "https://s.com/1" }],
          },
        ],
      });

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    expect(create).toHaveBeenCalledTimes(2);
    expect(res.results[0]!.verification).toMatchObject({ status: "ok" });
  });

  it("collects and dedupes sources from web search results and citations", async () => {
    const parse = vi.fn(async () => okScreen([item("1")]));
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [
        {
          type: "web_search_tool_result",
          content: [
            { type: "web_search_result", title: "A", url: "https://a.com/1" },
            { type: "web_search_result", title: "B", url: "https://b.com/2" },
          ],
        },
        {
          type: "text",
          text: '```json\n{"marketLow": 180, "marketHigh": 220, "summary": "ok", "redFlags": []}\n```',
          citations: [
            { type: "web_search_result_location", title: "A dup", url: "https://a.com/1" },
            { type: "web_search_result_location", title: "C", url: "https://c.com/3" },
          ],
        },
      ],
    }));

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    const v = res.results[0]!.verification;
    expect(v?.status).toBe("ok");
    if (v?.status === "ok") {
      expect(v.sources.map((s) => s.url)).toEqual([
        "https://a.com/1",
        "https://b.com/2",
        "https://c.com/3",
      ]);
    }
  });

  it("reports unconfirmed, keeping the screening range, when search found no prices", async () => {
    const parse = vi.fn(async () => okScreen([item("1")]));
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [
        {
          type: "text",
          text: '```json\n{"pricesFound": false, "marketLow": 10, "marketHigh": 20, "summary": "not confirmed", "redFlags": []}\n```',
          citations: [{ type: "web_search_result_location", title: "S", url: "https://s.com/1" }],
        },
      ],
    }));

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    const r = res.results[0]!;
    expect(r.verification).toMatchObject({ status: "unconfirmed", summary: "not confirmed" });
    expect(r.marketLow).toBe(180);
  });

  it("reports unconfirmed when search returned no sources", async () => {
    const parse = vi.fn(async () => okScreen([item("1")]));
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [
        {
          type: "text",
          text: '```json\n{"marketLow": 180, "marketHigh": 220, "summary": "ok", "redFlags": []}\n```',
          citations: null,
        },
      ],
    }));

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    expect(res.results[0]!.verification).toMatchObject({ status: "unconfirmed" });
  });

  it("keeps at most three red flags", async () => {
    const parse = vi.fn(async () => okScreen([item("1")]));
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [
        {
          type: "text",
          text: '```json\n{"marketLow": 180, "marketHigh": 220, "summary": "ok", "redFlags": ["a", "b", "c", "d"]}\n```',
          citations: [{ type: "web_search_result_location", title: "S", url: "https://s.com/1" }],
        },
      ],
    }));

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    const v = res.results[0]!.verification;
    expect(v?.status).toBe("ok");
    if (v?.status === "ok") expect(v.redFlags).toEqual(["a", "b", "c"]);
  });

  it("marks malformed verify text as an error but the run still succeeds", async () => {
    const parse = vi.fn(async () => okScreen([item("1")]));
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [{ type: "text", text: "no json here at all", citations: null }],
    }));

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    expect(res.results[0]!.verification).toMatchObject({ status: "error" });
  });

  it("propagates AuthenticationError", async () => {
    const parse = vi.fn(async () => {
      throw new AuthenticationError(
        401,
        { type: "authentication_error", message: "invalid key" },
        "invalid x-api-key",
        new Headers(),
      );
    });
    const create = vi.fn();

    await expect(
      runPipeline([listing("1")], { client: fakeClient(parse, create) }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("totals cost across screening and verification", async () => {
    const parse = vi.fn(async () => okScreen([item("1")]));
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [
        {
          type: "text",
          text: '```json\n{"marketLow": 180, "marketHigh": 220, "summary": "ok", "redFlags": []}\n```',
          citations: null,
        },
      ],
    }));

    const res = await runPipeline([listing("1")], { client: fakeClient(parse, create) });

    const expected = costOf("claude-haiku-5-5", USAGE) + costOf("claude-sonnet-5-5", USAGE);
    expect(res.costUsd).toBeCloseTo(expected);
  });
});

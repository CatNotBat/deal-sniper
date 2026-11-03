import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIError, APIUserAbortError, AuthenticationError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { looksLikeNonElectronics } from "./card";
import { MODELS, costOf } from "./pricing";
import { SCREEN_SYSTEM, VERIFY_SYSTEM, buildScreenUser, buildVerifyUser } from "./prompts";
import { ScreenBatchSchema, VerifySchema } from "./schema";
import type { ScreenItem } from "./schema";
import type { Confidence, DealResult, Listing, PipelineEvent, Source } from "./types";
import { compareDeals, computeVerdict } from "./verdict";

export interface PipelineOptions {
  client: Pick<Anthropic, "messages">; // injected; tests pass a fake
  screenModel?: string; // default MODELS.screen
  verifyModel?: string; // default MODELS.verify
  verifyTop?: number; // default 5; 0 disables verification
  batchSize?: number; // default 40
  concurrency?: number; // default 3 parallel screening calls
  signal?: AbortSignal;
  onEvent?: (e: PipelineEvent) => void;
}

type VerifyOutcome =
  | { status: "ok"; summary: string; redFlags: string[]; sources: Source[]; marketLow: number; marketHigh: number }
  | { status: "unconfirmed"; summary: string; redFlags: string[]; sources: Source[] }
  | { status: "error"; message: string };

const MAX_RED_FLAGS = 3;

function isAuthOrAbort(err: unknown): boolean {
  return err instanceof AuthenticationError || err instanceof APIUserAbortError;
}

/** Errors that would hit every batch the same way (bad key, no credit, unknown model,
 *  network/CORS, rate limit after retries): stop the run instead of marking items unknown.
 *  Only transient server errors (5xx, overloaded) are absorbed per batch. */
function isFatalForRun(err: unknown): boolean {
  if (isAuthOrAbort(err) || err instanceof APIConnectionError) return true;
  if (err instanceof APIError) return typeof err.status !== "number" || err.status < 500;
  return false;
}

function skippedResult(l: Listing, skipReason: string): DealResult {
  return {
    listing: l,
    skipped: true,
    skipReason,
    product: "",
    category: "other",
    marketLow: null,
    marketHigh: null,
    confidence: "low",
    reasoning: skipReason,
    ratio: null,
    savings: null,
    verdict: "unknown",
    verification: null,
  };
}

function unknownResult(l: Listing, reasoning: string, skipReason = ""): DealResult {
  return {
    listing: l,
    skipped: skipReason !== "",
    skipReason,
    product: "",
    category: "other",
    marketLow: null,
    marketHigh: null,
    confidence: "low",
    reasoning,
    ratio: null,
    savings: null,
    verdict: "unknown",
    verification: null,
  };
}

function dealFromItem(l: Listing, item: ScreenItem): DealResult {
  if (item.skip) {
    return {
      listing: l,
      skipped: true,
      skipReason: item.skipReason || "",
      product: item.product || "",
      category: item.category,
      marketLow: null,
      marketHigh: null,
      confidence: item.confidence,
      reasoning: item.reasoning || item.skipReason || "",
      ratio: null,
      savings: null,
      verdict: "unknown",
      verification: null,
    };
  }
  const { ratio, savings, verdict } = computeVerdict(
    l.price,
    item.marketLow,
    item.marketHigh,
    item.confidence,
  );
  return {
    listing: l,
    skipped: false,
    skipReason: "",
    product: item.product || "",
    category: item.category,
    marketLow: item.marketLow,
    marketHigh: item.marketHigh,
    confidence: item.confidence,
    reasoning: item.reasoning || "",
    ratio,
    savings,
    verdict,
    verification: null,
  };
}

function extractLastJson(text: string): string | null {
  const fenceRe = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = fenceRe.exec(text)) !== null) {
    last = (m[1] ?? "").trim();
  }
  if (last !== null && last !== "") return last;

  const lastClose = text.lastIndexOf("}");
  if (lastClose === -1) return null;
  for (let open = text.lastIndexOf("{", lastClose); open !== -1; open = text.lastIndexOf("{", open - 1)) {
    const candidate = text.slice(open, lastClose + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // keep scanning backward
    }
  }
  return null;
}

export async function runPipeline(
  listings: Listing[],
  opts: PipelineOptions,
): Promise<{ results: DealResult[]; costUsd: number }> {
  const {
    client,
    screenModel = MODELS.screen,
    verifyModel = MODELS.verify,
    verifyTop = 3,
    batchSize = 40,
    concurrency = 3,
    signal,
    onEvent,
  } = opts;

  const emit = (e: PipelineEvent): void => {
    try {
      onEvent?.(e);
    } catch {
      // ignore listener errors
    }
  };

  let costUsd = 0;
  const addCost = (model: string, usage: Parameters<typeof costOf>[1]): void => {
    costUsd += costOf(model, usage);
    emit({ type: "cost", usd: costUsd });
  };

  // Dedupe by id (keep first).
  const seen = new Set<string>();
  const unique: Listing[] = [];
  for (const l of listings) {
    if (!l.id || seen.has(l.id)) continue;
    seen.add(l.id);
    unique.push(l);
  }

  const resultById = new Map<string, DealResult>();

  // Local non-electronics prefilter — no API call.
  const toScreen: Listing[] = [];
  for (const l of unique) {
    if (looksLikeNonElectronics(l.title)) {
      resultById.set(l.id, skippedResult(l, "Not electronics (local filter)"));
    } else {
      toScreen.push(l);
    }
  }

  const screenBatch = async (batch: Listing[]): Promise<DealResult[]> => {
    if (batch.length === 0) return [];

    let resp;
    try {
      resp = await client.messages.parse(
        {
          model: screenModel,
          max_tokens: 16000,
          system: SCREEN_SYSTEM,
          messages: [{ role: "user", content: buildScreenUser(batch) }],
          output_config: { format: zodOutputFormat(ScreenBatchSchema) },
        },
        { signal },
      );
    } catch (err) {
      if (isFatalForRun(err)) throw err;
      emit({ type: "warning", message: `Screening failed: ${(err as Error).message}` });
      return batch.map((l) => unknownResult(l, "Screening error"));
    }

    addCost(screenModel, resp.usage);

    if (resp.stop_reason === "refusal") {
      emit({ type: "warning", message: "Model declined a screening batch" });
      return batch.map((l) => unknownResult(l, "Model declined", "Model declined"));
    }

    const parsed = resp.parsed_output;
    if (resp.stop_reason === "max_tokens" || parsed === null) {
      if (batch.length > 1) {
        const mid = Math.floor(batch.length / 2);
        const left = await screenBatch(batch.slice(0, mid));
        const right = await screenBatch(batch.slice(mid));
        return [...left, ...right];
      }
      emit({ type: "warning", message: "Model output truncated for a single listing" });
      return batch.map((l) => unknownResult(l, "Model output truncated"));
    }

    const itemsById = new Map<string, ScreenItem>();
    for (const item of parsed.items) {
      if (item.id && !itemsById.has(item.id)) itemsById.set(item.id, item);
    }

    return batch.map((l) => {
      const item = itemsById.get(l.id);
      if (!item) return unknownResult(l, "No estimate returned");
      return dealFromItem(l, item);
    });
  };

  if (toScreen.length > 0) {
    const batches: Listing[][] = [];
    for (let i = 0; i < toScreen.length; i += batchSize) {
      batches.push(toScreen.slice(i, i + batchSize));
    }
    const queue = [...batches];
    const total = toScreen.length;
    let done = 0;

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const batch = queue.shift()!;
        const deals = await screenBatch(batch);
        for (const d of deals) resultById.set(d.listing.id, d);
        done += batch.length;
        emit({ type: "screen-progress", done, total });
      }
    };

    const workerCount = Math.min(concurrency, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  const allResults = [...resultById.values()].sort(compareDeals);
  emit({ type: "screened", results: allResults });

  // --- Verification ---
  const runVerification = async (r: DealResult): Promise<VerifyOutcome> => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildVerifyUser(r) }];
    const sources: Source[] = [];
    let webSearchError = "";
    let lastResp: Anthropic.Message | null = null;

    for (let turn = 0; turn <= 3; turn++) {
      const resp = await client.messages.create(
        {
          model: verifyModel,
          max_tokens: 4000,
          system: VERIFY_SYSTEM,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
          messages,
        },
        { signal },
      );
      lastResp = resp;
      addCost(verifyModel, resp.usage);

      for (const block of resp.content ?? []) {
        if (block.type === "web_search_tool_result") {
          const c = block.content;
          if (Array.isArray(c)) {
            for (const item of c) {
              if (item.url) sources.push({ url: item.url, title: item.title ?? "" });
            }
          } else {
            webSearchError = `web search error: ${c.error_code}`;
          }
        } else if (block.type === "text") {
          for (const cit of block.citations ?? []) {
            if (cit.type === "web_search_result_location" && cit.url) {
              sources.push({ url: cit.url, title: cit.title ?? "" });
            }
          }
        }
      }

      if (resp.stop_reason === "pause_turn" && turn < 3) {
        messages.push({
          role: "assistant",
          content: resp.content as unknown as Anthropic.MessageParam["content"],
        });
        continue;
      }
      break;
    }

    const seenUrl = new Set<string>();
    const finalSources: Source[] = [];
    for (const s of sources) {
      if (!/^https?:\/\//i.test(s.url)) continue;
      if (seenUrl.has(s.url)) continue;
      seenUrl.add(s.url);
      finalSources.push(s);
      if (finalSources.length === 5) break;
    }

    const text = (lastResp?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join("\n");

    const jsonStr = extractLastJson(text);
    if (jsonStr === null) {
      return {
        status: "error",
        message: "Could not extract verification JSON" + (webSearchError ? ` (${webSearchError})` : ""),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return {
        status: "error",
        message: "Could not parse verification JSON" + (webSearchError ? ` (${webSearchError})` : ""),
      };
    }
    const result = VerifySchema.safeParse(parsed);
    if (!result.success) {
      return {
        status: "error",
        message: "Verification JSON failed validation" + (webSearchError ? ` (${webSearchError})` : ""),
      };
    }
    const redFlags = result.data.redFlags.slice(0, MAX_RED_FLAGS);
    // Only call it verified when search ran cleanly, returned pages and the model says they held prices.
    if (!result.data.pricesFound || finalSources.length === 0 || webSearchError !== "") {
      return { status: "unconfirmed", summary: result.data.summary, redFlags, sources: finalSources };
    }
    return {
      status: "ok",
      summary: result.data.summary,
      redFlags,
      sources: finalSources,
      marketLow: result.data.marketLow,
      marketHigh: result.data.marketHigh,
    };
  };

  const candidates = allResults
    .filter((r) => !r.skipped && (r.verdict === "steal" || r.verdict === "great" || r.verdict === "good"))
    .slice(0, verifyTop);

  const verifyOne = async (r: DealResult): Promise<void> => {
    emit({ type: "verify-start", id: r.listing.id });
    let outcome: VerifyOutcome;
    try {
      outcome = await runVerification(r);
    } catch (err) {
      if (isAuthOrAbort(err)) throw err;
      outcome = { status: "error", message: (err as Error).message };
    }

    if (outcome.status === "ok") {
      r.marketLow = outcome.marketLow;
      r.marketHigh = outcome.marketHigh;
      if (r.confidence === "low") r.confidence = "medium";
      const { ratio, savings, verdict } = computeVerdict(
        r.listing.price,
        r.marketLow,
        r.marketHigh,
        r.confidence,
      );
      r.ratio = ratio;
      r.savings = savings;
      r.verdict = verdict;
      r.verification = {
        status: "ok",
        summary: outcome.summary,
        redFlags: outcome.redFlags,
        sources: outcome.sources,
      };
    } else if (outcome.status === "unconfirmed") {
      r.verification = outcome;
    } else {
      r.verification = { status: "error", message: outcome.message };
    }
    emit({ type: "verified", result: r });
  };

  if (candidates.length > 0) {
    const queue = [...candidates];
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const c = queue.shift()!;
        await verifyOne(c);
      }
    };
    const workerCount = Math.min(2, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  const results = [...resultById.values()].sort(compareDeals);
  return { results, costUsd };
}

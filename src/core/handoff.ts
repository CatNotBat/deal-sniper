import { ListingsSchema } from "./schema";
import type { Listing } from "./types";

export const HANDOFF_VERSION = "v1";
export const MAX_DECODED_BYTES = 5_000_000;

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) {
    throw new HandoffError("Invalid base64 in handoff");
  }
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new HandoffError("Invalid base64 in handoff");
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function readStream(stream: ReadableStream<Uint8Array>, maxBytes?: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (maxBytes !== undefined && total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new HandoffError("Handoff data exceeds the size limit");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function encodeListings(listings: Listing[]): Promise<string> {
  const json = JSON.stringify({ v: 1, at: Date.now(), listings });
  const bytes = new TextEncoder().encode(json);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = await readStream(stream);
  return HANDOFF_VERSION + "." + bytesToBase64Url(compressed);
}

export async function decodeListings(s: string): Promise<{ at: number; listings: Listing[] }> {
  let t = s;
  if (t.startsWith("#")) t = t.slice(1);
  if (t.startsWith("d=")) t = t.slice(2);

  if (!t.startsWith(HANDOFF_VERSION + ".")) {
    throw new HandoffError("Unsupported handoff version");
  }
  const payload = t.slice((HANDOFF_VERSION + ".").length);
  const bytes = base64UrlToBytes(payload);

  let decompressed: Uint8Array;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    decompressed = await readStream(stream, MAX_DECODED_BYTES);
  } catch (err) {
    if (err instanceof HandoffError) throw err;
    throw new HandoffError("Could not decompress handoff data");
  }

  let json: string;
  try {
    json = new TextDecoder().decode(decompressed);
  } catch {
    throw new HandoffError("Could not decode handoff text");
  }

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new HandoffError("Handoff data is not valid JSON");
  }

  if (typeof obj !== "object" || obj === null || (obj as { v?: unknown }).v !== 1) {
    throw new HandoffError("Handoff data has an unexpected version");
  }

  let listings: Listing[];
  try {
    listings = ListingsSchema.parse((obj as { listings?: unknown }).listings);
  } catch {
    throw new HandoffError("Handoff data is not a valid listing array");
  }

  const at = typeof (obj as { at?: unknown }).at === "number" ? ((obj as { at: number }).at as number) : 0;
  return { at, listings };
}

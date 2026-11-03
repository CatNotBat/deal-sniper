// Encoder half of the handoff codec. Kept free of zod so the bookmarklet bundle stays small.
import type { Listing } from "./types";

export const HANDOFF_VERSION = "v1";

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

export async function readStream(stream: ReadableStream<Uint8Array>, maxBytes?: number): Promise<Uint8Array<ArrayBuffer>> {
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

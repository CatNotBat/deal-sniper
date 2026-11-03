import { describe, expect, it } from "vitest";
import { HandoffError, decodeListings, encodeListings } from "../src/core/handoff";
import type { Listing } from "../src/core/types";

function makeListing(id: string): Listing {
  return {
    id,
    title: `Item ${id}`,
    price: 100,
    previousPrice: null,
    currency: "USD",
    priceText: "$100",
    location: "Nowhere",
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    imageUrl: "",
    condition: "Used",
    listedAge: "2 hours ago",
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("handoff", () => {
  it("round-trips 500 listings", async () => {
    const listings = Array.from({ length: 500 }, (_, i) => makeListing(String(i + 1)));
    const encoded = await encodeListings(listings);
    expect(encoded.startsWith("v1.")).toBe(true);
    const decoded = await decodeListings(encoded);
    expect(decoded.listings).toEqual(listings);
    expect(typeof decoded.at).toBe("number");
  });

  it("accepts a leading # and/or d= prefix", async () => {
    const encoded = await encodeListings([makeListing("1")]);
    const expected = await decodeListings(encoded);
    expect(await decodeListings("#" + encoded)).toEqual(expected);
    expect(await decodeListings("d=" + encoded)).toEqual(expected);
    expect(await decodeListings("#d=" + encoded)).toEqual(expected);
  });

  it("rejects a wrong version prefix", async () => {
    await expect(decodeListings("v2.abc")).rejects.toBeInstanceOf(HandoffError);
    await expect(decodeListings("garbage")).rejects.toBeInstanceOf(HandoffError);
  });

  it("rejects garbage base64", async () => {
    await expect(decodeListings("v1.!!!!")).rejects.toBeInstanceOf(HandoffError);
  });

  it("rejects valid base64 of non-deflate data", async () => {
    const notDeflate = new TextEncoder().encode("this is not deflate data ".repeat(50));
    await expect(decodeListings("v1." + toBase64Url(notDeflate))).rejects.toBeInstanceOf(HandoffError);
  });

  it("rejects a payload whose decompressed size exceeds the cap", async () => {
    const big = new TextEncoder().encode(" ".repeat(6_000_000));
    const compressed = await deflateRaw(big);
    await expect(decodeListings("v1." + toBase64Url(compressed))).rejects.toBeInstanceOf(HandoffError);
  });

  it("rejects a javascript: url", async () => {
    const bad = makeListing("1");
    bad.url = "javascript:alert(1)";
    const encoded = await encodeListings([bad]);
    await expect(decodeListings(encoded)).rejects.toBeInstanceOf(HandoffError);
  });
});

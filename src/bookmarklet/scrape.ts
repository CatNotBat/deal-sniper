import { canonicalItemUrl, extractItemId, parseCardLines } from "../core/card";
import type { Listing } from "../core/types";

const ITEM_ANCHOR_SELECTOR = 'a[href*="/marketplace/item/"], a[href*="item_id="]';

export function findItemAnchors(root: ParentNode): HTMLAnchorElement[] {
  const anchors = root.querySelectorAll<HTMLAnchorElement>(ITEM_ANCHOR_SELECTOR);
  const seen = new Set<string>();
  const out: HTMLAnchorElement[] = [];
  for (const a of anchors) {
    const id = extractItemId(a.href);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    out.push(a);
  }
  return out;
}

/** In real browsers `innerText` reflects rendered text (one string per visual line).
 *  jsdom does not implement `innerText`, so fall back to walking text nodes. */
export function textLines(el: Element): string[] {
  const text = (el as HTMLElement).innerText;
  if (typeof text === "string" && text !== "") {
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const out: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    const t = (node.textContent ?? "").trim();
    if (t !== "") out.push(t);
    node = walker.nextNode();
  }
  return out;
}

/** Walk up from the anchor (at most 8 levels) while each parent contains item anchors
 *  of ONLY this one id and has fewer than 12 text lines. Returns the last ancestor that
 *  satisfies both, which keeps a card's text from swallowing neighbouring cards. */
export function cardRootFor(a: HTMLAnchorElement): Element {
  const id = extractItemId(a.href);
  let best: Element = a;
  let node: Element = a;
  for (let i = 0; i < 8 && node.parentElement !== null; i++) {
    const parent = node.parentElement;
    const anchors = parent.querySelectorAll<HTMLAnchorElement>(ITEM_ANCHOR_SELECTOR);
    let onlyThisId = true;
    for (const ia of anchors) {
      if (extractItemId(ia.href) !== id) {
        onlyThisId = false;
        break;
      }
    }
    if (!onlyThisId) break;
    if (textLines(parent).length >= 12) break;
    best = parent;
    node = parent;
  }
  return best;
}

/** `known`: ids already collected; their cards are skipped (measuring text forces layout). */
export function scrapeDocument(doc: Document, known?: ReadonlySet<string>): Listing[] {
  const out: Listing[] = [];
  for (const a of findItemAnchors(doc)) {
    const id = extractItemId(a.href);
    if (id === null || known?.has(id)) continue;
    const root = cardRootFor(a);
    const parsed = parseCardLines(textLines(root));
    if (parsed === null) continue;
    let imageUrl = "";
    const img = root.querySelector("img");
    const src = img ? img.src : "";
    if (src.startsWith("https:")) imageUrl = src;
    out.push({ id, url: canonicalItemUrl(id), imageUrl, ...parsed });
  }
  return out;
}

import type { Listing } from "./types";
import { parsePrice } from "./price";

// Copied from the old bookmarklet (already anchored); reuse the same semantics.
const ageRe =
  /^(פורסמו?\s+ממש\s+עכשיו|posted\s+just\s+now|listed\s+just\s+now|עכשיו|just\s+now|today|yesterday|\d+\s*(minute|hour|day|week|month|שע|דק|יו|שבו|חודש)s?\s*ago|לפני\s+.+)$/i;
const condRe = /^(new|used|like new|open box|refurbished|חדש|משומש|כמו חדש|מחודש)$/i;
// Bare location like "צפת, Z" — a bad parse where the city was grabbed as the title.
const locOnlyRe = /^[֐-׿\s\-'"]+,\s*[A-Z]{1,3}$/;

export function extractItemId(href: string): string | null {
  const m = href.match(/\/marketplace\/item\/(\d+)/i) ?? href.match(/item_id=(\d+)/i);
  return m ? (m[1] ?? null) : null;
}

export function canonicalItemUrl(id: string): string {
  return `https://www.facebook.com/marketplace/item/${id}/`;
}

export function parseCardLines(
  lines: string[],
): Omit<Listing, "id" | "url" | "imageUrl"> | null {
  const ls = lines.map((s) => s.trim()).filter((s) => s.length > 0);
  if (ls.length === 0) return null;

  let listedAge = "";
  let condition = "";
  for (const ln of ls) {
    if (listedAge === "" && ageRe.test(ln)) listedAge = ln;
    if (condition === "" && condRe.test(ln)) condition = ln;
  }

  const isPrice = (l: string): boolean => parsePrice(l) !== null;
  const eligible = (l: string): boolean => !isPrice(l) && !ageRe.test(l) && !condRe.test(l);

  let priceText = "";
  let price: number | null = null;
  let currency = "";
  let previousPrice: number | null = null;
  let title = "";
  let location = "";
  let titleIdx = -1;

  const priceIdx = ls.findIndex((l) => isPrice(l));

  if (priceIdx >= 0) {
    const p = parsePrice(ls[priceIdx]!)!;
    priceText = ls[priceIdx]!;
    price = p.amount;
    currency = p.currency;
    previousPrice = p.previous;

    // Separate-line struck-through original price.
    if (previousPrice === null && priceIdx + 1 < ls.length && isPrice(ls[priceIdx + 1]!)) {
      previousPrice = parsePrice(ls[priceIdx + 1]!)!.amount;
    }

    for (let i = priceIdx + 1; i < ls.length; i++) {
      if (eligible(ls[i]!)) {
        title = ls[i]!;
        titleIdx = i;
        break;
      }
    }
    if (titleIdx >= 0) {
      for (let j = titleIdx + 1; j < ls.length; j++) {
        if (eligible(ls[j]!)) {
          location = ls[j]!;
          break;
        }
      }
    }
  } else {
    title = ls[0]!;
    titleIdx = 0;
    if (ls[1] !== undefined && !ageRe.test(ls[1]!) && !condRe.test(ls[1]!)) {
      location = ls[1]!;
    }
  }

  // A line that looked like a title but is actually just a location.
  if (title !== "" && locOnlyRe.test(title)) {
    location = title;
    title = "";
    for (let j = titleIdx + 1; j < ls.length; j++) {
      if (eligible(ls[j]!)) {
        title = ls[j]!;
        break;
      }
    }
  }

  if (title === "") return null;

  return { title, price, previousPrice, currency, priceText, location, condition, listedAge };
}

const NON_ELEC_EN =
  /\b(?:furniture|sofa|car|apartment|rent|clothing|shoes|dress|baby stroller|bike|plant|food)\b/i;
const NON_ELEC_HE =
  /(?:^|\s)(?:ספה|כיסא|שולחן|ארון|רכב|מכונית|אופנוע|דירה|השכרה|בגדים|נעליים|שמלה|עגלה|אופניים|צמח)(?:\s|$)/;

export function looksLikeNonElectronics(title: string): boolean {
  return NON_ELEC_EN.test(title) || NON_ELEC_HE.test(title);
}

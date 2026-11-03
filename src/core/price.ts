export interface ParsedPrice {
  amount: number | null;
  currency: string;
  free: boolean;
  previous: number | null;
}

const FREE_RE = /^(free|חינם|gratis|gratuit|kostenlos)$/i;

// Ordered alternation: leftmost alternative wins, so "R$" and "US$" must precede "$".
// Letter tokens use \b...\b so "kr"/"SAR"/"NIS" never match inside ordinary words.
const CURRENCY_TOKENS: Array<{ pattern: string; currency: string }> = [
  { pattern: "R\\$", currency: "BRL" },
  { pattern: "US\\$", currency: "USD" },
  { pattern: "₪", currency: "ILS" },
  { pattern: "€", currency: "EUR" },
  { pattern: "£", currency: "GBP" },
  { pattern: "¥", currency: "JPY" },
  { pattern: "zł", currency: "PLN" },
  { pattern: "\\$", currency: "USD" },
  { pattern: 'ש"ח', currency: "ILS" },
  { pattern: "ש״ח", currency: "ILS" },
  { pattern: "שח", currency: "ILS" },
  { pattern: "\\bILS\\b", currency: "ILS" },
  { pattern: "\\bNIS\\b", currency: "ILS" },
  { pattern: "\\bUSD\\b", currency: "USD" },
  { pattern: "\\bEUR\\b", currency: "EUR" },
  { pattern: "\\bGBP\\b", currency: "GBP" },
  { pattern: "\\bJPY\\b", currency: "JPY" },
  { pattern: "\\bCHF\\b", currency: "CHF" },
  { pattern: "\\bPLN\\b", currency: "PLN" },
  { pattern: "\\bAED\\b", currency: "AED" },
  { pattern: "\\bSAR\\b", currency: "SAR" },
  { pattern: "\\bkr\\b", currency: "kr" },
];

const CUR_SRC = "(?:" + CURRENCY_TOKENS.map((t) => t.pattern).join("|") + ")";
const NUM_SRC = "\\d+(?:[.,\\s\\u00A0\\u202F]\\d+)*";

// A whole line is one price, or two prices back-to-back ("₪800₪1,000" / "$1,200 $1,500").
// A price is either <currency><number> or <number><currency>, with optional space between.
const FULL_RE = new RegExp(
  "^(?:" +
    CUR_SRC +
    "\\s*" +
    NUM_SRC +
    "|" +
    NUM_SRC +
    "\\s*" +
    CUR_SRC +
    ")" +
    "(?:\\s*(?:" +
    CUR_SRC +
    "\\s*" +
    NUM_SRC +
    "|" +
    NUM_SRC +
    "\\s*" +
    CUR_SRC +
    "))?$",
  "i",
);

const CUR_EXTRACT_RE = new RegExp(CUR_SRC, "gi");
const NUM_EXTRACT_RE = /\d+(?:[.,\s  ]\d+)*/g;

const CURRENCY_MAP: Record<string, string> = {
  "R$": "BRL",
  "US$": "USD",
  "$": "USD",
  "₪": "ILS",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "zł": "PLN",
  'ש"ח': "ILS",
  "ש״ח": "ILS",
  "שח": "ILS",
  "ils": "ILS",
  "nis": "ILS",
  "usd": "USD",
  "eur": "EUR",
  "gbp": "GBP",
  "jpy": "JPY",
  "chf": "CHF",
  "pln": "PLN",
  "aed": "AED",
  "sar": "SAR",
  "kr": "kr",
};

function currencyOf(token: string): string | null {
  const key = /^[A-Za-z]+$/.test(token) ? token.toLowerCase() : token;
  return CURRENCY_MAP[key] ?? null;
}

export function parseAmount(s: string): number | null {
  const stripped = s.replace(/[\s  ]/g, "");
  if (stripped === "" || !/\d/.test(stripped)) return null;
  if (!/^[\d.,]+$/.test(stripped)) return null;

  const hasDot = stripped.includes(".");
  const hasComma = stripped.includes(",");

  if (!hasDot && !hasComma) return parseInt(stripped, 10);

  if (hasDot && hasComma) {
    const decIdx = Math.max(stripped.lastIndexOf("."), stripped.lastIndexOf(","));
    const intPart = stripped.slice(0, decIdx).replace(/[.,]/g, "");
    const fracPart = stripped.slice(decIdx + 1);
    return parseFloat(intPart + "." + fracPart);
  }

  const sep = hasDot ? "." : ",";
  const parts = stripped.split(sep);
  const groupsAfterFirst = parts.slice(1);
  if (groupsAfterFirst.length > 0 && groupsAfterFirst.every((g) => g.length === 3)) {
    // Every group after the first separator is a 3-digit group → thousands separator.
    return parseInt(stripped.replace(/[.,]/g, ""), 10);
  }
  const decIdx = stripped.lastIndexOf(sep);
  const intPart = stripped.slice(0, decIdx).replace(/[.,]/g, "");
  const fracPart = stripped.slice(decIdx + 1);
  return parseFloat(intPart + "." + fracPart);
}

export function parsePrice(line: string): ParsedPrice | null {
  const s = line.trim();
  if (s === "") return null;

  if (FREE_RE.test(s)) {
    return { amount: 0, currency: "", free: true, previous: null };
  }

  if (!FULL_RE.test(s)) return null;

  const numbers = [...s.matchAll(NUM_EXTRACT_RE)].map((m) => m[0]);
  const tokens = [...s.matchAll(CUR_EXTRACT_RE)].map((m) => m[0]);
  if (numbers.length === 0 || tokens.length === 0) return null;

  const currency = currencyOf(tokens[0]!);
  if (currency === null) return null;

  const amount = parseAmount(numbers[0]!);
  if (amount === null) return null;

  let previous: number | null = null;
  if (numbers.length > 1) {
    previous = parseAmount(numbers[1]!);
    if (previous === null) return null;
  }

  return { amount, currency, free: false, previous };
}

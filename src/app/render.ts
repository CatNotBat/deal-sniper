import type { DealResult, Verdict } from "../core/types";

const VERDICT_LABELS: Record<Verdict, string> = {
  steal: "Steal",
  great: "Great deal",
  good: "Good deal",
  fair: "Fair",
  overpriced: "Overpriced",
  unknown: "Unknown",
};

function isHttpsFacebookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

function isHttpsImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function hostnameWithoutWww(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatMoney(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  if (amount === 0) return "Free";
  if (/^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      // fall through to the plain fallback
    }
  }
  return `${amount.toLocaleString()} ${currency}`.trim();
}

export function renderDeal(
  doc: Document,
  tpl: HTMLTemplateElement,
  r: DealResult,
  state?: "pending",
): HTMLLIElement {
  const frag = tpl.content.cloneNode(true) as DocumentFragment;
  const li = frag.querySelector("li");
  if (li === null) throw new Error("template missing <li>");
  li.dataset.verdict = r.verdict;
  li.dataset.id = r.listing.id;
  const l = r.listing;

  const badge = frag.querySelector(".badge");
  if (badge) badge.textContent = VERDICT_LABELS[r.verdict];

  const media = frag.querySelector<HTMLAnchorElement>(".deal-media");
  const appendGlyph = (): void => {
    const span = doc.createElement("span");
    span.className = "glyph";
    span.textContent = r.category === "other" ? "item" : r.category;
    media?.appendChild(span);
  };
  if (media) {
    if (isHttpsFacebookUrl(l.url)) media.href = l.url;
    if (isHttpsImageUrl(l.imageUrl)) {
      const img = doc.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = l.imageUrl;
      img.addEventListener("error", () => {
        img.remove();
        appendGlyph();
      });
      media.appendChild(img);
    } else {
      appendGlyph();
    }
  }

  const titleA = frag.querySelector<HTMLAnchorElement>(".deal-title a");
  if (titleA) {
    titleA.textContent = l.title;
    if (isHttpsFacebookUrl(l.url)) titleA.href = l.url;
  }

  const productEl = frag.querySelector(".deal-product");
  if (productEl) {
    if (r.product === "") {
      productEl.setAttribute("hidden", "");
    } else {
      productEl.textContent = r.confidence === "low" ? `${r.product} · low confidence` : r.product;
    }
  }

  const priceEl = frag.querySelector(".price");
  if (priceEl) priceEl.textContent = formatMoney(l.price, l.currency);

  const wasEl = frag.querySelector(".was");
  if (wasEl) {
    if (l.previousPrice === null) wasEl.setAttribute("hidden", "");
    else wasEl.textContent = formatMoney(l.previousPrice, l.currency);
  }

  const savingEl = frag.querySelector(".saving");
  if (savingEl) {
    if (r.ratio !== null && r.ratio < 0.95) {
      savingEl.textContent = `−${Math.round((1 - r.ratio) * 100)}%`;
    } else {
      savingEl.setAttribute("hidden", "");
    }
  }

  const marketEl = frag.querySelector(".market");
  if (marketEl) {
    if (r.marketLow === null || r.marketHigh === null) {
      marketEl.setAttribute("hidden", "");
    } else {
      marketEl.textContent = `Used market ${formatMoney(r.marketLow, l.currency)}–${formatMoney(r.marketHigh, l.currency)}`;
    }
  }

  const rangeEl = frag.querySelector<HTMLElement>(".range");
  if (rangeEl) {
    if (r.marketLow === null || r.marketHigh === null || l.price === null) {
      rangeEl.setAttribute("hidden", "");
    } else {
      const scale = (Math.max(r.marketHigh, l.price, l.previousPrice ?? 0) * 1.15) || 1;
      const pct = (v: number): number => Math.min(100, Math.max(0, (v / scale) * 100));
      rangeEl.style.setProperty("--lo", `${pct(r.marketLow)}%`);
      rangeEl.style.setProperty("--hi", `${pct(r.marketHigh)}%`);
      rangeEl.style.setProperty("--at", `${pct(l.price)}%`);
    }
  }

  const reasonEl = frag.querySelector(".deal-reason");
  if (reasonEl) reasonEl.textContent = r.reasoning;

  const metaEl = frag.querySelector(".deal-meta");
  if (metaEl) {
    metaEl.textContent = [l.location, l.listedAge, l.condition].filter((s) => s !== "").join(" · ");
  }

  const verify = frag.querySelector<HTMLElement>(".verify");
  const verifyHead = frag.querySelector<HTMLElement>(".verify-head");
  const verifySummary = frag.querySelector<HTMLElement>(".verify-summary");
  if (verify && verifyHead) {
    if (state === "pending") {
      verify.removeAttribute("hidden");
      verify.classList.add("pending");
      const spinner = doc.createElement("span");
      spinner.className = "spinner";
      verifyHead.replaceChildren(spinner, doc.createTextNode("Checking prices on the web…"));
    } else if (r.verification === null) {
      verify.setAttribute("hidden", "");
    } else if (r.verification.status === "ok") {
      verify.removeAttribute("hidden");
      verifyHead.textContent = "✓ Verified with web search";
      if (verifySummary) verifySummary.textContent = r.verification.summary;
      const flags = frag.querySelector(".flags");
      if (flags) {
        for (const f of r.verification.redFlags) {
          const item = doc.createElement("li");
          item.textContent = f;
          flags.appendChild(item);
        }
      }
      const sources = frag.querySelector(".sources");
      if (sources) {
        for (const s of r.verification.sources) {
          if (!isHttpUrl(s.url)) continue;
          const item = doc.createElement("li");
          const a = doc.createElement("a");
          a.textContent = hostnameWithoutWww(s.url);
          a.title = s.title;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.href = s.url;
          item.appendChild(a);
          sources.appendChild(item);
        }
      }
    } else {
      verify.removeAttribute("hidden");
      verify.classList.add("failed");
      verifyHead.textContent = "Couldn't verify";
      if (verifySummary) verifySummary.textContent = r.verification.message;
    }
  }

  return li;
}

export function renderSkipped(doc: Document, list: HTMLUListElement, skipped: DealResult[]): void {
  for (const s of skipped) {
    const li = doc.createElement("li");
    li.textContent = `${s.listing.title} — ${s.skipReason}`;
    list.appendChild(li);
  }
}

export interface Filter {
  key: string;
  label: string;
  match: (r: DealResult) => boolean;
}

export const FILTERS: Filter[] = [
  {
    key: "deals",
    label: "Deals",
    match: (r) => r.verdict === "steal" || r.verdict === "great" || r.verdict === "good",
  },
  { key: "steal", label: "Steals", match: (r) => r.verdict === "steal" },
  { key: "great", label: "Great", match: (r) => r.verdict === "great" },
  { key: "good", label: "Good", match: (r) => r.verdict === "good" },
  { key: "all", label: "Everything", match: (r) => !r.skipped },
];

export function renderFilters(
  doc: Document,
  container: HTMLElement,
  results: DealResult[],
  active: string,
  onPick: (key: string) => void,
): void {
  container.replaceChildren();
  for (const f of FILTERS) {
    const count = results.filter(f.match).length;
    const btn = doc.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(f.key === active));
    btn.appendChild(doc.createTextNode(f.label));
    const n = doc.createElement("span");
    n.className = "n";
    n.textContent = String(count);
    btn.appendChild(n);
    btn.addEventListener("click", () => onPick(f.key));
    container.appendChild(btn);
  }
}

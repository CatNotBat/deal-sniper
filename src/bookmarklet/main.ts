import { encodeListings } from "../core/handoff-encode";
import type { Listing } from "../core/types";
import { scrapeDocument } from "./scrape";

// Replaced by the landing page at install time with the absolute app.html URL.
// Kept as a plain string literal so it survives minification.
export const APP_URL = "__APP_URL__";

const ROOT_ID = "deal-sniper-root";
const CAP = 2000;
const MAX_ROUNDS = 60;
const SCROLL_INTERVAL_MS = 1500;
const SCRAPE_DEBOUNCE_MS = 400;

const PANEL_CSS = `
:host { all: initial; }

.ds-panel {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  width: 300px;
  box-sizing: border-box;
  background: #fffdf8;
  color: #17140f;
  border: 1px solid #e3ddd0;
  border-radius: 16px;
  box-shadow: 0 18px 50px -20px rgba(0, 0, 0, 0.45);
  padding: 18px;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}

.ds-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.ds-head .brand-mark { width: 20px; height: 20px; color: #e0461b; flex: none; }
.ds-title { font-weight: 700; font-size: 15px; }
.ds-spacer { flex: 1; }
.ds-close {
  border: 0; background: none; cursor: pointer;
  font: 18px/1 system-ui, sans-serif; color: inherit;
  padding: 2px 6px; border-radius: 6px;
}
.ds-close:hover { background: rgba(0, 0, 0, 0.06); }

.ds-count { font: 600 44px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: -0.03em; }
.ds-count-label { font-size: 13px; color: #6d665b; margin: 2px 0 10px; }
.ds-status {
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #6d665b; min-height: 18px; margin: 0 0 12px; overflow-wrap: anywhere;
}
.ds-status a { color: #e0461b; }

.ds-actions { display: flex; gap: 8px; margin-bottom: 10px; }
.ds-btn {
  flex: 1; height: 40px; border: 0; border-radius: 999px; cursor: pointer;
  font: 700 14px/1 system-ui, sans-serif; padding: 0 12px;
}
.ds-primary { background: #e0461b; color: #fff; }
.ds-primary:hover { filter: brightness(1.05); }
.ds-secondary { background: #17140f; color: #f5f2ea; }
.ds-secondary:hover { filter: brightness(1.2); }
.ds-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.ds-clear {
  border: 0; background: none; cursor: pointer; color: #6d665b;
  font: 12px/1 system-ui, sans-serif; text-decoration: underline; padding: 0;
}
.ds-clear:hover { color: #e0461b; }

@media (prefers-color-scheme: dark) {
  .ds-panel { background: #1b1a17; color: #eee9df; border-color: #2d2a25; }
  .ds-count-label, .ds-status, .ds-clear { color: #a1998c; }
  .ds-secondary { background: #eee9df; color: #1b1a17; }
  .ds-status a, .ds-clear:hover { color: #ff6a3d; }
}
`;

function brandMark(doc: Document): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("brand-mark");
  const outer = doc.createElementNS(NS, "circle");
  outer.setAttribute("cx", "12");
  outer.setAttribute("cy", "12");
  outer.setAttribute("r", "8");
  const inner = doc.createElementNS(NS, "circle");
  inner.setAttribute("cx", "12");
  inner.setAttribute("cy", "12");
  inner.setAttribute("r", "2.5");
  inner.setAttribute("fill", "currentColor");
  inner.setAttribute("stroke", "none");
  const path = doc.createElementNS(NS, "path");
  path.setAttribute("d", "M12 1v5M12 18v5M1 12h5M18 12h5");
  svg.appendChild(outer);
  svg.appendChild(inner);
  svg.appendChild(path);
  return svg;
}

function el(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function main(): void {
  const host = location.hostname.toLowerCase();
  const onFacebook = host === "facebook.com" || host.endsWith(".facebook.com");
  if (!onFacebook || !location.pathname.toLowerCase().includes("/marketplace")) {
    alert("Deal Sniper works on Facebook Marketplace. Open a Marketplace search, then click the bookmark again.");
    return;
  }

  const w = window as unknown as { __dealSniperCleanup?: () => void };
  if (w.__dealSniperCleanup) {
    w.__dealSniperCleanup();
    const existing = document.getElementById(ROOT_ID);
    if (existing) existing.remove();
    delete w.__dealSniperCleanup;
    return;
  }

  const collected = new Map<string, Listing>();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  const shadow = root.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);

  const panel = el(document, "div", "ds-panel");
  shadow.appendChild(panel);

  const head = el(document, "div", "ds-head");
  head.appendChild(brandMark(document));
  head.appendChild(el(document, "span", "ds-title", "Deal Sniper"));
  head.appendChild(el(document, "span", "ds-spacer"));
  const closeBtn = el(document, "button", "ds-close", "×") as HTMLButtonElement;
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const count = el(document, "div", "ds-count", "0");
  panel.appendChild(count);
  panel.appendChild(el(document, "div", "ds-count-label", "listings collected"));

  const status = el(document, "div", "ds-status");
  panel.appendChild(status);

  const actions = el(document, "div", "ds-actions");
  const scrollBtn = el(document, "button", "ds-btn ds-primary", "Auto-scroll") as HTMLButtonElement;
  scrollBtn.type = "button";
  const findBtn = el(document, "button", "ds-btn ds-secondary", "Find deals →") as HTMLButtonElement;
  findBtn.type = "button";
  findBtn.disabled = true;
  actions.appendChild(scrollBtn);
  actions.appendChild(findBtn);
  panel.appendChild(actions);

  const clearBtn = el(document, "button", "ds-clear", "Clear") as HTMLButtonElement;
  clearBtn.type = "button";
  panel.appendChild(clearBtn);

  document.documentElement.appendChild(root);

  let scrolling = false;
  let scrollTimer: number | undefined;
  let round = 0;
  let lastHeight = 0;
  let stable = 0;
  let debounceTimer: number | undefined;

  const merge = (listings: Listing[]): number => {
    let added = 0;
    for (const l of listings) {
      if (collected.size >= CAP) break;
      if (!collected.has(l.id)) {
        collected.set(l.id, l);
        added++;
      }
    }
    return added;
  };

  const renderCount = (): void => {
    count.textContent = String(collected.size);
    findBtn.disabled = collected.size === 0;
  };

  const setStatus = (msg: string): void => {
    status.textContent = msg;
  };

  const stopScroll = (): void => {
    scrolling = false;
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
    scrollTimer = undefined;
    scrollBtn.textContent = "Auto-scroll";
    setStatus(`Collected ${collected.size} listings`);
  };

  const step = (): void => {
    if (!scrolling) return;
    round++;
    window.scrollTo(0, document.documentElement.scrollHeight);
    scrollTimer = window.setTimeout(() => {
      if (!scrolling) return;
      const added = merge(scrapeDocument(document, new Set(collected.keys())));
      renderCount();
      const h = document.documentElement.scrollHeight;
      if (added === 0 && h === lastHeight) {
        stable++;
      } else {
        stable = 0;
        lastHeight = h;
      }
      setStatus(`Scrolling… round ${round}, +${added} new`);
      if (stable >= 4 || round >= MAX_ROUNDS || collected.size >= CAP) {
        stopScroll();
        return;
      }
      step();
    }, SCROLL_INTERVAL_MS);
  };

  const startScroll = (): void => {
    if (scrolling) return;
    scrolling = true;
    round = 0;
    lastHeight = 0;
    stable = 0;
    scrollBtn.textContent = "Stop";
    setStatus("Scrolling… round 0, +0 new");
    step();
  };

  const findDeals = async (): Promise<void> => {
    if (collected.size === 0) return;
    setStatus("Preparing…");
    let hash: string;
    try {
      hash = await encodeListings([...collected.values()]);
    } catch (err) {
      setStatus(`Could not prepare listings: ${(err as Error).message}`);
      return;
    }
    const url = APP_URL + "#" + hash;
    if (url.length > 1_900_000) {
      setStatus("Too many listings to fit in the link — clear and try again.");
      return;
    }
    const win = window.open(url, "_blank");
    if (win) {
      win.opener = null;
    } else {
      status.textContent = "Popup blocked — ";
      const a = document.createElement("a");
      a.textContent = "Open results";
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      a.href = url;
      status.appendChild(a);
    }
  };

  const observer = new MutationObserver(() => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      merge(scrapeDocument(document, new Set(collected.keys())));
      renderCount();
    }, SCRAPE_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const cleanup = (): void => {
    stopScroll();
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    observer.disconnect();
  };
  w.__dealSniperCleanup = cleanup;

  scrollBtn.addEventListener("click", () => {
    if (scrolling) stopScroll();
    else startScroll();
  });
  findBtn.addEventListener("click", () => {
    void findDeals();
  });
  clearBtn.addEventListener("click", () => {
    collected.clear();
    renderCount();
    setStatus("");
  });
  closeBtn.addEventListener("click", () => {
    cleanup();
    root.remove();
    delete w.__dealSniperCleanup;
  });

  merge(scrapeDocument(document, new Set(collected.keys())));
  renderCount();
}

main();

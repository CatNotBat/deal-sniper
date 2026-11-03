import Anthropic, {
  APIError,
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
} from "@anthropic-ai/sdk";
import { HandoffError, decodeListings } from "../core/handoff";
import { MODELS, formatUsd } from "../core/pricing";
import { runPipeline } from "../core/pipeline";
import { compareDeals } from "../core/verdict";
import type { DealResult, Listing, PipelineEvent } from "../core/types";
import { FILTERS, renderDeal, renderFilters, renderSkipped } from "./render";

const KEY = "ds:key";
const SETTINGS = "ds:settings";
const LISTINGS = "ds:listings";
const RESULTS = "ds:results";

const VIEW_IDS = ["view-empty", "view-key", "view-run", "view-error", "view-results"] as const;

interface Settings {
  screenModel: string;
  verifyTop: number;
}

const VALID_SCREEN_MODELS = new Set<string>(["claude-haiku-5-5", "claude-sonnet-5-5"]);

function read(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function write(store: "local" | "session", key: string, value: string): void {
  try {
    (store === "local" ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    // storage can throw (private mode / quota)
  }
}
function remove(store: "local" | "session", key: string): void {
  try {
    (store === "local" ? localStorage : sessionStorage).removeItem(key);
  } catch {
    // ignore
  }
}

function getKey(): string | null {
  return read("local", KEY) ?? read("session", KEY);
}
function forgetKey(): void {
  remove("local", KEY);
  remove("session", KEY);
}

function loadSettings(): Settings {
  const defaults: Settings = { screenModel: MODELS.screen, verifyTop: 5 };
  const raw = read("local", SETTINGS);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const out = { ...defaults };
    if (typeof parsed.screenModel === "string" && VALID_SCREEN_MODELS.has(parsed.screenModel)) {
      out.screenModel = parsed.screenModel;
    }
    if (typeof parsed.verifyTop === "number" && Number.isFinite(parsed.verifyTop)) {
      out.verifyTop = Math.min(10, Math.max(0, Math.round(parsed.verifyTop)));
    }
    return out;
  } catch {
    return defaults;
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el as T;
}

const costMeter = byId("cost-meter");
const costValue = byId("cost-value");
const settingsBtn = byId<HTMLButtonElement>("settings-btn");

const keyCount = byId("key-count");
const keyForm = byId<HTMLFormElement>("key-form");
const keyInput = byId<HTMLInputElement>("key-input");
const keyRemember = byId<HTMLInputElement>("key-remember");
const keyError = byId("key-error");

const runTitle = byId("run-title");
const runDetail = byId("run-detail");
const runProgressSpan = byId<HTMLSpanElement>("run-progress").querySelector("span");
const runLog = byId("run-log");
const runCancel = byId<HTMLButtonElement>("run-cancel");

const errorTitle = byId("error-title");
const errorDetail = byId("error-detail");
const errorRetry = byId<HTMLButtonElement>("error-retry");
const errorKey = byId<HTMLButtonElement>("error-key");

const demoBanner = byId("demo-banner");
const resultsTitle = byId("results-title");
const resultsStats = byId("results-stats");
const filtersEl = byId("filters");
const dealList = byId<HTMLOListElement>("deal-list");
const resultsEmpty = byId("results-empty");
const skippedEl = byId("skipped");
const skippedSummary = byId("skipped-summary");
const skippedList = byId<HTMLUListElement>("skipped-list");

const settingsDialog = byId<HTMLDialogElement>("settings");
const settingsModel = byId<HTMLSelectElement>("settings-model");
const settingsVerify = byId<HTMLInputElement>("settings-verify");
const settingsKeyStatus = byId("settings-key-status");
const settingsForget = byId<HTMLButtonElement>("settings-forget");

const tpl = byId<HTMLTemplateElement>("tpl-deal");

let listings: Listing[] = [];
let results: DealResult[] = [];
let resultsById = new Map<string, DealResult>();
let costUsd = 0;
let activeFilter = "deals";
let currentAbort: AbortController | null = null;

function show(id: (typeof VIEW_IDS)[number]): void {
  for (const v of VIEW_IDS) {
    byId(v).hidden = v !== id;
  }
}

function appendLog(text: string): void {
  const li = document.createElement("li");
  li.textContent = text;
  runLog.appendChild(li);
}

function showError(title: string, detail: string): void {
  errorTitle.textContent = title;
  errorDetail.textContent = detail;
  show("view-error");
}

function renderResultsView(all: DealResult[]): void {
  results = all;
  resultsById = new Map(all.map((r) => [r.listing.id, r]));
  const skipped = all.filter((r) => r.skipped);
  const dealCount = all.filter(
    (r) => r.verdict === "steal" || r.verdict === "great" || r.verdict === "good",
  ).length;

  resultsTitle.textContent = dealCount === 0 ? "No standout deals" : `${dealCount} deals`;
  resultsStats.textContent = `${all.length} listings · ${skipped.length} skipped · ${formatUsd(costUsd)}`;

  skippedList.replaceChildren();
  renderSkipped(document, skippedList, skipped);
  skippedEl.hidden = skipped.length === 0;
  skippedSummary.textContent = `${skipped.length} skipped (not electronics, accessories, unclear)`;

  applyList();
}

function applyList(): void {
  const filter = FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0]!;
  renderFilters(document, filtersEl, results, activeFilter, onPickFilter);
  dealList.replaceChildren();
  const matching = results.filter(filter.match).sort(compareDeals);
  for (const r of matching) {
    dealList.appendChild(renderDeal(document, tpl, r));
  }
  resultsEmpty.hidden = matching.length !== 0;
}

function onPickFilter(key: string): void {
  activeFilter = key;
  applyList();
}

function rerenderCard(id: string, state?: "pending"): void {
  const r = resultsById.get(id);
  if (!r) return;
  const fresh = renderDeal(document, tpl, r, state);
  const existing = dealList.querySelector(`li[data-id="${CSS.escape(id)}"]`);
  if (existing) existing.replaceWith(fresh);
}

function handleEvent(e: PipelineEvent): void {
  switch (e.type) {
    case "screen-progress": {
      const pct = e.total > 0 ? Math.round((e.done / e.total) * 100) : 0;
      if (runProgressSpan) runProgressSpan.style.setProperty("--p", `${pct}%`);
      runDetail.textContent = `Screened ${e.done} of ${e.total} listings`;
      appendLog(`Screened ${e.done} of ${e.total} listings`);
      break;
    }
    case "cost": {
      costUsd = e.usd;
      costMeter.hidden = false;
      costValue.textContent = formatUsd(e.usd);
      break;
    }
    case "screened": {
      renderResultsView(e.results);
      show("view-results");
      break;
    }
    case "verify-start": {
      rerenderCard(e.id, "pending");
      break;
    }
    case "verified": {
      resultsById.set(e.result.listing.id, e.result);
      const idx = results.findIndex((r) => r.listing.id === e.result.listing.id);
      if (idx >= 0) results[idx] = e.result;
      rerenderCard(e.result.listing.id);
      break;
    }
    case "warning": {
      appendLog(`⚠ ${e.message}`);
      console.warn(e.message);
      break;
    }
  }
}

async function run(): Promise<void> {
  const key = getKey();
  if (!key) {
    showKeyView();
    return;
  }
  if (listings.length === 0) {
    show("view-empty");
    return;
  }

  currentAbort?.abort();
  currentAbort = new AbortController();
  results = [];
  resultsById = new Map();
  costUsd = 0;
  activeFilter = "deals";
  demoBanner.hidden = true;
  costMeter.hidden = true;

  const settings = loadSettings();

  show("view-run");
  runTitle.textContent = "Appraising listings…";
  runDetail.textContent = "Starting";
  runLog.replaceChildren();
  if (runProgressSpan) runProgressSpan.style.setProperty("--p", "0%");

  const client = new Anthropic({
    apiKey: key,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });

  try {
    const { results: finalResults, costUsd: totalCost } = await runPipeline(listings, {
      client,
      screenModel: settings.screenModel,
      verifyTop: settings.verifyTop,
      signal: currentAbort.signal,
      onEvent: handleEvent,
    });
    costUsd = totalCost;
    costMeter.hidden = false;
    costValue.textContent = formatUsd(totalCost);
    renderResultsView(finalResults);
    show("view-results");
    // Reloading the page shows these again instead of paying for a second run.
    write("session", RESULTS, JSON.stringify({ results: finalResults, costUsd: totalCost }));
  } catch (err) {
    handleRunError(err);
  } finally {
    currentAbort = null;
  }
}

function handleRunError(err: unknown): void {
  if (err instanceof AuthenticationError) {
    showError(
      "That API key was rejected",
      "Check the key or create a new one in the Anthropic Console.",
    );
    return;
  }
  if (err instanceof APIUserAbortError) {
    if (results.length > 0) {
      renderResultsView(results);
      show("view-results");
    } else {
      showError("Run cancelled", "Nothing more will be charged. Press Try again to start over.");
    }
    return;
  }
  if (err instanceof APIConnectionError) {
    showError(
      "Couldn't reach api.anthropic.com",
      "Check your connection or an ad blocker, then try again.",
    );
    return;
  }
  if (err instanceof APIError) {
    showError("The Claude API returned an error", err.message);
    return;
  }
  showError("Something went wrong", (err as Error).message);
}

function showKeyView(): void {
  keyCount.textContent = `${listings.length} listings`;
  show("view-key");
}

function updateKeyStatus(): void {
  if (read("local", KEY) !== null) settingsKeyStatus.textContent = "Key saved on this device";
  else if (read("session", KEY) !== null) settingsKeyStatus.textContent = "Key saved for this tab";
  else settingsKeyStatus.textContent = "No key saved.";
}

async function loadDemo(): Promise<void> {
  let data: { results: DealResult[]; costUsd: number };
  try {
    const resp = await fetch("demo.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = (await resp.json()) as { results: DealResult[]; costUsd: number };
  } catch (err) {
    showError("Couldn't load the sample run", (err as Error).message);
    return;
  }
  if (!Array.isArray(data.results) || typeof data.costUsd !== "number") {
    showError("Couldn't load the sample run", "The demo data is malformed.");
    return;
  }
  results = data.results;
  resultsById = new Map(data.results.map((r) => [r.listing.id, r]));
  costUsd = data.costUsd;
  costMeter.hidden = false;
  costValue.textContent = formatUsd(costUsd);
  demoBanner.hidden = false;
  renderResultsView(data.results);
  show("view-results");
}

function showCachedResults(): boolean {
  const raw = read("session", RESULTS);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw) as { results?: unknown; costUsd?: unknown };
    if (!Array.isArray(data.results) || typeof data.costUsd !== "number") return false;
    costUsd = data.costUsd;
    costMeter.hidden = false;
    costValue.textContent = formatUsd(costUsd);
    renderResultsView(data.results as DealResult[]);
    show("view-results");
    return true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (location.hash.length > 1) {
    try {
      const decoded = await decodeListings(location.hash);
      listings = decoded.listings;
      write("session", LISTINGS, JSON.stringify(decoded.listings));
      remove("session", RESULTS);
      history.replaceState(null, "", location.pathname + location.search);
    } catch (err) {
      if (err instanceof HandoffError) {
        showError("This link's listing data is damaged", err.message);
        return;
      }
      throw err;
    }
  } else if (new URLSearchParams(location.search).has("demo")) {
    await loadDemo();
    return;
  } else {
    const stored = read("session", LISTINGS);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) listings = parsed as Listing[];
      } catch {
        listings = [];
      }
    }
    if (listings.length > 0 && showCachedResults()) return;
  }

  if (listings.length === 0) {
    show("view-empty");
    return;
  }

  if (!getKey()) {
    showKeyView();
    return;
  }

  void run();
}

keyForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const raw = keyInput.value.trim();
  if (!raw.startsWith("sk-ant-")) {
    keyError.hidden = false;
    keyError.textContent = "That doesn't look like an Anthropic API key (they start with sk-ant-).";
    return;
  }
  keyError.hidden = true;
  forgetKey();
  write(keyRemember.checked ? "local" : "session", KEY, raw);
  void run();
});

runCancel.addEventListener("click", () => {
  currentAbort?.abort();
});

errorRetry.addEventListener("click", () => {
  void run();
});

errorKey.addEventListener("click", () => {
  forgetKey();
  showKeyView();
});

settingsBtn.addEventListener("click", () => {
  const s = loadSettings();
  settingsModel.value = s.screenModel;
  settingsVerify.value = String(s.verifyTop);
  updateKeyStatus();
  settingsDialog.showModal();
});

settingsDialog.addEventListener("close", () => {
  if (settingsDialog.returnValue === "save") {
    const s = loadSettings();
    const model = VALID_SCREEN_MODELS.has(settingsModel.value) ? settingsModel.value : s.screenModel;
    const verifyRaw = Number.parseInt(settingsVerify.value, 10);
    const verifyTop = Number.isFinite(verifyRaw)
      ? Math.min(10, Math.max(0, verifyRaw))
      : s.verifyTop;
    write("local", SETTINGS, JSON.stringify({ screenModel: model, verifyTop }));
  }
});

settingsForget.addEventListener("click", () => {
  forgetKey();
  updateKeyStatus();
});

void boot();

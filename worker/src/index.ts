import { getEbayPrices } from "./ebay";
import { extractProducts, assessDeals, fetchUsdIlsRate } from "./claude";
import type {
  Env,
  FBListing,
  EbayPriceResult,
  AnalyzeRequest,
  AnalyzeResponse,
  DealResult,
} from "./types";

let requestLog: number[] = [];
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

function checkRateLimit(): boolean {
  const now = Date.now();
  requestLog = requestLog.filter((t) => now - t < RATE_WINDOW);
  if (requestLog.length >= RATE_LIMIT) return false;
  requestLog.push(now);
  return true;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET /loader — serves the loading page (bookmarklet opens this)
    if (request.method === "GET" && url.pathname === "/loader") {
      return loaderPage();
    }

    // eBay Marketplace Account Deletion endpoint
    if (url.pathname === "/ebay-deletion") {
      if (request.method === "GET") {
        // Verification challenge: hash(challenge_code + verificationToken + endpoint)
        const challenge = url.searchParams.get("challenge_code");
        if (!challenge) return json({ error: "missing challenge_code" }, 400);
        const endpoint = url.origin + "/ebay-deletion";
        const data = challenge + env.EBAY_VERIFICATION_TOKEN + endpoint;
        const hash = Array.from(new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))
        )).map(b => b.toString(16).padStart(2, "0")).join("");
        return new Response(JSON.stringify({ challengeResponse: hash }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (request.method === "POST") {
        // Account deletion notification — acknowledge (we don't store eBay user data)
        return new Response(null, { status: 200 });
      }
    }

    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }

    // Detect form vs JSON
    const contentType = request.headers.get("Content-Type") || "";
    const isForm = contentType.includes("application/x-www-form-urlencoded");

    let token = "";
    let listings: FBListing[] = [];

    if (isForm) {
      const formData = await request.formData();
      token = formData.get("token") as string || "";
      const dataStr = formData.get("data") as string || "";
      try {
        const parsed = JSON.parse(dataStr);
        listings = parsed.listings || [];
      } catch {
        return htmlPage("Error", '<p style="color:#f44">Invalid data</p>');
      }
    } else {
      const auth = request.headers.get("Authorization") || "";
      token = auth.replace("Bearer ", "");
      try {
        const body: AnalyzeRequest = await request.json();
        listings = body.listings || [];
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
    }

    if (!timingSafeEqual(token, env.AUTH_TOKEN)) {
      if (isForm) return htmlPage("Error", '<p style="color:#f44">Unauthorized</p>');
      return json({ error: "unauthorized" }, 401);
    }

    if (!checkRateLimit()) {
      if (isForm) return htmlPage("Error", '<p style="color:#f44">Rate limited — try again in a minute</p>');
      return json({ error: "rate limited" }, 429);
    }

    if (!Array.isArray(listings) || listings.length === 0) {
      if (isForm) return htmlPage("Error", '<p style="color:#ff0">No listings provided</p>');
      return json({ error: "no listings provided" }, 400);
    }

    const debug = url.pathname === "/debug";

    try {
      const result = await analyzePipeline(listings, env, debug);
      if (isForm) return htmlPage("Deal Sniper — Results", renderDealsHtml(result));
      return json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isForm) return htmlPage("Error", '<p style="color:#f44">' + escHtml(msg) + "</p>");
      return json({ deals: [], errors: [msg] }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// Non-electronics keywords to filter out before wasting eBay API calls
const NON_ELECTRONICS_PATTERNS = [
  /^שולחן/,        // any desk/table — a gaming PC is "מחשב גיימינג", never "שולחן גיימינג"
  /^כיסא/,         // chair
  /^הדום/,         // footrest
  /^פינת\s*עבודה/, // work station (furniture)
  /^כוננית/,       // shelf unit
  /^מיטה/,         // bed
  /^חדר\s*(שינה|ילדים|מתבגר)/, // bedroom set
  /^ארון/,         // wardrobe/cabinet (non-electronics)
  /^ספה/,          // sofa
  /שולחן\s*מחשב/,  // "computer desk" (furniture)
  /שולחן\s*עבודה/, // "work desk" (furniture)
  /משחק\s*מחשב/,   // computer game (software disc)
  /מחשב\s*השקי/,   // irrigation controller (מחשב השקיה)
  /^ארון\s*השקי/,  // irrigation cabinet
  /^משרד\s/,       // office (real estate)
  /^דירה\s/,       // apartment (real estate)
  /^בית\s/,        // house (real estate) — careful, "בית שמש" is a city but won't match since it's a location not a title
  /^חנות\s/,       // store (commercial real estate)
  /וספה/,          // vespa/scooter
  /קורקינט/,       // electric scooter
  /טרקטורון/,      // ATV
  /מכונת\s*בועות/, // bubble machine
  /תאורת\s*לד/,    // LED strip lighting
  /מטען\s*לרכב/,   // car EV charger
  /טאבון/,         // tabun oven
  /מטילי\s*כסף/,   // silver bars
  /רובי\s*טבעי/,   // ruby gemstone
  /נספרסו/,        // coffee machine
  /פרלמנט/,        // cigarettes brand
  /גלוק|Glock/i,   // firearms
  /^מחיר\s*אחרון/, // "final price" (no product info)
];

// Bare location string like "צפת, Z" — these are bad parses where the scraper
// grabbed the city as the title because the card had no real title line
const LOCATION_ONLY_RE = /^[\u0590-\u05FF\s\-'"]+,\s*[A-Z]{1,3}$/;

function isElectronicsListing(listing: FBListing): boolean {
  // Skip placeholder prices
  if (listing.price <= 1) return false;
  // Skip real estate (price way too high for any electronics)
  if (listing.price > 30000) return false;
  // Skip bad parses where title is just a location
  if (LOCATION_ONLY_RE.test(listing.title.trim())) return false;
  // Skip furniture/non-electronics
  for (const pattern of NON_ELECTRONICS_PATTERNS) {
    if (pattern.test(listing.title)) return false;
  }
  return true;
}

const GOOD_VERDICTS = new Set(["STEAL", "GREAT", "GOOD"]);

interface DebugListingInfo {
  id: string;
  title: string;
  fbPrice: number;
  fbPriceUsd: number;
  phase1Query: string | null;
  phase1Category: string | null;
  phase1Skip: boolean;
  ebayMedian: number | null;
  ebaySampleSize: number | null;
  ebayQuery: string | null;
  claudeVerdict: string | null;
  claudeScore: number | null;
  claudeReasoning: string | null;
  finalStatus: string;
}

interface DebugInfo {
  summary: {
    totalInput: number;
    filteredNotElectronics: number;
    sentToPhase1: number;
    identifiedProducts: number;
    skippedByClaude: number;
    sentToEbay: number;
    ebayHits: number;
    ebayMisses: number;
    sentToPhase3: number;
    finalDeals: number;
    usdIlsRate: number;
  };
  listings: DebugListingInfo[];
}

async function analyzePipeline(listings: FBListing[], env: Env, debug = false): Promise<AnalyzeResponse & { debug?: DebugInfo }> {
  const debugListings: DebugListingInfo[] = [];

  // Pre-filter: drop obvious non-electronics and placeholders
  const filtered: FBListing[] = [];
  let filteredNotElectronics = 0;
  for (const l of listings) {
    if (!isElectronicsListing(l)) {
      filteredNotElectronics++;
      if (debug) {
        debugListings.push({
          id: l.id, title: l.title, fbPrice: l.price, fbPriceUsd: 0,
          phase1Query: null, phase1Category: null, phase1Skip: true,
          ebayMedian: null, ebaySampleSize: null, ebayQuery: null,
          claudeVerdict: null, claudeScore: null, claudeReasoning: null,
          finalStatus: l.price <= 1 ? "FILTERED_PLACEHOLDER" : "FILTERED_NOT_ELECTRONICS",
        });
      }
    } else {
      filtered.push(l);
    }
  }

  const rate = await fetchUsdIlsRate();

  // === PHASE 1: Claude identifies products and generates eBay search queries ===
  const productMap = await extractProducts(filtered, env, rate);

  // Separate identified products from skipped items
  const toSearch: FBListing[] = [];
  const queryMap = new Map<string, string>(); // listing id → eBay search query
  let skippedByClaude = 0;

  for (const l of filtered) {
    const product = productMap.get(l.id);
    const priceUsd = l.currency === "USD" ? l.price : Math.round(l.price / rate);

    if (!product || product.skip || !product.searchQuery) {
      skippedByClaude++;
      if (debug) {
        debugListings.push({
          id: l.id, title: l.title, fbPrice: l.price, fbPriceUsd: priceUsd,
          phase1Query: product?.searchQuery || null, phase1Category: product?.category || null, phase1Skip: true,
          ebayMedian: null, ebaySampleSize: null, ebayQuery: null,
          claudeVerdict: null, claudeScore: null, claudeReasoning: null,
          finalStatus: "SKIPPED_BY_PHASE1",
        });
      }
    } else {
      toSearch.push(l);
      queryMap.set(l.id, product.searchQuery);
    }
  }

  // === PHASE 2: eBay price lookup using Claude's clean queries ===
  // Bookmarklet sends listings in chunks of ~45, so each invocation stays
  // under the 50-subrequest Cloudflare free-plan limit.
  // Budget per chunk: 1 exchange rate + 1 Claude Phase1 + 1 eBay auth + N eBay + 1 Phase3
  const ebayResults = new Map<string, EbayPriceResult | null>();
  let ebayHits = 0;
  let ebayMisses = 0;

  if (toSearch.length > 0) {
    const BATCH = 5;
    for (let i = 0; i < toSearch.length; i += BATCH) {
      const batch = toSearch.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((l) => {
          const query = queryMap.get(l.id);
          return getEbayPrices(l.title, env, query).catch((e) => {
            console.error(`eBay lookup error for "${l.title}":`, e);
            return null;
          });
        })
      );
      for (let j = 0; j < results.length; j++) {
        const l = batch[j];
        const ebay = results[j];
        ebayResults.set(l.id, ebay);
        if (ebay && ebay.sampleSize >= 1) {
          ebayHits++;
        } else {
          ebayMisses++;
        }
      }
    }
  }

  // === PHASE 3: Claude judges deals with real eBay price data ===
  // Send all items to Phase 3 — those with eBay data get precise comparison,
  // those without get Claude's market knowledge as fallback.
  const withEbay = toSearch.filter(l => {
    const ebay = ebayResults.get(l.id);
    return ebay && ebay.sampleSize >= 1;
  });
  // Items without eBay data still go to Phase 3 — Claude estimates their value.
  // These get a lower confidence but could still surface a gem.
  const withoutEbay = toSearch.filter(l => {
    const ebay = ebayResults.get(l.id);
    return !ebay || ebay.sampleSize < 1;
  });
  const allForPhase3 = [...withEbay, ...withoutEbay];

  const assessments = await assessDeals(allForPhase3, ebayResults, env, rate);

  // === Build final results ===
  const deals: DealResult[] = [];

  for (const l of toSearch) {
    const ebay = ebayResults.get(l.id);
    const assessment = assessments.get(l.id);
    // Use floor for FB price (generous toward the buyer) to avoid rounding out borderline deals
    const priceUsd = l.currency === "USD" ? l.price : Math.floor(l.price / rate);
    const product = productMap.get(l.id);
    const hasEbay = ebay && ebay.sampleSize >= 1;

    let finalStatus = "NO_EBAY_DATA";
    if (hasEbay) {
      finalStatus = assessment && GOOD_VERDICTS.has(assessment.verdict) ? "DEAL" : "SKIPPED_BY_PHASE3";
    } else {
      finalStatus = assessment && GOOD_VERDICTS.has(assessment.verdict) ? "DEAL_NO_EBAY" : "SKIPPED_BY_PHASE3";
    }

    if (debug) {
      debugListings.push({
        id: l.id, title: l.title, fbPrice: l.price, fbPriceUsd: priceUsd,
        phase1Query: product?.searchQuery || null, phase1Category: product?.category || null, phase1Skip: false,
        ebayMedian: ebay?.medianPrice ?? null, ebaySampleSize: ebay?.sampleSize ?? null,
        ebayQuery: queryMap.get(l.id) || null,
        claudeVerdict: assessment?.verdict ?? null, claudeScore: assessment?.score ?? null,
        claudeReasoning: assessment?.reasoning ?? null,
        finalStatus,
      });
    }

    if (!assessment || !GOOD_VERDICTS.has(assessment.verdict)) continue;

    // For items with eBay data: sanity-check FB price is genuinely below eBay.
    // Use a 2% tolerance to avoid rounding losses on borderline cases.
    const marketPrice = ebay?.medianPrice ?? 0;
    if (marketPrice > 0 && priceUsd > marketPrice * 1.02) continue; // Not actually a deal

    const savings = marketPrice > 0 ? Math.round(((marketPrice - priceUsd) / marketPrice) * 100) : 0;

    deals.push({
      listing: l,
      ebayMedian: marketPrice,
      ebaySampleSize: ebay?.sampleSize ?? 0,
      savingsPercent: savings,
      claudeVerdict: assessment.verdict,
      claudeScore: assessment.score,
      claudeReasoning: assessment.reasoning,
    });
  }

  // Sort: STEAL > GREAT > GOOD, then by score within tier
  const order: Record<string, number> = { STEAL: 0, GREAT: 1, GOOD: 2 };
  deals.sort((a, b) => {
    const ov = (order[a.claudeVerdict] ?? 3) - (order[b.claudeVerdict] ?? 3);
    if (ov !== 0) return ov;
    return (b.claudeScore ?? 50) - (a.claudeScore ?? 50);
  });

  const result: AnalyzeResponse & { debug?: DebugInfo } = { deals, errors: [] };
  if (debug) {
    result.debug = {
      summary: {
        totalInput: listings.length,
        filteredNotElectronics,
        sentToPhase1: filtered.length,
        identifiedProducts: toSearch.length,
        skippedByClaude,
        sentToEbay: toSearch.length,
        ebayHits,
        ebayMisses,
        sentToPhase3: allForPhase3.length,
        finalDeals: deals.length,
        usdIlsRate: rate,
      },
      listings: debugListings,
    };
  }

  return result;
}


// === Loading page — shows animation, then POSTs data to worker via same-origin fetch ===

function loaderPage(): Response {
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deal Sniper — Analyzing…</title>
<style>
  *{box-sizing:border-box}
  body{background:#1a1a2e;color:#e0e0e0;font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:0}
  #loading{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .spinner{width:52px;height:52px;border:5px solid #333;border-top-color:#4fc3f7;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:24px}
  @keyframes spin{to{transform:rotate(360deg)}}
  #status{color:#aaa;font-size:14px;text-align:center;max-width:300px;line-height:1.6}
  #results{width:100%;max-width:600px;margin:0 auto;padding:16px}
  .deal{margin:10px 0;padding:14px;background:#16213e;border-radius:10px;display:flex;gap:12px}
  .deal img{width:72px;height:72px;object-fit:cover;border-radius:8px;flex-shrink:0}
  .deal-body{flex:1;min-width:0}
  .score{font-size:11px;color:#888;margin-left:6px}
  a{color:#4fc3f7;text-decoration:none}
  .tier-header{font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:20px 0 6px;padding-bottom:4px;border-bottom:1px solid #333}
</style>
</head><body>
<div id="loading">
  <div class="spinner"></div>
  <div id="status">Preparing analysis…</div>
</div>
<div id="results" style="display:none"></div>
<script>
(function(){
  var data = null;
  try {
    var hash = decodeURIComponent(window.location.hash.substring(1));
    data = JSON.parse(hash);
    window.location.hash = "";
  } catch(e) {}
  if (!data || !data.token || !data.listings) {
    document.getElementById("status").textContent = "No data found. Go back to Marketplace and tap Find Deals.";
    return;
  }
  var all = data.listings;
  var count = all.length;
  var CHUNK = 45;
  var chunks = [];
  for (var i = 0; i < all.length; i += CHUNK) {
    chunks.push(all.slice(i, i + CHUNK));
  }
  var done = 0;
  var total = chunks.length;

  function setStatus(msg) { document.getElementById("status").innerHTML = msg; }
  setStatus("Analyzing <b>" + count + "</b> listings in " + total + " parallel batches…<br><span id='prog'>0/" + total + " complete</span><br><span style='color:#555;font-size:12px'>~20-30 seconds</span>");

  var allDeals = [];
  var errors = [];

  Promise.all(chunks.map(function(chunk, idx) {
    return fetch(window.location.origin + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + data.token },
      body: JSON.stringify({ listings: chunk })
    })
    .then(function(r) { if (!r.ok) throw new Error("Chunk " + (idx+1) + ": HTTP " + r.status); return r.json(); })
    .then(function(res) {
      done++;
      var prog = document.getElementById("prog");
      if (prog) prog.textContent = done + "/" + total + " complete";
      if (res.deals) allDeals = allDeals.concat(res.deals);
      if (res.errors) errors = errors.concat(res.errors);
    })
    .catch(function(err) {
      done++;
      errors.push(err.message);
      var prog = document.getElementById("prog");
      if (prog) prog.textContent = done + "/" + total + " complete";
    });
  }))
  .then(function() {
    // Sort merged deals: STEAL > GREAT > GOOD, then by score
    var order = {STEAL:0,GREAT:1,GOOD:2};
    allDeals.sort(function(a,b) {
      var ov = (order[a.claudeVerdict]||3) - (order[b.claudeVerdict]||3);
      if (ov !== 0) return ov;
      return (b.claudeScore||50) - (a.claudeScore||50);
    });

    document.getElementById("loading").style.display = "none";
    var el = document.getElementById("results");
    el.style.display = "block";

    if (allDeals.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:40px"><h2 style="color:#ff0">No deals found</h2><p style="color:#aaa">None of the ' + count + ' listings are significantly below market price.<br>Try different filters or scroll more.</p>' + (errors.length ? '<p style="color:#f44;font-size:12px">' + errors.length + ' chunk(s) had errors</p>' : '') + '</div>';
      return;
    }

    var h = '<h2 style="color:#4fc3f7;margin:16px 0">Deal Sniper</h2><p style="color:#aaa;margin:0 0 12px">Found ' + allDeals.length + ' deal(s) from ' + count + ' listings</p>';
    var colors = {STEAL:"#ff00ff",GREAT:"#00c853",GOOD:"#4fc3f7"};
    var labels = {STEAL:"\\u{1F48E} STEAL",GREAT:"\\u{1F525} GREAT",GOOD:"\\u{2705} GOOD"};
    var curTier = "";
    allDeals.forEach(function(d) {
      var c = colors[d.claudeVerdict] || "#aaa";
      var lbl = labels[d.claudeVerdict] || d.claudeVerdict;
      var price = d.listing.price > 0 ? "\\u20AA" + d.listing.price : "?";
      var ebay = d.ebayMedian > 0 ? (d.ebaySampleSize > 0 ? "$" + d.ebayMedian + " (" + d.ebaySampleSize + " on eBay)" : "~$" + d.ebayMedian + " (est.)") : "";
      var save = d.savingsPercent > 0 ? " \\u2014 Save " + d.savingsPercent + "%" : "";
      var scoreText = d.claudeScore ? " <span class=score>" + d.claudeScore + "/100</span>" : "";

      if (d.claudeVerdict !== curTier) {
        curTier = d.claudeVerdict;
        h += '<div class="tier-header" style="color:' + c + '">' + (labels[curTier] || curTier) + '</div>';
      }

      h += '<div class="deal" style="border-left:5px solid ' + c + '">';
      if (d.listing.imageUrl) h += '<img src="' + d.listing.imageUrl + '">';
      h += '<div class="deal-body">';
      h += '<div style="font-weight:700;font-size:15px;color:' + c + '">' + lbl + save + scoreText + '</div>';
      h += '<div style="font-size:14px;margin-top:4px">' + d.listing.title + '</div>';
      h += '<div style="margin-top:6px">FB: <b style="color:#4fc3f7">' + price + '</b>';
      if (ebay) h += ' \\u00B7 ' + ebay;
      h += '</div>';
      h += '<div style="font-size:13px;color:#bbb;margin-top:6px">' + d.claudeReasoning + '</div>';
      h += '<a href="' + d.listing.url + '" target="_blank" style="font-size:13px;margin-top:8px;display:inline-block">Open listing \\u2192</a>';
      h += '</div></div>';
    });
    el.innerHTML = h;
  });
})();
<\\/script>
</body></html>`;
  return new Response(html.replace("<\\/script>", "<\/script>"), {
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}

// === Static HTML page wrapper ===

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderDealsHtml(result: AnalyzeResponse): string {
  if (result.deals.length === 0) {
    return '<div style="text-align:center;padding:40px;color:#ff0;font-size:18px">No unusual deals found.</div>';
  }
  const colors: Record<string, string> = { STEAL: "#ff00ff", GREAT: "#00c853", GOOD: "#4fc3f7" };
  const labels: Record<string, string> = { STEAL: "💎 STEAL", GREAT: "🔥 GREAT", GOOD: "✅ GOOD" };
  let currentTier = "";
  const cards = result.deals.map((d) => {
    const color = colors[d.claudeVerdict] || "#aaa";
    const label = labels[d.claudeVerdict] || d.claudeVerdict;
    const price = d.listing.price > 0 ? "₪" + d.listing.price : "?";
    const ebay = d.ebayMedian > 0
      ? d.ebaySampleSize > 0
        ? "$" + d.ebayMedian + " (" + d.ebaySampleSize + " on eBay)"
        : "~$" + d.ebayMedian + " (est.)"
      : "";
    const savings = d.savingsPercent > 0 ? " — Save " + d.savingsPercent + "%" : "";
    const scoreText = d.claudeScore ? ` <span style="font-size:11px;color:#888">${d.claudeScore}/100</span>` : "";
    let tierHeader = "";
    if (d.claudeVerdict !== currentTier) {
      currentTier = d.claudeVerdict;
      tierHeader = `<div style="font-size:13px;color:${color};text-transform:uppercase;letter-spacing:1px;margin:20px 0 6px;padding-bottom:4px;border-bottom:1px solid #333">${label}</div>`;
    }
    return `${tierHeader}<div style="margin:10px 0;padding:14px;background:#16213e;border-radius:10px;border-left:5px solid ${color}">
      <div style="display:flex;gap:12px">
        ${d.listing.imageUrl ? `<img src="${escHtml(d.listing.imageUrl)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;flex-shrink:0">` : ""}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:15px;color:${color}">${label}${savings}${scoreText}</div>
          <div style="font-size:14px;margin-top:4px">${escHtml(d.listing.title)}</div>
          <div style="margin-top:6px">FB: <b style="color:#4fc3f7">${price}</b>${ebay ? " · " + ebay : ""}</div>
          <div style="font-size:13px;color:#bbb;margin-top:6px">${escHtml(d.claudeReasoning)}</div>
          <a href="${escHtml(d.listing.url)}" target="_blank" style="color:#4fc3f7;font-size:13px;text-decoration:none;margin-top:8px;display:inline-block">Open listing →</a>
        </div>
      </div>
    </div>`;
  });
  return `<div style="font-size:14px;color:#aaa;margin-bottom:12px">Found ${result.deals.length} deal(s)</div>` + cards.join("");
}

function htmlPage(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>body{background:#1a1a2e;color:#e0e0e0;font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:16px}a{color:#4fc3f7}</style>
</head><body>
<h2 style="color:#4fc3f7;margin:0 0 16px">${escHtml(title)}</h2>
${body}
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

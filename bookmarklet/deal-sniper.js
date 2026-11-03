javascript: void (function () {
  // === CONFIG ===
  var WORKER_URL = "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev";
  var AUTH_TOKEN = "YOUR_AUTH_TOKEN_HERE";

  // Toggle panel off if already open
  if (document.getElementById("__ds")) {
    document.getElementById("__ds").remove();
    return;
  }

  // === Price & listing detection ===
  var priceRe = /(₪|\$|€|£|NIS|ILS|shekel|¥|CHF|kr|zł|R\$|AED|SAR)/i;
  var freeRe = /^(free|חינם|gratis)$/i;
  var ageRe = /^(פורסמו?\s+ממש\s+עכשיו|posted\s+just\s+now|listed\s+just\s+now|עכשיו|just\s+now|today|yesterday|\d+\s*(minute|hour|day|week|month|שע|דק|יו|שבו|חודש)s?\s*ago|לפני\s+.+)$/i;
  var condRe = /^(new|used|like new|open box|refurbished|חדש|משומש|כמו חדש|מחודש)$/i;
  // Bare location like "צפת, Z" — bad parse where city was grabbed as title
  var locOnlyRe = /^[\u0590-\u05FF\s\-'"]+,\s*[A-Z]{1,3}$/;

  function findAnchors() {
    var strategies = [
      'a[href*="/marketplace/item/"]',
      'a[href*="item_id="]',
      'a[role="link"][href*="marketplace"]',
    ];
    var seen = new Set();
    var result = [];
    for (var i = 0; i < strategies.length; i++) {
      var found = document.querySelectorAll(strategies[i]);
      for (var j = 0; j < found.length; j++) {
        var a = found[j];
        var href = a.href || a.getAttribute("href") || "";
        if (!href || !/\/marketplace\/item\/\d+|item_id=\d+/i.test(href)) continue;
        var key = href.split("?")[0].replace(/\/+$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(a);
      }
    }
    return result;
  }

  function cardTextFor(a) {
    var text = (a.innerText || "").trim();
    if (text.split(/\s+/).filter(Boolean).length >= 3) return text;
    var node = a;
    for (var i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      var t = (node.innerText || "").trim();
      if (t.length > text.length && t.split(/\s+/).filter(Boolean).length >= 3) {
        text = t;
        if (text.length > 40) break;
      }
    }
    return text;
  }

  function parseCardText(text) {
    var lines = text.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var price = "", title = "", loc = "", listedAge = "", condition = "";
    var idx = lines.findIndex(function (l) { return priceRe.test(l) || freeRe.test(l); });
    if (idx >= 0) {
      price = lines[idx];
      var nx = lines[idx + 1] || "";
      if (priceRe.test(nx) && nx !== price) {
        title = lines[idx + 2] || "";
        loc = lines[idx + 3] || "";
      } else {
        title = lines[idx + 1] || "";
        loc = lines[idx + 2] || "";
      }
    } else {
      title = lines[0] || "";
      loc = lines[1] || "";
    }
    for (var k = 0; k < lines.length; k++) {
      var ln = lines[k];
      if (!listedAge && ageRe.test(ln)) listedAge = ln;
      if (!condition && condRe.test(ln)) condition = ln;
    }
    if (title && locOnlyRe.test(title.trim())) { loc = title; title = ""; }
    return { price: price, title: title, location: loc, listedAge: listedAge, condition: condition, lines: lines };
  }

  function parsePriceNum(p) {
    if (!p) return 0;
    var n = parseFloat(String(p).replace(/[^\d.]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  // === Collect data-* attrs and aria-label walking up the DOM ===
  function collectDomExtras(a) {
    var dataAttrs = {};
    var ariaLabels = [];
    var node = a;
    for (var d = 0; d < 10 && node && node !== document.body; d++) {
      if (node.attributes) {
        for (var ai = 0; ai < node.attributes.length; ai++) {
          var attr = node.attributes[ai];
          if (attr.name.startsWith("data-") && attr.value) {
            dataAttrs[attr.name] = attr.value.substring(0, 200);
          }
          if (attr.name === "aria-label" && attr.value) {
            ariaLabels.push(attr.value);
          }
        }
      }
      node = node.parentElement;
    }
    return {
      data_attrs: Object.keys(dataAttrs).length ? dataAttrs : null,
      aria_labels: ariaLabels.length ? ariaLabels : null,
    };
  }

  // === Try to find rich FB JSON from embedded script tags for specific listing IDs ===
  function extractPageJson(idSet) {
    var idList = Array.from(idSet);
    if (!idList.length) return null;

    // Try window.__NEXT_DATA__ first
    var nextData = null;
    try {
      if (window.__NEXT_DATA__) {
        var nd = JSON.stringify(window.__NEXT_DATA__);
        var hits = idList.filter(function(id) { return nd.indexOf(id) !== -1; });
        if (hits.length) nextData = { source: "__NEXT_DATA__", found_ids: hits, size_bytes: nd.length };
      }
    } catch(e) {}

    // Scan inline <script> tags for embedded JSON blobs that reference our IDs
    var scriptHits = [];
    var scripts = document.querySelectorAll("script:not([src])");
    for (var i = 0; i < scripts.length; i++) {
      var content = scripts[i].textContent || "";
      if (content.length < 50) continue;
      var foundIds = idList.filter(function(id) { return content.indexOf(id) !== -1; });
      if (!foundIds.length) continue;

      // Extract up to 3 snippets per script (around each found ID)
      var snippets = [];
      foundIds.slice(0, 3).forEach(function(id) {
        var pos = content.indexOf(id);
        var start = Math.max(0, pos - 300);
        var end = Math.min(content.length, pos + 600);
        snippets.push({ id: id, context: content.substring(start, end) });
      });

      // Try to detect what type of script this is
      var scriptType = "unknown";
      if (content.indexOf("ScheduledServerJS") !== -1) scriptType = "ScheduledServerJS";
      else if (content.indexOf("__bbox") !== -1) scriptType = "bbox";
      else if (content.indexOf("RelayPrefetchedStreamCache") !== -1) scriptType = "RelayPrefetchedStreamCache";
      else if (content.indexOf("bigPipe") !== -1 || content.indexOf("BigPipe") !== -1) scriptType = "BigPipe";
      else if (content.startsWith("{") || content.startsWith("[")) scriptType = "json_blob";

      scriptHits.push({
        script_index: i,
        script_type: scriptType,
        total_size_bytes: content.length,
        found_ids: foundIds,
        snippets: snippets,
      });
    }

    return {
      next_data: nextData,
      script_hits: scriptHits.length ? scriptHits : null,
      scripts_scanned: scripts.length,
      note: scriptHits.length
        ? "Found " + scriptHits.length + " script(s) containing listing IDs. Check snippets for hidden fields."
        : "No script tags found containing listing IDs — FB may be loading via XHR/fetch only.",
    };
  }

  // === Rich debug scrape for a single anchor ===
  function scrapeDebugAnchor(a) {
    var url = (a.href || "").split("?")[0].replace(/\/+$/, "");
    var m = url.match(/\/marketplace\/item\/(\d+)/) || url.match(/item_id=(\d+)/i);
    var id = m ? m[1] : "";
    if (!id) return null;

    var innerText = cardTextFor(a);
    var parsed = parseCardText(innerText);
    var price = parsePriceNum(parsed.price);

    var img = a.querySelector("img") || (a.parentElement && a.parentElement.querySelector("img"));
    var imgAlt = img ? (img.getAttribute("alt") || img.getAttribute("aria-label") || "") : "";
    var imgSrc = img ? img.src : "";

    // textContent differs from innerText when CSS hides elements (display:none, visibility:hidden)
    // If they differ, the hidden text is worth seeing
    var rawTextContent = (a.textContent || "").trim();
    var tcLines = rawTextContent.split(/[\n\r]+/).map(function(s) { return s.trim(); }).filter(Boolean);
    var tcDiffersFromInnerText = tcLines.join("|") !== parsed.lines.join("|");

    var cur = "ILS";
    if (/\$/.test(parsed.price)) cur = "USD";
    else if (/€/.test(parsed.price)) cur = "EUR";
    else if (/£/.test(parsed.price)) cur = "GBP";

    var extras = collectDomExtras(a);

    return {
      id: id,
      url: url.indexOf("http") === 0 ? url : "https://www.facebook.com" + url,
      // What our parser extracted
      parsed_title: parsed.title,
      parsed_price_raw: parsed.price,
      parsed_price_num: price,
      parsed_currency: cur,
      parsed_location: parsed.location,
      parsed_condition: parsed.condition || null,
      parsed_listedAge: parsed.listedAge || null,
      // The raw lines innerText produced — the ground truth for parsing
      card_lines: parsed.lines,
      // Hidden text that innerText skips (CSS display:none etc.)
      hidden_text_lines: tcDiffersFromInnerText ? tcLines : null,
      // Image metadata — sometimes alt text has rich info
      img_alt: imgAlt || null,
      img_src: imgSrc || null,
      // Aria labels and data-* attrs from the card hierarchy
      aria_labels: extras.aria_labels,
      data_attrs: extras.data_attrs,
      // Drop reason
      dropped: !parsed.title ? "no_title" : (price <= 0 ? "no_price" : null),
    };
  }

  // === State ===
  var collected = new Map();       // for normal Find Deals use
  var debugCollected = new Map();  // for debug mode — richer data per item
  var scrolling = false;
  var debugScrollMode = false;     // true when scrolling for debug (vs normal)
  var cancelled = false;

  function mergeBatch(batch) {
    var added = 0;
    batch.forEach(function (l) {
      if (!l.id || collected.has(l.id)) return;
      collected.set(l.id, l);
      added++;
    });
    return added;
  }

  function mergeDebugBatch() {
    var anchors = findAnchors();
    var added = 0;
    anchors.forEach(function(a) {
      var item = scrapeDebugAnchor(a);
      if (!item) return;
      if (debugCollected.has(item.id)) return;
      debugCollected.set(item.id, item);
      added++;
    });
    return added;
  }

  function buildDebugOutput() {
    var items = Array.from(debugCollected.values());
    var idSet = new Set(items.map(function(i) { return i.id; }));
    var pageJson = extractPageJson(idSet);
    return {
      meta: {
        scrapedAt: new Date().toISOString(),
        pageUrl: window.location.href,
        pageTitle: document.title,
        totalUniqueIds: items.length,
        withTitle: items.filter(function(i) { return i.parsed_title; }).length,
        withPrice: items.filter(function(i) { return i.parsed_price_num > 0; }).length,
        withListedAge: items.filter(function(i) { return i.parsed_listedAge; }).length,
        withCondition: items.filter(function(i) { return i.parsed_condition; }).length,
        withImgAlt: items.filter(function(i) { return i.img_alt; }).length,
        withAriaLabels: items.filter(function(i) { return i.aria_labels; }).length,
        withHiddenText: items.filter(function(i) { return i.hidden_text_lines; }).length,
        dropped: items.filter(function(i) { return i.dropped; }).length,
      },
      page_json: pageJson,
      items: items,
    };
  }

  function openDebugModal(data) {
    var json = JSON.stringify(data, null, 2);
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483648;" +
      "background:rgba(0,0,0,0.88);display:flex;flex-direction:column;padding:16px;box-sizing:border-box";

    var m = data.meta;
    var summary = m.totalUniqueIds + " items | " + m.withTitle + " with title | " +
      m.withListedAge + " with age | " + m.withImgAlt + " with img alt | " +
      m.withAriaLabels + " with aria | " + m.dropped + " dropped";
    if (data.page_json && data.page_json.script_hits) {
      summary += " | " + data.page_json.script_hits.length + " FB script(s) found";
    }

    var header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-shrink:0;gap:8px";
    header.innerHTML =
      '<div style="color:#7c4dff;font:700 13px system-ui;flex:1">📋 Debug JSON<br><span style="color:#888;font-weight:400;font-size:11px">' + summary + '</span></div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0">' +
      '<button id="__ds_copy" style="background:#7c4dff;color:#fff;border:none;border-radius:6px;padding:7px 12px;font:600 12px system-ui;cursor:pointer">Copy</button>' +
      '<button id="__ds_close" style="background:#333;color:#fff;border:none;border-radius:6px;padding:7px 12px;font:600 12px system-ui;cursor:pointer">Close</button>' +
      '</div>';

    var ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.value = json;
    ta.style.cssText =
      "flex:1;width:100%;background:#0d0d1a;color:#a8ff78;font:11px/1.4 monospace;" +
      "border:1px solid #333;border-radius:8px;padding:12px;resize:none;box-sizing:border-box;overflow:auto";

    overlay.appendChild(header);
    overlay.appendChild(ta);
    document.body.appendChild(overlay);
    ta.focus(); ta.select();

    header.querySelector("#__ds_copy").onclick = function () {
      var btn = header.querySelector("#__ds_copy");
      navigator.clipboard.writeText(json).then(function() {
        btn.textContent = "Copied!";
        setTimeout(function() { btn.textContent = "Copy"; }, 2000);
      }).catch(function() {
        document.execCommand("copy");
        btn.textContent = "Copied!";
        setTimeout(function() { btn.textContent = "Copy"; }, 2000);
      });
    };
    header.querySelector("#__ds_close").onclick = function () { overlay.remove(); };
  }

  // === Normal scrape (for Find Deals) ===
  function scrapeVisible() {
    var anchors = findAnchors();
    var out = [];
    var seen = new Set();
    anchors.forEach(function (a) {
      var url = (a.href || "").split("?")[0].replace(/\/+$/, "");
      var m = url.match(/\/marketplace\/item\/(\d+)/) || url.match(/item_id=(\d+)/i);
      var id = m ? m[1] : "";
      if (!id || seen.has(id)) return;
      seen.add(id);
      var text = cardTextFor(a);
      var parsed = parseCardText(text);
      var price = parsePriceNum(parsed.price);
      var img = a.querySelector("img") || (a.parentElement && a.parentElement.querySelector("img"));
      if (parsed.title) {
        var cur = "ILS";
        var raw = parsed.price || "";
        if (/\$/.test(raw)) cur = "USD";
        else if (/€/.test(raw)) cur = "EUR";
        else if (/£/.test(raw)) cur = "GBP";
        var item = {
          id: id,
          title: parsed.title,
          price: price,
          currency: cur,
          location: parsed.location,
          url: url.indexOf("http") === 0 ? url : "https://www.facebook.com" + url,
          imageUrl: img ? img.src : "",
        };
        if (parsed.condition) item.condition = parsed.condition;
        if (parsed.listedAge) item.listedAge = parsed.listedAge;
        if (parsed.lines && parsed.lines.join(" ") !== parsed.title) item.rawText = parsed.lines.join("\n");
        out.push(item);
      }
    });
    return out;
  }

  // === Build panel UI ===
  var panel = document.createElement("div");
  panel.id = "__ds";
  panel.style.cssText =
    "position:fixed;top:0;right:0;width:370px;height:100vh;" +
    "background:#1a1a2e;color:#e0e0e0;z-index:2147483647;overflow-y:auto;" +
    "font:13px/1.4 -apple-system,system-ui,sans-serif;" +
    "box-shadow:-3px 0 15px rgba(0,0,0,.6);padding:12px;box-sizing:border-box;" +
    "transform:translateZ(0);touch-action:manipulation;-webkit-overflow-scrolling:touch";

  var btnBase =
    "padding:10px 8px;border:none;border-radius:8px;font-size:12px;" +
    "font-weight:600;cursor:pointer;flex:1;min-width:0";

  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
    '<b style="font-size:16px;color:#4fc3f7">Deal Sniper</b>' +
    '<button id="__ds_x" style="border:none;background:transparent;color:#888;font-size:22px;cursor:pointer;padding:0 4px">✕</button>' +
    "</div>" +
    // Row 1: normal scroll + grab
    '<div style="display:flex;gap:5px;margin-bottom:6px">' +
    '<button id="__ds_scroll" style="' + btnBase + ';flex:2;background:#1877f2;color:#fff">Scroll & Scrape</button>' +
    '<button id="__ds_grab" style="' + btnBase + ';background:#555;color:#fff">Grab visible</button>' +
    "</div>" +
    // Row 2: find deals + reset
    '<div style="display:flex;gap:5px;margin-bottom:6px">' +
    '<button id="__ds_find" style="' + btnBase + ';flex:2;background:#00c853;color:#fff" disabled>Find Deals</button>' +
    '<button id="__ds_reset" style="' + btnBase + ';background:transparent;color:#f44;border:1px solid #f44">Reset</button>' +
    "</div>" +
    // Row 3: debug buttons
    '<div style="display:flex;gap:5px;margin-bottom:10px">' +
    '<button id="__ds_debug_snap" style="' + btnBase + ';background:#7c4dff;color:#fff">📋 Debug Snap</button>' +
    '<button id="__ds_debug_scroll" style="' + btnBase + ';background:#5e35b1;color:#fff">🔄 Scroll+Debug</button>' +
    "</div>" +
    '<div id="__ds_st" style="font-size:11px;color:#aaa;margin-bottom:8px">Ready. Scroll & Scrape, then Find Deals.</div>' +
    '<div id="__ds_results"></div>';

  document.body.appendChild(panel);

  var st = panel.querySelector("#__ds_st");
  var resultsDiv = panel.querySelector("#__ds_results");
  var scrollBtn = panel.querySelector("#__ds_scroll");
  var grabBtn = panel.querySelector("#__ds_grab");
  var findBtn = panel.querySelector("#__ds_find");
  var resetBtn = panel.querySelector("#__ds_reset");
  var debugSnapBtn = panel.querySelector("#__ds_debug_snap");
  var debugScrollBtn = panel.querySelector("#__ds_debug_scroll");

  panel.querySelector("#__ds_x").onclick = function () { cancelled = true; panel.remove(); };

  function updateStatus(msg) { st.textContent = msg; }
  function updateFindBtn() { findBtn.disabled = collected.size === 0; }

  function showPreview() {
    var items = Array.from(collected.values());
    resultsDiv.innerHTML = items.map(function (l) {
      return '<div style="padding:4px 0;border-bottom:1px solid #333;font-size:12px">' +
        "<span style='color:#4fc3f7'>" + (l.price > 0 ? "₪" + l.price : "?") + "</span> — " +
        l.title.substring(0, 55) + "</div>";
    }).join("");
  }

  function setScrollingUI(active, debugMode) {
    scrolling = active;
    var label = active ? "Stop" : "Scroll & Scrape";
    var color = active ? "#f44" : "#1877f2";
    scrollBtn.textContent = label; scrollBtn.style.background = color;
    grabBtn.disabled = active;
    findBtn.disabled = active || collected.size === 0;
    resetBtn.disabled = active;
    debugSnapBtn.disabled = active;
    debugScrollBtn.disabled = active;
    if (debugMode) {
      debugScrollBtn.textContent = active ? "Stop" : "🔄 Scroll+Debug";
      debugScrollBtn.style.background = active ? "#f44" : "#5e35b1";
    }
  }

  // === Core scroll loop — shared by normal and debug modes ===
  function startScroll(onStep, onEnd) {
    scrolling = true;
    cancelled = false;
    var round = 0, lastH = 0, stable = 0, MAX = 80;

    onStep(0);

    function step() {
      if (cancelled || round >= MAX) { onEnd(); return; }
      window.scrollTo(0, document.body.scrollHeight);
      setTimeout(function () {
        var added = onStep(round + 1);
        var h = document.body.scrollHeight;
        if (h === lastH && added === 0) {
          stable++;
          if (stable >= 4) { onEnd(); return; }
        } else { stable = 0; lastH = h; }
        round++;
        step();
      }, 1200);
    }
    step();
  }

  // === Scroll & Scrape (normal mode) ===
  scrollBtn.onclick = function () {
    if (scrolling) { cancelled = true; updateStatus("Stopping…"); return; }
    debugScrollMode = false;
    setScrollingUI(true, false);
    mergeBatch(scrapeVisible()); showPreview();
    startScroll(
      function(round) {
        var added = mergeBatch(scrapeVisible());
        showPreview();
        updateStatus("Scrolling " + round + "/" + 80 + " — " + collected.size + " listings");
        return added;
      },
      function() {
        setScrollingUI(false, false);
        window.scrollTo(0, 0);
        updateFindBtn();
        updateStatus(collected.size + " listings. Tap Find Deals or scroll more.");
      }
    );
  };

  // === Scroll + Debug (captures rich DOM data on every scroll step) ===
  debugScrollBtn.onclick = function () {
    if (scrolling) { cancelled = true; updateStatus("Stopping…"); return; }
    debugScrollMode = true;
    debugCollected.clear();
    setScrollingUI(true, true);
    mergeDebugBatch();
    mergeBatch(scrapeVisible()); showPreview();
    startScroll(
      function(round) {
        var addedDebug = mergeDebugBatch();
        var added = mergeBatch(scrapeVisible());
        showPreview();
        updateStatus("🔄 Debug scroll " + round + "/80 — " + debugCollected.size + " captured");
        return Math.max(added, addedDebug);
      },
      function() {
        setScrollingUI(false, true);
        window.scrollTo(0, 0);
        updateFindBtn();
        updateStatus("Done. " + debugCollected.size + " items captured. Opening debug…");
        setTimeout(function() {
          var data = buildDebugOutput();
          openDebugModal(data);
          updateStatus("Debug JSON ready. " + debugCollected.size + " items, " + data.items.filter(function(i){return i.dropped;}).length + " dropped.");
        }, 400);
      }
    );
  };

  // === Debug Snap — instant snapshot of current view only ===
  debugSnapBtn.onclick = function () {
    if (scrolling) return;
    debugCollected.clear();
    mergeDebugBatch();
    var data = buildDebugOutput();
    openDebugModal(data);
    updateStatus("Snap: " + data.meta.totalUniqueIds + " items in view.");
  };

  // === Grab visible (one-shot, normal mode) ===
  grabBtn.onclick = function () {
    var added = mergeBatch(scrapeVisible());
    showPreview(); updateFindBtn();
    updateStatus("+" + added + " new. Total: " + collected.size + " listings.");
  };

  // === Reset ===
  resetBtn.onclick = function () {
    if (scrolling) return;
    collected.clear(); debugCollected.clear();
    resultsDiv.innerHTML = "";
    findBtn.disabled = true;
    updateStatus("Cleared. Ready.");
  };

  // === Find Deals ===
  findBtn.onclick = function () {
    if (scrolling) return;
    var listings = Array.from(collected.values());
    var payload = JSON.stringify({ token: AUTH_TOKEN, listings: listings });
    var encoded = encodeURIComponent(payload);
    if (encoded.length > 1500000) {
      updateStatus("Too many listings (" + listings.length + "). Try with fewer.");
      return;
    }
    window.open(WORKER_URL + "/loader#" + encoded, "_blank");
    updateStatus(collected.size + " listings sent. Check the new tab.");
  };

})();

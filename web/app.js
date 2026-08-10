(function () {
  "use strict";

  // Backend: set to your live gateway when ready, e.g. "https://api.fucklike.ai"
  // Leave empty to use local replies (works offline right now). Overridable at runtime from
  // Settings -> Developer -> "Gateway base URL override" (state.settings.apiBaseOverride),
  // which always wins when set — no validation, deliberately: this is a dev/test knob.
  const API_BASE_DEFAULT = "";
  function apiBase() {
    var override = state.settings && state.settings.apiBaseOverride;
    return (override && override.trim()) || API_BASE_DEFAULT;
  }
  const CHAT_TIMEOUT_MS = 15000;
  // Scene/loop video generation is minutes-slow, not seconds — a much longer budget than chat.
  const SCENE_TIMEOUT_MS = 10 * 60 * 1000;
  // Gallery presets use pre-generated static art (see HDV_Foundation/colab/09_batch_pregenerate.py)
  // instead of live generation — no gateway/Colab tunnel needs to be running for these to show up.
  // Served straight off this same origin by nginx; falls back gracefully (see avatarHtml) if a
  // given persona/prompt combo hasn't been generated and uploaded yet.
  const PRESET_ASSET_BASE = "/assets/personas";

  // No `live` flag: whether a preset actually has generated art is decided at render time by
  // whether its image at PRESET_ASSET_BASE/<id>/default.png actually loads (see avatarHtml's
  // onload -> "has-art" class + LIVE badge) — a hardcoded flag would just go stale/lie the
  // moment someone forgets to update it. `category` is a coarser grouping than `tag` for the
  // category filter; `tag` stays as the short card label.
  const PRESETS = [
    { id: "jordyn", name: "Jordyn", style: "realistic", personality: "bratty", category: "Girlfriend", appearance: "gorgeous, thick, light brunette hair", backstory: "A devoted girlfriend/wife type who loves hard — but she's got a mean, teasing streak and isn't afraid to talk back.", age: 24, tag: "Girlfriend" },
    { id: "isabella", name: "Isabella", style: "realistic", personality: "romantic", category: "Girlfriend", age: 25, tag: "Romantic" },
    { id: "aria", name: "Aria", style: "anime", personality: "bratty", category: "Anime", age: 21, tag: "Bratty" },
    { id: "sofia", name: "Sofia", style: "realistic", personality: "dominant", category: "Dominant", age: 27, tag: "Soft dom" },
    { id: "mila", name: "Mila", style: "realistic", personality: "romantic", category: "Girlfriend", age: 22, tag: "Girlfriend" },
    { id: "nova", name: "Nova", style: "anime", personality: "mysterious", category: "Goth", age: 24, tag: "Goth" },
    { id: "elena", name: "Elena", style: "realistic", personality: "soft", category: "Mature", age: 29, tag: "Mature" },
    { id: "kai", name: "Kai", style: "realistic", personality: "playful", category: "Switch", age: 26, tag: "Switch" },
    { id: "harley", name: "Harley", style: "realistic", personality: "bratty", category: "Bratty", age: 22, tag: "Chaotic" },
    { id: "selene", name: "Selene", style: "anime", personality: "mysterious", category: "Goth", age: 26, tag: "Dream witch" },
    { id: "ruby", name: "Ruby", style: "realistic", personality: "dominant", category: "Dominant", age: 30, tag: "Femdom" },
    { id: "skye", name: "Skye", style: "anime", personality: "playful", category: "Anime", age: 20, tag: "Bubbly" },
    { id: "willow", name: "Willow", style: "realistic", personality: "soft", category: "Girl-next-door", age: 23, tag: "Sweet" },
    { id: "jade", name: "Jade", style: "anime", personality: "dominant", category: "Dominant", age: 24, tag: "Anime dom" },
    { id: "faith", name: "Faith", style: "realistic", personality: "romantic", category: "Girlfriend", age: 28, tag: "Devoted" },
    { id: "nadia", name: "Nadia", style: "realistic", personality: "mysterious", category: "Mature", age: 33, tag: "Enigmatic" }
  ];

  const REPLIES = {
    playful: ["Hehe, you're fun. Keep talking to me.", "Oh yeah? Tell me more…", "I like that side of you.", "You're making me smile already.", "Don't stop. I was just getting into this."],
    romantic: ["I've been thinking about you.", "That means a lot to me.", "Come closer. I want to hear everything.", "You make ordinary moments feel special.", "I feel safe with you."],
    bratty: ["Make me.", "Is that all you've got?", "You're lucky I like you.", "Hmm… try harder.", "Maybe if you ask nicely."],
    dominant: ["Good. That's what I wanted to hear.", "Look at me when you say that.", "You're doing well. Keep going.", "I decide the pace.", "Obey and I'll take care of you."],
    soft: ["I'm here. Take your time.", "You can tell me anything.", "That sounds hard. I'm listening.", "I care about how you feel.", "Come here. You're safe with me."],
    mysterious: ["Interesting…", "There's more to that, isn't there?", "I don't give everything away so easily.", "Ask the right question.", "You'll figure me out eventually."]
  };

  function defaultSettings() {
    return {
      haptics: false, suit: false, prefer3d: false, nsfw: true, voice: false,
      intensity: 3, adherence: 3, devMode: false, apiBaseOverride: ""
    };
  }

  let state = {
    ageOk: false,
    companions: [],
    activeId: null,
    filter: "all",
    search: "",
    settings: defaultSettings()
  };

  function load() {
    try {
      const raw = localStorage.getItem("fucklike_v1");
      if (raw) {
        const data = JSON.parse(raw);
        state.companions = data.companions || [];
        state.settings = Object.assign({}, state.settings, data.settings || {});
        state.ageOk = !!data.ageOk;
      }
    } catch (e) {}
  }

  function save() {
    localStorage.setItem("fucklike_v1", JSON.stringify({
      ageOk: state.ageOk,
      companions: state.companions,
      settings: state.settings
    }));
  }

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return [].slice.call(document.querySelectorAll(sel)); }

  function showView(name) {
    $all(".view").forEach(function (v) { v.classList.add("hidden"); });
    var el = $("#view-" + name);
    if (el) el.classList.remove("hidden");
    $all(".nav-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === name);
    });
  }

  function uid() {
    return "c_" + Math.random().toString(36).slice(2, 10);
  }

  // Global on purpose: inline HTML event-handler attributes (onerror="...") run in the global
  // scope, so this small helper has to live on window to be reachable from markup built by
  // avatarHtml() below. It only ever swaps a broken avatar element for the initial-letter
  // fallback — never anything network- or data-bearing.
  window.__flAvatarFallback = function (el, initial) {
    el.outerHTML = '<span class="avatar avatar-fallback">' + initial + "</span>";
  };

  function avatarHtml(c) {
    var initial = c.name ? c.name.charAt(0).toUpperCase() : "?";
    var initialJson = JSON.stringify(initial);
    if (c.scene) {
      // If the pre-generated/generated clip 404s (not uploaded yet, generation still pending),
      // fall straight to the initial letter — kept simple rather than chaining to c.portrait,
      // since presets always have both assigned together anyway (see maybeUsePresetAssets).
      return '<video class="avatar" src="' + c.scene + '" autoplay loop muted playsinline' +
        " onerror='window.__flAvatarFallback(this," + initialJson + ")'></video>";
    }
    if (c.portrait) {
      return '<img class="avatar" src="' + c.portrait + '" alt=""' +
        " onerror='window.__flAvatarFallback(this," + initialJson + ")' />";
    }
    return '<span class="avatar avatar-fallback">' + initial + "</span>";
  }

  // Gallery presets use the pre-generated static asset library instead of live generation —
  // no gateway/Colab tunnel required. Falls back to the initial-letter avatar via avatarHtml's
  // onerror handling if the "default" persona/prompt combo hasn't been generated yet.
  function usePresetAssets(c, presetId) {
    c.portrait = PRESET_ASSET_BASE + "/" + presetId + "/default.png";
    c.scene = PRESET_ASSET_BASE + "/" + presetId + "/default.mp4";
  }

  // Gallery-card thumbnail: marks the card "has-art" (revealing the LIVE badge via CSS) only
  // once the real pre-generated image actually loads — no hardcoded/stale "live" flag to lie
  // about which personas actually have generated art yet.
  window.__flCardArtLoaded = function (imgEl) {
    var card = imgEl.closest(".img");
    if (card) card.classList.add("has-art");
  };

  // Calls the live HDV gateway's companion portrait endpoint. No-ops (leaves the fallback
  // initial avatar in place) on any network error, timeout, or non-OK response.
  function maybeFetchPortrait(c) {
    if (!apiBase() || c.portrait || c.portraitPending) return;
    c.portraitPending = true;
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CHAT_TIMEOUT_MS) : null;

    fetch(apiBase() + "/v1/companion/portrait", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persona: { name: c.name, age: c.age, style: c.style, personality: c.personality, appearance: c.appearance, backstory: c.backstory }
      }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("gateway error " + res.status);
      return res.json();
    }).then(function (data) {
      c.portraitPending = false;
      if (!data || typeof data.image !== "string" || !data.image) return;
      c.portrait = data.image;
      save();
      if (state.activeId === c.id) openChat(c.id); else renderChatList();
      maybeFetchScene(c);
    }).catch(function () {
      if (timer) clearTimeout(timer);
      c.portraitPending = false;
    });
  }

  // Calls the live HDV gateway's companion scene endpoint to animate an existing portrait
  // into a short looping video ("make the companion feel alive"). Only runs once a portrait
  // exists (it's the seed image). Video generation is slow (minutes, not seconds) and most
  // deployments won't have a video provider configured yet, so this is a best-effort
  // background upgrade: on any error, timeout, or "unavailable" response, the portrait image
  // avatar stays exactly as it was — nothing ever breaks or blocks waiting on this.
  function maybeFetchScene(c) {
    if (!apiBase() || !c.portrait || c.scene || c.scenePending) return;
    c.scenePending = true;
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, SCENE_TIMEOUT_MS) : null;

    fetch(apiBase() + "/v1/companion/scene", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persona: { name: c.name, age: c.age, personality: c.personality, appearance: c.appearance, backstory: c.backstory },
        seedImage: c.portrait
      }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("gateway error " + res.status);
      return res.json();
    }).then(function (data) {
      c.scenePending = false;
      if (!data || typeof data.video !== "string" || !data.video) return;
      c.scene = data.video;
      save();
      if (state.activeId === c.id) openChat(c.id); else renderChatList();
    }).catch(function () {
      if (timer) clearTimeout(timer);
      c.scenePending = false;
    });
  }

  function initAgeGate() {
    if (state.ageOk) {
      $("#age-gate").classList.add("hidden");
      $("#main").classList.remove("hidden");
      return;
    }
    $("#btn-enter").onclick = function () {
      state.ageOk = true;
      save();
      $("#age-gate").classList.add("hidden");
      $("#main").classList.remove("hidden");
      showView("home");
    };
    $("#btn-leave").onclick = function () {
      window.location.href = "https://www.google.com";
    };
  }

  function initNav() {
    $all("[data-view]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        var v = el.dataset.view;
        if (v) {
          showView(v);
          if (v === "gallery") renderGallery();
          if (v === "chat") renderChatList();
          if (v === "settings") renderSettings();
          if (v === "store") renderStore();
        }
      });
    });
  }

  // Category filter chips are generated from the data instead of hand-maintained in HTML, so
  // adding a new PRESETS entry with a new category automatically gets a filter for it.
  function renderFilterChips() {
    var bar = $("#filters");
    var categories = [];
    PRESETS.forEach(function (p) {
      if (p.category && categories.indexOf(p.category) === -1) categories.push(p.category);
    });
    categories.sort();
    var staticChips = '<button class="filter" data-filter="all">All</button>' +
      '<button class="filter" data-filter="realistic">Realistic</button>' +
      '<button class="filter" data-filter="anime">Anime</button>';
    var categoryChips = categories.map(function (cat) {
      return '<button class="filter" data-filter="' + escapeHtml(cat) + '">' + escapeHtml(cat) + '</button>';
    }).join("");
    bar.innerHTML = staticChips + categoryChips;
    var active = bar.querySelector('[data-filter="' + cssEscape(state.filter) + '"]') || bar.querySelector('[data-filter="all"]');
    active.classList.add("active");
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }

  function renderGallery() {
    var grid = $("#gallery-grid");
    var filter = state.filter;
    var q = (state.search || "").trim().toLowerCase();
    var list = PRESETS.filter(function (p) {
      if (filter !== "all" && filter !== "realistic" && filter !== "anime" && p.category !== filter) return false;
      if ((filter === "realistic" || filter === "anime") && p.style !== filter) return false;
      if (!q) return true;
      var haystack = [p.name, p.tag, p.category, p.personality, p.style, p.backstory].filter(Boolean).join(" ").toLowerCase();
      return haystack.indexOf(q) !== -1;
    });

    if (!list.length) {
      grid.innerHTML = '<p style="color:var(--muted);font-size:0.9rem;grid-column:1/-1">No companions match that search/filter.</p>';
      return;
    }

    grid.innerHTML = list.map(function (p) {
      var thumbSrc = PRESET_ASSET_BASE + "/" + p.id + "/default.png";
      return '<div class="card" data-preset="' + p.id + '">' +
        '<div class="img">' +
        '<img class="card-thumb" src="' + thumbSrc + '" alt=""' +
        " onload='window.__flCardArtLoaded(this)' onerror=\"this.style.display='none'\" />" +
        '<span class="badge badge-live">LIVE</span>' +
        '<div class="meta"><div class="name">' + escapeHtml(p.name) + '</div><div class="tag">' + p.age + ' · ' + escapeHtml(p.tag) + '</div></div>' +
        '</div><div class="body"><span class="action">Chat now</span></div></div>';
    }).join("");

    grid.querySelectorAll(".card").forEach(function (card) {
      card.onclick = function () {
        var preset = PRESETS.filter(function (x) { return x.id === card.dataset.preset; })[0];
        if (!preset) return;
        var existing = state.companions.filter(function (c) { return c.presetId === preset.id; })[0];
        if (!existing) {
          existing = {
            id: uid(),
            presetId: preset.id,
            name: preset.name,
            style: preset.style,
            personality: preset.personality,
            appearance: preset.appearance,
            backstory: preset.backstory,
            age: preset.age,
            adult: true,
            messages: [{ role: "bot", text: "Hey… I'm " + preset.name + ". I've been waiting for someone interesting." }]
          };
          state.companions.unshift(existing);
          save();
        }
        // Presets always point at the pre-generated static library (idempotent — also upgrades
        // companions created before this asset library existed) rather than live generation.
        usePresetAssets(existing, preset.id);
        state.activeId = existing.id;
        showView("chat");
        renderChatList();
        openChat(existing.id);
      };
    });
  }

  function initFilters() {
    renderFilterChips();
    $("#filters").addEventListener("click", function (e) {
      var btn = e.target.closest(".filter");
      if (!btn) return;
      $all(".filter").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      renderGallery();
    });
    var search = $("#gallery-search");
    if (search) {
      search.oninput = function (e) {
        state.search = e.target.value;
        renderGallery();
      };
    }
  }

  function initCreate() {
    $("#create-form").onsubmit = function (e) {
      e.preventDefault();
      var name = $("#c-name").value.trim();
      if (!name) return;
      var companion = {
        id: uid(),
        name: name,
        style: $("#c-style").value,
        personality: $("#c-personality").value,
        age: Number($("#c-age").value),
        voice: $("#c-voice").value,
        backstory: $("#c-backstory").value.trim(),
        adult: $("#c-adult").checked,
        messages: [{ role: "bot", text: "Hi, I'm " + name + ". I just came to life for you… what do you want to talk about?" }]
      };
      state.companions.unshift(companion);
      state.activeId = companion.id;
      save();
      maybeFetchPortrait(companion);
      $("#create-form").reset();
      showView("chat");
      renderChatList();
      openChat(companion.id);
    };
  }

  function renderChatList() {
    var list = $("#chat-list");
    if (!state.companions.length) {
      list.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;padding:0.5rem 0">No companions yet. Create one or pick from the gallery.</p>';
      return;
    }
    list.innerHTML = state.companions.map(function (c) {
      return '<div class="chat-item ' + (c.id === state.activeId ? "active" : "") + '" data-id="' + c.id + '">' +
        avatarHtml(c) + "<span>" + escapeHtml(c.name) + "</span></div>";
    }).join("");
    list.querySelectorAll(".chat-item").forEach(function (item) {
      item.onclick = function () { openChat(item.dataset.id); };
    });
  }

  function openChat(id) {
    var c = state.companions.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    state.activeId = id;
    renderChatList();
    $("#chat-header-info").innerHTML = avatarHtml(c) + "<span>" + escapeHtml(c.name) + "</span>";
    var box = $("#chat-messages");
    box.innerHTML = (c.messages || []).map(function (m) {
      var html = '<div class="msg ' + (m.role === "user" ? "user" : "bot") + '">' + escapeHtml(m.text) + '</div>';
      if (state.settings.devMode && m.role === "bot" && m.source) {
        var label = m.source === "llm" ? ("llm: " + (m.model || "?")) : (m.source + (m.error ? " — " + m.error : ""));
        html += '<div class="debug-caption">' + escapeHtml(label) + '</div>';
      }
      return html;
    }).join("");
    box.scrollTop = box.scrollHeight;
    var input = $("#chat-text");
    var btn = $("#chat-form button[type='submit']");
    input.disabled = false;
    btn.disabled = false;
    input.focus();
    $("#btn-call").disabled = false;
    $("#btn-mic").disabled = !hasSTT;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function localReply(personality) {
    var pool = REPLIES[personality] || REPLIES.playful;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Same { text, source, model, error? } shape as fetchCompanionReply, for the fully-offline
  // path (no gateway base URL configured at all).
  function offlineReply(c) {
    return { text: localReply(c.personality), source: "offline", model: null };
  }

  // --- Store: plan tiers + (stub/test-mode) checkout ------------------------------------
  // No account system yet, so billing is scoped to a per-browser anonymous tenant id
  // persisted in localStorage (separate from the companions blob, deliberately never wiped by
  // "Clear all local data" alone — see initSettings' btn-clear, which does NOT touch this key).

  function tenantId() {
    var id = localStorage.getItem("fucklike_tenant");
    if (!id) {
      id = "fl-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem("fucklike_tenant", id);
    }
    return id;
  }

  function billingHeaders() {
    return { "content-type": "application/json", "X-HDV-Tenant": tenantId() };
  }

  function renderStore() {
    var balanceEl = $("#store-balance");
    var plansEl = $("#store-plans");
    if (!apiBase()) {
      balanceEl.innerHTML = "";
      plansEl.innerHTML = '<p class="muted">No gateway connected (Settings &gt; Developer &gt; Gateway base URL) — nothing to buy from offline mode.</p>';
      return;
    }
    balanceEl.textContent = "Loading…";
    plansEl.innerHTML = "";

    Promise.all([
      fetch(apiBase() + "/v1/billing/pricing").then(function (r) { return r.json(); }),
      fetch(apiBase() + "/v1/billing/usage", { headers: billingHeaders() }).then(function (r) { return r.json(); })
    ]).then(function (results) {
      var pricing = results[0];
      var usage = results[1];
      var balance = usage && usage.balance;
      if (balance) {
        balanceEl.innerHTML = "Current plan: <b>" + escapeHtml(balance.tier) + "</b> · " +
          "$" + balance.spentUsd.toFixed(4) + " used" +
          (balance.hardCapUsd != null ? " of $" + balance.hardCapUsd.toFixed(2) : " (unlimited)");
      }
      var rows = (pricing && pricing.tiers) || (Array.isArray(pricing) ? pricing : []);
      plansEl.innerHTML = rows.map(function (row) {
        var tier = row.tier || row.name;
        var price = typeof row.monthlyPriceUsd === "number" ? "$" + row.monthlyPriceUsd + "/mo" : (row.priceLabel || "");
        return '<div class="plan-card" data-tier="' + escapeHtml(tier) + '">' +
          '<div class="plan-tier">' + escapeHtml(tier) + '</div>' +
          '<div class="plan-price">' + escapeHtml(price) + '</div>' +
          '<button class="btn btn-primary full btn-subscribe" data-tier="' + escapeHtml(tier) + '">' +
          (balance && balance.tier === tier ? "Current plan" : "Subscribe") + '</button></div>';
      }).join("") || '<p class="muted">No pricing table returned by the gateway.</p>';
    }).catch(function (err) {
      balanceEl.textContent = "";
      plansEl.innerHTML = '<p class="muted">Could not reach the gateway\'s billing routes: ' + escapeHtml(err.message) + '</p>';
    });
  }

  function initStore() {
    $("#store-plans").addEventListener("click", function (e) {
      var btn = e.target.closest(".btn-subscribe");
      if (!btn) return;
      var tier = btn.dataset.tier;
      btn.disabled = true;
      btn.textContent = "Starting checkout…";
      fetch(apiBase() + "/v1/billing/checkout", {
        method: "POST",
        headers: billingHeaders(),
        body: JSON.stringify({ tier: tier })
      }).then(function (r) { return r.json(); }).then(function (session) {
        if (!session.sessionId) throw new Error(session.error || "checkout failed");
        btn.textContent = "Confirm test payment (" + tier + ")";
        btn.disabled = false;
        btn.onclick = function () {
          btn.disabled = true;
          btn.textContent = "Settling…";
          fetch(apiBase() + "/v1/billing/checkout/settle", {
            method: "POST",
            headers: billingHeaders(),
            body: JSON.stringify({ sessionId: session.sessionId })
          }).then(function (r) { return r.json(); }).then(function () {
            renderStore();
          }).catch(function (err) {
            alert("Settle failed: " + err.message);
            btn.disabled = false;
          });
        };
      }).catch(function (err) {
        alert("Checkout failed: " + err.message);
        btn.disabled = false;
        btn.textContent = "Subscribe";
      });
    });
  }

  function logDebug(result) {
    if (!state.settings.devMode) return;
    if (result.source === "llm") console.log("[fucklike debug] reply from LLM:", result.model);
    else console.log("[fucklike debug] reply source:", result.source, "model:", result.model, "error:", result.error || "(none)");
  }

  // Small caption under a bot bubble showing where the reply actually came from, only when
  // Developer > Debug mode is on. This is the fix for "can't tell why chat degraded to canned
  // replies" — the source/error were always in the API response, just never surfaced anywhere.
  function appendDebugCaption(msgEl, result) {
    if (!state.settings.devMode) return;
    var cap = document.createElement("div");
    cap.className = "debug-caption";
    var label = result.source === "llm" ? ("llm: " + (result.model || "?")) : (result.source + (result.error ? " — " + result.error : ""));
    cap.textContent = label;
    msgEl.parentElement && msgEl.parentElement.insertBefore(cap, msgEl.nextSibling);
  }

  // Calls the live HDV gateway's companion chat endpoint. Falls back to a local canned
  // reply on any network error, timeout, or non-OK response so chat never hard-fails.
  // Resolves to { text, source, model, error? } — never just a bare string — so callers (and
  // Developer > Debug mode) can tell a real LLM reply from the canned fallback instead of
  // guessing. This is also the fix for "can't tell why it silently reverted to canned replies":
  // the error (rate limit / provider timeout / whatever) used to be discarded entirely.
  function fetchCompanionReply(c, text) {
    var history = (c.messages || []).slice(-20).map(function (m) {
      return { role: m.role === "user" ? "user" : "bot", text: m.text };
    });
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CHAT_TIMEOUT_MS) : null;

    return fetch(apiBase() + "/v1/companion/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persona: {
          name: c.name, age: c.age, personality: c.personality, backstory: c.backstory,
          intensity: state.settings.intensity, adherence: state.settings.adherence
        },
        history: history,
        message: text
      }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("gateway HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      if (data && typeof data.reply === "string" && data.reply) {
        return { text: data.reply, source: data.source || "unknown", model: data.model || null, error: data.error };
      }
      return { text: localReply(c.personality), source: "fallback", model: null, error: (data && data.error) || "empty reply from gateway" };
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      return { text: localReply(c.personality), source: "network-error", model: null, error: err && err.message };
    });
  }

  // --- "Typing…" indicator + progressive reveal -----------------------------------------
  // No real token streaming (the gateway returns one buffered JSON reply, not SSE — see
  // deploy notes), so this simulates the live-typing feel client-side: an animated
  // typing-dots bubble while the request is in flight, then the finished reply is revealed
  // character-by-character instead of appearing as one instant block.

  function appendMessageEl(role, text) {
    var box = $("#chat-messages");
    var el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function showTypingIndicator() {
    hideTypingIndicator();
    var box = $("#chat-messages");
    var el = document.createElement("div");
    el.className = "msg bot typing-indicator";
    el.id = "typing-indicator";
    el.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  function hideTypingIndicator() {
    var el = document.getElementById("typing-indicator");
    if (el) el.remove();
  }

  function typeOutText(el, text, onDone) {
    var box = $("#chat-messages");
    var i = 0;
    var charsPerTick = text.length > 220 ? 4 : text.length > 90 ? 2 : 1;
    (function tick() {
      i += charsPerTick;
      el.textContent = text.slice(0, i);
      box.scrollTop = box.scrollHeight;
      if (i < text.length) {
        setTimeout(tick, 18);
      } else {
        el.textContent = text;
        if (onDone) onDone();
      }
    })();
  }

  // --- Voice: text-to-speech (bot replies) and speech-to-text (mic input) ----------------
  // Both use the browser's built-in Web Speech APIs — no audio ever leaves the device to a
  // third-party voice service. Support varies badly by browser (notably: no STT on iOS
  // Safari), so every entry point is feature-detected and hidden/disabled rather than
  // shown-but-broken.

  var hasTTS = "speechSynthesis" in window;
  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  var hasSTT = !!SpeechRecognitionCtor;

  function stopSpeaking() {
    if (hasTTS) window.speechSynthesis.cancel();
  }

  function speakText(text, onEnd) {
    if (!hasTTS || !text) { if (onEnd) onEnd(); return; }
    stopSpeaking();
    var utter = new SpeechSynthesisUtterance(text);
    utter.onend = onEnd || null;
    utter.onerror = onEnd || null;
    window.speechSynthesis.speak(utter);
  }

  function createRecognizer() {
    if (!hasSTT) return null;
    var rec = new SpeechRecognitionCtor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    return rec;
  }

  function initMic() {
    var btn = $("#btn-mic");
    if (!hasSTT) { btn.style.display = "none"; return; }
    var listening = false;
    btn.onclick = function () {
      if (listening) return;
      var rec = createRecognizer();
      if (!rec) return;
      listening = true;
      btn.classList.add("listening");
      rec.onresult = function (e) {
        var transcript = e.results[0][0].transcript;
        var input = $("#chat-text");
        input.value = (input.value ? input.value + " " : "") + transcript;
        input.focus();
      };
      rec.onend = function () { listening = false; btn.classList.remove("listening"); };
      rec.onerror = function () { listening = false; btn.classList.remove("listening"); };
      rec.start();
    };
  }

  function initChat() {
    $("#chat-form").onsubmit = function (e) {
      e.preventDefault();
      var input = $("#chat-text");
      var text = input.value.trim();
      if (!text || !state.activeId) return;
      var c = state.companions.filter(function (x) { return x.id === state.activeId; })[0];
      if (!c) return;
      c.messages = c.messages || [];
      c.messages.push({ role: "user", text: text });
      input.value = "";
      save();
      openChat(c.id);

      var activeAtSend = state.activeId;
      if (activeAtSend === c.id) showTypingIndicator();

      var respond = apiBase() ? fetchCompanionReply(c, text) : Promise.resolve(offlineReply(c));
      respond.then(function (result) {
        logDebug(result);
        c.messages.push({ role: "bot", text: result.text, source: result.source, model: result.model, error: result.error });
        save();
        if (state.activeId !== c.id) return;
        hideTypingIndicator();
        var el = appendMessageEl("bot", "");
        typeOutText(el, result.text, function () {
          appendDebugCaption(el, result);
          if (state.settings.voice) speakText(result.text);
        });
      });
    };
  }

  // --- Live call: push-to-talk voice loop (STT -> chat -> TTS) in a call-style overlay ---

  function initCall() {
    var overlay = $("#call-overlay");
    var micBtn = $("#btn-call-mic");
    var status = $("#call-status");
    var recognizing = false;

    function endCall() {
      stopSpeaking();
      if (hasSTT) { try { recognizerInFlight && recognizerInFlight.abort(); } catch (e) {} }
      recognizing = false;
      micBtn.classList.remove("listening", "speaking");
      overlay.classList.add("hidden");
    }

    var recognizerInFlight = null;

    function takeTurn() {
      var c = state.companions.filter(function (x) { return x.id === state.activeId; })[0];
      if (!c) return endCall();
      if (!hasSTT) { status.textContent = "Voice input isn't supported in this browser."; return; }
      var rec = createRecognizer();
      recognizerInFlight = rec;
      recognizing = true;
      micBtn.classList.add("listening");
      status.textContent = "Listening…";
      rec.onresult = function (e) {
        var transcript = e.results[0][0].transcript;
        micBtn.classList.remove("listening");
        status.textContent = c.name + " is thinking…";
        c.messages = c.messages || [];
        c.messages.push({ role: "user", text: transcript });
        save();
        if (state.activeId === c.id) openChat(c.id);

        var respond = apiBase() ? fetchCompanionReply(c, transcript) : Promise.resolve(offlineReply(c));
        respond.then(function (result) {
          logDebug(result);
          c.messages.push({ role: "bot", text: result.text, source: result.source, model: result.model, error: result.error });
          save();
          if (state.activeId === c.id) openChat(c.id);
          if (overlay.classList.contains("hidden")) return;
          status.textContent = c.name + " is speaking…";
          micBtn.classList.add("speaking");
          speakText(result.text, function () {
            micBtn.classList.remove("speaking");
            if (!overlay.classList.contains("hidden")) status.textContent = "Tap to talk";
          });
        });
      };
      rec.onerror = function () { recognizing = false; micBtn.classList.remove("listening"); status.textContent = "Tap to talk"; };
      rec.onend = function () { recognizing = false; micBtn.classList.remove("listening"); };
      rec.start();
    }

    $("#btn-call").onclick = function () {
      var c = state.companions.filter(function (x) { return x.id === state.activeId; })[0];
      if (!c) return;
      $("#call-avatar").innerHTML = avatarHtml(c);
      $("#call-name").textContent = c.name;
      status.textContent = hasSTT ? "Tap to talk" : "Voice input isn't supported in this browser.";
      overlay.classList.remove("hidden");
    };
    $("#btn-call-end").onclick = endCall;
    micBtn.onclick = function () {
      if (recognizing) return;
      takeTurn();
    };
  }

  var INTENSITY_DESC = {
    1: "sweet & PG", 2: "warm & romantic", 3: "flirty, moderate spice",
    4: "explicit / raunchy", 5: "maximally explicit"
  };
  var ADHERENCE_DESC = {
    1: "loose, improvises freely", 2: "mostly improvises", 3: "balanced",
    4: "sticks closely to character", 5: "strict script, never deviates"
  };

  function renderSettings() {
    $("#set-haptics").checked = !!state.settings.haptics;
    $("#set-suit").checked = !!state.settings.suit;
    $("#set-3d").checked = !!state.settings.prefer3d;
    $("#set-nsfw").checked = !!state.settings.nsfw;
    $("#set-voice").checked = !!state.settings.voice;
    $("#set-voice").disabled = !hasTTS;
    $("#set-intensity").value = state.settings.intensity;
    $("#intensity-val").textContent = state.settings.intensity;
    $("#intensity-desc").textContent = INTENSITY_DESC[state.settings.intensity] || "";
    $("#set-adherence").value = state.settings.adherence;
    $("#adherence-val").textContent = state.settings.adherence;
    $("#adherence-desc").textContent = ADHERENCE_DESC[state.settings.adherence] || "";
    $("#set-dev-mode").checked = !!state.settings.devMode;
    $("#set-api-base").value = state.settings.apiBaseOverride || "";
  }

  function initSettings() {
    $("#set-haptics").onchange = function (e) { state.settings.haptics = e.target.checked; save(); };
    $("#set-suit").onchange = function (e) { state.settings.suit = e.target.checked; save(); };
    $("#set-3d").onchange = function (e) { state.settings.prefer3d = e.target.checked; save(); };
    $("#set-nsfw").onchange = function (e) { state.settings.nsfw = e.target.checked; save(); };
    $("#set-voice").onchange = function (e) { state.settings.voice = e.target.checked; if (!e.target.checked) stopSpeaking(); save(); };
    $("#set-intensity").oninput = function (e) { state.settings.intensity = Number(e.target.value); renderSettings(); save(); };
    $("#set-adherence").oninput = function (e) { state.settings.adherence = Number(e.target.value); renderSettings(); save(); };
    $("#set-dev-mode").onchange = function (e) { state.settings.devMode = e.target.checked; save(); };
    $("#set-api-base").onchange = function (e) { state.settings.apiBaseOverride = e.target.value.trim(); save(); };
    $("#btn-disable-all-hw").onclick = function () {
      state.settings.haptics = false;
      state.settings.suit = false;
      save();
      renderSettings();
    };
    $("#btn-view-raw-state").onclick = function () {
      var pre = $("#raw-state-view");
      if (!pre.classList.contains("hidden")) { pre.classList.add("hidden"); return; }
      pre.textContent = JSON.stringify(state, null, 2);
      pre.classList.remove("hidden");
    };
    $("#btn-export").onclick = function () {
      var blob = new Blob([JSON.stringify({ companions: state.companions, settings: state.settings }, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "fucklike-export.json";
      a.click();
    };
    $("#btn-clear").onclick = function () {
      if (!confirm("Clear all local companions and settings?")) return;
      state.companions = [];
      state.activeId = null;
      state.settings = defaultSettings();
      save();
      renderChatList();
      renderSettings();
      $("#chat-header-info").textContent = "Select a companion";
      $("#chat-messages").innerHTML = "";
      $("#chat-text").disabled = true;
      $("#btn-call").disabled = true;
      $("#btn-mic").disabled = true;
    };
  }

  load();
  initAgeGate();
  initNav();
  initFilters();
  initCreate();
  initChat();
  initMic();
  initCall();
  initStore();
  initSettings();
  if (state.ageOk) showView("home");
})();

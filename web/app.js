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
  // Fallback art for custom (non-preset) companions, keyed by "<style>-<personality>" — see
  // useArchetypeAssets below and colab/09_batch_pregenerate.py's ARCHETYPES matrix.
  const TEMPLATE_ASSET_BASE = "/assets/templates";

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

  // Deterministic per-persona fallback gradient for gallery cards without real generated art
  // yet, so an empty gallery reads as an intentional premium design choice instead of a
  // broken/blank state. This is ONLY the layer underneath `.card-thumb` -- once a persona's
  // real thumbnail actually loads, __flCardArtLoaded's "has-art" class + the image itself
  // fully cover it, unchanged from before. Every stop below is this site's own --pink /
  // --pink-hot / --bg / --bg2 / --card token values (see :root in styles.css) at a few
  // different angles/opacities -- not an invented, unrelated palette.
  var CARD_FALLBACK_GRADIENTS = [
    "linear-gradient(145deg, rgba(255,77,141,0.32), #1a1a1f)",
    "linear-gradient(200deg, rgba(255,45,111,0.38), #0a0a0c)",
    "linear-gradient(120deg, #121216, rgba(255,77,141,0.28))",
    "linear-gradient(165deg, rgba(255,77,141,0.16), #1a1a1f)",
    "linear-gradient(210deg, #0a0a0c, rgba(255,45,111,0.34))",
    "linear-gradient(100deg, rgba(255,77,141,0.4), #121216)",
    "linear-gradient(175deg, #1a1a1f, rgba(255,45,111,0.3))",
    "linear-gradient(135deg, rgba(255,77,141,0.15), #0a0a0c)"
  ];

  // Simple deterministic string hash (djb2-ish) -- same persona id always picks the same
  // gradient, but different ids spread fairly evenly across the palette above.
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function cardFallbackGradient(p) {
    var key = (p && (p.id || p.name)) || "";
    return CARD_FALLBACK_GRADIENTS[hashStr(key) % CARD_FALLBACK_GRADIENTS.length];
  }

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

  function activeCompanion() {
    return state.companions.filter(function (x) { return x.id === state.activeId; })[0];
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

  // Same free, pre-generated-static-asset trick as usePresetAssets, but for custom companions
  // made in Create (which have no presetId to key off of). HDV_Foundation/colab/
  // 09_batch_pregenerate.py renders one portrait per (style x personality) archetype in
  // addition to the named presets — see its ARCHETYPES matrix — and this just picks the
  // matching one deterministically from the two fields the create form already collects. No
  // live generation, no gateway call, no cost: works the instant the archetype library is
  // uploaded, same graceful onerror->initial-letter fallback as presets until then.
  function useArchetypeAssets(c) {
    var key = (c.style || "realistic") + "-" + (c.personality || "playful");
    c.portrait = TEMPLATE_ASSET_BASE + "/" + key + "/default.png";
    // Distinguishes "placeholder template art" from "a real generated/LoRA portrait" so
    // maybeFetchPortrait (below) knows it's still allowed to upgrade this one, unlike a
    // portrait that already came from a real provider.
    c.portraitIsTemplate = true;
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
    if (!apiBase() || (c.portrait && !c.portraitIsTemplate) || c.portraitPending) return;
    c.portraitPending = true;
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CHAT_TIMEOUT_MS) : null;

    fetch(apiBase() + "/v1/companion/portrait", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // presetId (e.g. "jordyn") lets the gateway/portrait server layer that character's own
        // trained LoRA on top of the style checkpoint, when one exists — see
        // HDV_Foundation/colab/07_portrait_server.py's PERSONA_LORA_ROUTES. Custom/non-preset
        // companions just omit it (c.presetId is undefined) and fall back to the plain
        // per-style behavior, unchanged.
        persona: { name: c.name, age: c.age, style: c.style, personality: c.personality, appearance: c.appearance, backstory: c.backstory, personaId: c.presetId }
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
      c.portraitIsTemplate = false;
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
      var fallbackGradient = cardFallbackGradient(p);
      return '<div class="card" data-preset="' + p.id + '">' +
        '<div class="img" style="background: ' + fallbackGradient + '">' +
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
            favorite: false,
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
        favorite: false,
        messages: [{ role: "bot", text: "Hi, I'm " + name + ". I just came to life for you… what do you want to talk about?" }]
      };
      state.companions.unshift(companion);
      state.activeId = companion.id;
      save();
      // Free, instant art from the pre-generated archetype library (see useArchetypeAssets)
      // instead of a live gateway call — matches how gallery presets work, zero cost, no
      // Colab/gateway dependency. maybeFetchPortrait still runs after: it's a no-op today
      // (apiBase() is empty by default) but silently upgrades this template placeholder to a
      // real live/LoRA portrait later for anyone who does configure a live image provider,
      // without needing this code to change (see portraitIsTemplate in maybeFetchPortrait).
      useArchetypeAssets(companion);
      maybeFetchPortrait(companion);
      $("#create-form").reset();
      showView("chat");
      renderChatList();
      openChat(companion.id);
    };
  }

  // Favorites are per-companion-instance (state.companions), not per-PRESETS-template, since a
  // preset only becomes a real companion instance once someone clicks into chat with it (see
  // the preset click handler in renderGallery). The chat list -- not the gallery grid -- is
  // the natural place to surface/pin them: it's the view that already lists real instances,
  // while the gallery grid renders PRESETS templates that don't carry a `favorite` flag at all.
  function renderChatList() {
    var list = $("#chat-list");
    if (!state.companions.length) {
      list.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;padding:0.5rem 0">No companions yet. Create one or pick from the gallery.</p>';
      return;
    }
    // Stable sort: favorites first, otherwise original (most-recently-created-first) order.
    var sorted = state.companions.slice().sort(function (a, b) {
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    });
    list.innerHTML = sorted.map(function (c) {
      var star = c.favorite ? '<span class="fav-star" title="Favorite">&#9733;</span>' : "";
      return '<div class="chat-item ' + (c.id === state.activeId ? "active" : "") + '" data-id="' + c.id + '">' +
        avatarHtml(c) + '<span class="chat-item-name">' + star + escapeHtml(c.name) + "</span></div>";
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
    box.innerHTML = (c.messages || []).map(function (m, idx) {
      var html = '<div class="msg ' + (m.role === "user" ? "user" : "bot") + '">' + escapeHtml(m.text) + '</div>';
      // Edit is offered on every user message; regenerate only where there's actually a prior
      // user turn to re-derive a reply from (i.e. never on the opening bot greeting at idx 0).
      if (m.role === "user") {
        html += '<div class="msg-actions user" data-idx="' + idx + '">' +
          '<button type="button" class="msg-btn btn-edit" title="Edit message">&#9998; edit</button></div>';
      } else if (idx > 0) {
        html += '<div class="msg-actions bot" data-idx="' + idx + '">' +
          '<button type="button" class="msg-btn btn-regen" title="Regenerate reply">&#8635; regenerate</button></div>';
      }
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
    $("#btn-export-companion").disabled = false;
    $("#btn-favorite").disabled = false;
    updateFavoriteButton(c);
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
    // If a .msg-actions row (regenerate/edit) already sits right after the bubble, land the
    // caption after that instead of between them, so DOM order always reads bubble -> actions
    // -> caption regardless of which helper ran first (matches openChat's full re-render order).
    var ref = msgEl.nextSibling;
    if (ref && ref.classList && ref.classList.contains("msg-actions")) ref = ref.nextSibling;
    msgEl.parentElement && msgEl.parentElement.insertBefore(cap, ref);
  }

  // Inserts a small "regenerate"/"edit" action row right after a message bubble element,
  // mirroring the markup openChat()'s full re-render already produces for each message. Used
  // when a bot reply is appended live (typed out) instead of going through a full re-render.
  function appendMessageActionsAfter(afterEl, role, idx) {
    var el = document.createElement("div");
    el.className = "msg-actions " + role;
    el.dataset.idx = String(idx);
    el.innerHTML = role === "bot"
      ? '<button type="button" class="msg-btn btn-regen" title="Regenerate reply">&#8635; regenerate</button>'
      : '<button type="button" class="msg-btn btn-edit" title="Edit message">&#9998; edit</button>';
    afterEl.parentElement && afterEl.parentElement.insertBefore(el, afterEl.nextSibling);
    return el;
  }

  // Re-derives a fresh reply for the SAME preceding user message and replaces this bot
  // bubble's content in place (progressive reveal via typeOutText), updating c.messages[idx]
  // and persisting -- it does not touch any other message or re-open/scroll the whole chat.
  function regenerateMessage(container) {
    var idx = Number(container.dataset.idx);
    var c = activeCompanion();
    if (!c || !c.messages || isNaN(idx)) return;
    var msgs = c.messages;
    var target = msgs[idx];
    if (!target || target.role !== "bot") return;
    var userText = null;
    for (var i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { userText = msgs[i].text; break; }
    }
    if (userText == null) return;

    var bubbleEl = container.previousElementSibling;
    if (!bubbleEl || !bubbleEl.classList.contains("msg")) return;
    var btn = container.querySelector(".btn-regen");
    if (btn) btn.disabled = true;

    // Drop any stale debug caption for the old reply (it sits right after this actions row);
    // a fresh one (if any) gets appended once the new reply finishes typing out.
    var staleCap = container.nextElementSibling;
    if (staleCap && staleCap.classList.contains("debug-caption")) staleCap.remove();

    bubbleEl.classList.add("typing-indicator");
    bubbleEl.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

    var respond = apiBase() ? fetchCompanionReply(c, userText) : Promise.resolve(offlineReply(c));
    respond.then(function (result) {
      logDebug(result);
      msgs[idx] = { role: "bot", text: result.text, source: result.source, model: result.model, error: result.error };
      save();
      if (btn) btn.disabled = false;
      if (state.activeId !== c.id) return;
      bubbleEl.classList.remove("typing-indicator");
      bubbleEl.textContent = "";
      typeOutText(bubbleEl, result.text, function () {
        appendDebugCaption(bubbleEl, result);
        if (state.settings.voice) speakText(result.text);
      });
    });
  }

  // Loads a user message's text back into the composer and truncates c.messages to drop that
  // message and everything after it, so re-sending doesn't duplicate history.
  function editMessageFromContainer(container) {
    var idx = Number(container.dataset.idx);
    var c = activeCompanion();
    if (!c || !c.messages || isNaN(idx)) return;
    var target = c.messages[idx];
    if (!target || target.role !== "user") return;
    c.messages = c.messages.slice(0, idx);
    save();
    openChat(c.id);
    var input = $("#chat-text");
    input.value = target.text;
    input.focus();
    var len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (e) {}
  }

  // Single delegated listener covers both full re-renders (openChat) and buttons appended
  // live after a typed-out reply (appendMessageActionsAfter) -- no per-button rewiring needed.
  function initMessageActions() {
    $("#chat-messages").addEventListener("click", function (e) {
      var regenBtn = e.target.closest(".btn-regen");
      if (regenBtn) {
        if (regenBtn.disabled) return;
        var container = regenBtn.closest(".msg-actions");
        if (container) regenerateMessage(container);
        return;
      }
      var editBtn = e.target.closest(".btn-edit");
      if (editBtn) {
        var container2 = editBtn.closest(".msg-actions");
        if (container2) editMessageFromContainer(container2);
      }
    });
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
          appendMessageActionsAfter(el, "bot", c.messages.length - 1);
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

  // --- Favorites --------------------------------------------------------------------------
  // Favoriting lives on the companion INSTANCE (state.companions), never on a PRESETS
  // template -- a preset has no `favorite` flag until someone actually starts chatting with
  // it (see the gallery card click handler, which is the only place presets turn into real
  // companion objects). The toggle lives in the chat header (next to call/export); the chat
  // list is where favorites actually surface, pinned to the top with a small star indicator
  // (see renderChatList) -- that fit this app's existing gallery-vs-chat-list split better
  // than a gallery filter chip would have, since the gallery only ever renders PRESETS.

  function updateFavoriteButton(c) {
    var btn = $("#btn-favorite");
    if (!btn) return;
    var fav = !!(c && c.favorite);
    btn.classList.toggle("is-fav", fav);
    btn.innerHTML = fav ? "&#9733;" : "&#9734;";
    btn.title = fav ? "Remove from favorites" : "Add to favorites";
  }

  function initFavorite() {
    $("#btn-favorite").onclick = function () {
      var c = activeCompanion();
      if (!c) return;
      c.favorite = !c.favorite;
      save();
      updateFavoriteButton(c);
      renderChatList();
    };
  }

  // --- Character card export/import ---------------------------------------------------
  // This is FuckLike's own tiny companion-card JSON format -- NOT verified or claimed to be
  // compatible with any third-party "character card" spec (Character.AI, SillyTavern/Tavern
  // PNG cards, etc). formatVersion exists so a future shape change can detect old exports.
  // intensity/adherence are currently global dials (state.settings), not per-companion, so
  // export snapshots whatever they're set to at export time -- the closest per-card analog
  // this app's data model has today.

  function companionToCard(c) {
    var card = { formatVersion: 1, name: c.name };
    if (c.personality) card.personality = c.personality;
    if (c.backstory) card.backstory = c.backstory;
    if (c.appearance) card.appearance = c.appearance;
    if (c.age != null) card.age = c.age;
    if (c.style) card.style = c.style;
    if (typeof state.settings.intensity === "number") card.intensity = state.settings.intensity;
    if (typeof state.settings.adherence === "number") card.adherence = state.settings.adherence;
    return card;
  }

  function initExportCompanion() {
    $("#btn-export-companion").onclick = function () {
      var c = activeCompanion();
      if (!c) return;
      var card = companionToCard(c);
      var blob = new Blob([JSON.stringify(card, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      var slug = (c.name || "companion").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "companion";
      a.download = slug + "-card.json";
      a.click();
    };
  }

  var CREATE_PERSONALITIES = ["playful", "romantic", "bratty", "dominant", "soft", "mysterious"];

  // Parses (leniently but safely) a pasted/uploaded companion-card blob. Never throws past
  // this function's caller -- malformed JSON or a missing required field surfaces as a
  // thrown Error with a clear message, which callers turn into an inline error, never an
  // uncaught exception or a write into `state`.
  function parseCompanionCard(raw) {
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error("That's not valid JSON.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Card must be a JSON object.");
    }
    if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
      throw new Error('Card is missing a required "name" field.');
    }
    return data;
  }

  // Prefills the Create form so the user can review/edit before submitting -- importing a
  // card never creates a companion or touches `state` directly.
  function fillCreateFormFromCard(card) {
    $("#c-name").value = String(card.name).slice(0, 24);
    if (card.style === "realistic" || card.style === "anime") $("#c-style").value = card.style;
    if (CREATE_PERSONALITIES.indexOf(card.personality) !== -1) $("#c-personality").value = card.personality;
    if (card.age != null) {
      var ageStr = String(Number(card.age));
      var ageSelect = $("#c-age");
      var hasOption = [].slice.call(ageSelect.options).some(function (o) { return o.value === ageStr; });
      if (hasOption) ageSelect.value = ageStr;
    }
    if (typeof card.backstory === "string") $("#c-backstory").value = card.backstory.slice(0, 4000);
  }

  function initImportCard() {
    var errEl = $("#c-import-error");
    function showError(msg) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
    function clearError() {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }
    $("#c-import-btn").onclick = function () {
      clearError();
      var raw = $("#c-import-text").value.trim();
      if (!raw) { showError("Paste a card JSON above, or choose a file below, first."); return; }
      try {
        fillCreateFormFromCard(parseCompanionCard(raw));
      } catch (err) {
        showError(err.message || "Could not import that card.");
      }
    };
    $("#c-import-file").onchange = function (e) {
      clearError();
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        try {
          fillCreateFormFromCard(parseCompanionCard(text));
          $("#c-import-text").value = text;
        } catch (err) {
          showError(err.message || "Could not import that card.");
        }
      };
      reader.onerror = function () { showError("Could not read that file."); };
      reader.readAsText(file);
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
      $("#btn-export-companion").disabled = true;
      $("#btn-favorite").disabled = true;
      updateFavoriteButton(null);
    };
  }

  load();
  initAgeGate();
  initNav();
  initFilters();
  initCreate();
  initImportCard();
  initChat();
  initMessageActions();
  initMic();
  initCall();
  initFavorite();
  initExportCompanion();
  initStore();
  initSettings();
  if (state.ageOk) showView("home");
})();

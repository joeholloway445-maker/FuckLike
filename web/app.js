(function () {
  "use strict";

  // Backend: set to your live gateway when ready, e.g. "https://api.fucklike.ai"
  // Leave empty to use local replies (works offline right now)
  const API_BASE = "";
  const CHAT_TIMEOUT_MS = 15000;
  // Scene/loop video generation is minutes-slow, not seconds — a much longer budget than chat.
  const SCENE_TIMEOUT_MS = 10 * 60 * 1000;
  // Gallery presets use pre-generated static art (see HDV_Foundation/colab/09_batch_pregenerate.py)
  // instead of live generation — no gateway/Colab tunnel needs to be running for these to show up.
  // Served straight off this same origin by nginx; falls back gracefully (see avatarHtml) if a
  // given persona/prompt combo hasn't been generated and uploaded yet.
  const PRESET_ASSET_BASE = "/assets/personas";

  const PRESETS = [
    { id: "jordyn", name: "Jordyn", style: "realistic", personality: "bratty", appearance: "gorgeous, thick, light brunette hair", backstory: "A devoted girlfriend/wife type who loves hard — but she's got a mean, teasing streak and isn't afraid to talk back.", age: 24, tag: "Girlfriend", live: true },
    { id: "isabella", name: "Isabella", style: "realistic", personality: "romantic", age: 25, tag: "Romantic", live: false },
    { id: "aria", name: "Aria", style: "anime", personality: "bratty", age: 21, tag: "Bratty", live: false, badge: "NEW" },
    { id: "sofia", name: "Sofia", style: "realistic", personality: "dominant", age: 27, tag: "Soft dom", live: false },
    { id: "mila", name: "Mila", style: "realistic", personality: "romantic", age: 22, tag: "Girlfriend", live: false },
    { id: "nova", name: "Nova", style: "anime", personality: "mysterious", age: 24, tag: "Goth", live: true },
    { id: "elena", name: "Elena", style: "realistic", personality: "soft", age: 29, tag: "Mature", live: false },
    { id: "kai", name: "Kai", style: "realistic", personality: "playful", age: 26, tag: "Switch", live: false }
  ];

  const REPLIES = {
    playful: ["Hehe, you're fun. Keep talking to me.", "Oh yeah? Tell me more…", "I like that side of you.", "You're making me smile already.", "Don't stop. I was just getting into this."],
    romantic: ["I've been thinking about you.", "That means a lot to me.", "Come closer. I want to hear everything.", "You make ordinary moments feel special.", "I feel safe with you."],
    bratty: ["Make me.", "Is that all you've got?", "You're lucky I like you.", "Hmm… try harder.", "Maybe if you ask nicely."],
    dominant: ["Good. That's what I wanted to hear.", "Look at me when you say that.", "You're doing well. Keep going.", "I decide the pace.", "Obey and I'll take care of you."],
    soft: ["I'm here. Take your time.", "You can tell me anything.", "That sounds hard. I'm listening.", "I care about how you feel.", "Come here. You're safe with me."],
    mysterious: ["Interesting…", "There's more to that, isn't there?", "I don't give everything away so easily.", "Ask the right question.", "You'll figure me out eventually."]
  };

  let state = {
    ageOk: false,
    companions: [],
    activeId: null,
    filter: "all",
    settings: { haptics: false, suit: false, prefer3d: false, nsfw: true }
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

  // Calls the live HDV gateway's companion portrait endpoint. No-ops (leaves the fallback
  // initial avatar in place) on any network error, timeout, or non-OK response.
  function maybeFetchPortrait(c) {
    if (!API_BASE || c.portrait || c.portraitPending) return;
    c.portraitPending = true;
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CHAT_TIMEOUT_MS) : null;

    fetch(API_BASE + "/v1/companion/portrait", {
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
    if (!API_BASE || !c.portrait || c.scene || c.scenePending) return;
    c.scenePending = true;
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, SCENE_TIMEOUT_MS) : null;

    fetch(API_BASE + "/v1/companion/scene", {
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
        }
      });
    });
  }

  function renderGallery() {
    var grid = $("#gallery-grid");
    var filter = state.filter;
    var list = PRESETS.filter(function (p) {
      if (filter === "all") return true;
      if (filter === "realistic" || filter === "anime") return p.style === filter;
      return p.personality === filter || (p.tag && p.tag.toLowerCase().indexOf(filter) !== -1);
    });

    grid.innerHTML = list.map(function (p) {
      return '<div class="card" data-preset="' + p.id + '">' +
        '<div class="img">' +
        (p.live ? '<span class="badge">LIVE</span>' : (p.badge ? '<span class="badge">' + p.badge + '</span>' : '')) +
        '<div class="meta"><div class="name">' + p.name + '</div><div class="tag">' + p.age + ' · ' + p.tag + '</div></div>' +
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
    $("#filters").addEventListener("click", function (e) {
      var btn = e.target.closest(".filter");
      if (!btn) return;
      $all(".filter").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      renderGallery();
    });
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
    $("#chat-header").innerHTML = avatarHtml(c) + "<span>" + escapeHtml(c.name) + "</span>";
    var box = $("#chat-messages");
    box.innerHTML = (c.messages || []).map(function (m) {
      return '<div class="msg ' + (m.role === "user" ? "user" : "bot") + '">' + escapeHtml(m.text) + '</div>';
    }).join("");
    box.scrollTop = box.scrollHeight;
    var input = $("#chat-text");
    var btn = $("#chat-form button");
    input.disabled = false;
    btn.disabled = false;
    input.focus();
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function localReply(personality) {
    var pool = REPLIES[personality] || REPLIES.playful;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Calls the live HDV gateway's companion chat endpoint. Falls back to a local canned
  // reply on any network error, timeout, or non-OK response so chat never hard-fails.
  function fetchCompanionReply(c, text) {
    var history = (c.messages || []).slice(-20).map(function (m) {
      return { role: m.role === "user" ? "user" : "bot", text: m.text };
    });
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CHAT_TIMEOUT_MS) : null;

    return fetch(API_BASE + "/v1/companion/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persona: { name: c.name, personality: c.personality, backstory: c.backstory },
        history: history,
        message: text
      }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("gateway error " + res.status);
      return res.json();
    }).then(function (data) {
      return (data && typeof data.reply === "string" && data.reply) || localReply(c.personality);
    }).catch(function () {
      if (timer) clearTimeout(timer);
      return localReply(c.personality);
    });
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

      var respond = API_BASE ? fetchCompanionReply(c, text) : Promise.resolve(localReply(c.personality));
      respond.then(function (reply) {
        c.messages.push({ role: "bot", text: reply });
        save();
        if (state.activeId === c.id) openChat(c.id);
      });
    };
  }

  function renderSettings() {
    $("#set-haptics").checked = !!state.settings.haptics;
    $("#set-suit").checked = !!state.settings.suit;
    $("#set-3d").checked = !!state.settings.prefer3d;
    $("#set-nsfw").checked = !!state.settings.nsfw;
  }

  function initSettings() {
    $("#set-haptics").onchange = function (e) { state.settings.haptics = e.target.checked; save(); };
    $("#set-suit").onchange = function (e) { state.settings.suit = e.target.checked; save(); };
    $("#set-3d").onchange = function (e) { state.settings.prefer3d = e.target.checked; save(); };
    $("#set-nsfw").onchange = function (e) { state.settings.nsfw = e.target.checked; save(); };
    $("#btn-disable-all-hw").onclick = function () {
      state.settings.haptics = false;
      state.settings.suit = false;
      save();
      renderSettings();
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
      state.settings = { haptics: false, suit: false, prefer3d: false, nsfw: true };
      save();
      renderChatList();
      renderSettings();
      $("#chat-header").textContent = "Select a companion";
      $("#chat-messages").innerHTML = "";
      $("#chat-text").disabled = true;
    };
  }

  load();
  initAgeGate();
  initNav();
  initFilters();
  initCreate();
  initChat();
  initSettings();
  if (state.ageOk) showView("home");
})();

(function () {
  "use strict";

  // Same-origin by default — deploy/nginx-fucklike.me.conf proxies /v1/ straight to the HDV
  // gateway, exactly like fucklike.ai does. No settings/override needed: unlike the fictional-
  // companion demo on fucklike.ai, this page is useless without a real backend anyway (you
  // can't sign up or earn against nothing), so there's no offline mode to fall back to.
  function apiBase() { return ""; }

  var STORAGE_KEY = "fucklike_creator_v1";

  var state = {
    sessionToken: null,
    email: null,
    authMode: "login" // or "signup"
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        state.sessionToken = data.sessionToken || null;
        state.email = data.email || null;
      }
    } catch (e) {}
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionToken: state.sessionToken, email: state.email }));
  }

  function clearSession() {
    state.sessionToken = null;
    state.email = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return [].slice.call(document.querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showView(name) {
    $all(".view").forEach(function (v) { v.classList.add("hidden"); });
    var el = $("#view-" + name);
    if (el) el.classList.remove("hidden");
  }

  function updateNav() {
    var loggedIn = !!state.sessionToken;
    $("#nav-user").classList.toggle("hidden", !loggedIn);
    $("#nav-user").textContent = loggedIn ? state.email : "";
    $("#nav-dashboard-btn").classList.toggle("hidden", !loggedIn);
    $("#nav-logout-btn").classList.toggle("hidden", !loggedIn);
    $("#nav-login-btn").classList.toggle("hidden", loggedIn);
  }

  // ---------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (state.sessionToken) headers["X-HDV-Session"] = state.sessionToken;
    return fetch(apiBase() + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function notice(el, kind, text) {
    el.innerHTML = '<div class="notice notice-' + kind + '">' + escapeHtml(text) + "</div>";
  }

  function clearNotice(el) { el.innerHTML = ""; }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  function initAuthTabs() {
    $all("[data-auth-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.authMode = btn.dataset.authTab;
        $all("[data-auth-tab]").forEach(function (b) { b.classList.toggle("active", b === btn); });
        $("#auth-submit").textContent = state.authMode === "signup" ? "Sign up" : "Log in";
        clearNotice($("#auth-notice"));
      });
    });
  }

  function initAuthForm() {
    $("#auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("#auth-email").value.trim();
      var password = $("#auth-password").value;
      var path = state.authMode === "signup" ? "/v1/auth/signup" : "/v1/auth/login";
      var submitBtn = $("#auth-submit");
      submitBtn.disabled = true;
      clearNotice($("#auth-notice"));

      api(path, { method: "POST", body: { email: email, password: password } }).then(function (res) {
        submitBtn.disabled = false;
        if (!res.ok) {
          var msg = (res.data && res.data.error) || "Something went wrong. Try again.";
          notice($("#auth-notice"), "error", msg);
          return;
        }
        state.sessionToken = res.data.sessionToken;
        state.email = res.data.email;
        save();
        updateNav();
        showView("dashboard");
        loadDashboard();
      }).catch(function () {
        submitBtn.disabled = false;
        notice($("#auth-notice"), "error", "Couldn't reach the server. Check your connection and try again.");
      });
    });
  }

  function logout() {
    if (state.sessionToken) {
      api("/v1/auth/logout", { method: "POST" }).catch(function () {});
    }
    clearSession();
    updateNav();
    showView("home");
  }

  // ---------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------

  var VERIFICATION_BADGE = {
    unverified: ["badge-unverified", "Unverified"],
    pending: ["badge-pending", "Pending"],
    verified: ["badge-verified", "Verified"]
  };

  function setVerificationBadge(status) {
    var entry = VERIFICATION_BADGE[status] || VERIFICATION_BADGE.unverified;
    var el = $("#stat-verification");
    el.className = "badge " + entry[0];
    el.textContent = entry[1];
  }

  function loadDashboard() {
    if (!state.sessionToken) return;
    api("/v1/creator/earnings").then(function (res) {
      if (res.status === 401) { logout(); return; }
      if (!res.ok) return;
      $("#stat-balance").textContent = "$" + Number(res.data.accruedUsd || 0).toFixed(2);
      setVerificationBadge(res.data.verificationStatus);
      renderVerificationBlock(res.data.verificationStatus);
    });
  }

  function renderVerificationBlock(status) {
    var el = $("#verification-status-block");
    if (status === "verified") {
      el.innerHTML = '<div class="notice notice-success">You\'re verified. Payouts are available whenever real payment processing is turned on for this platform.</div>';
      $("#btn-start-verification").classList.add("hidden");
    } else if (status === "pending") {
      el.innerHTML = '<div class="notice notice-info">Verification requested — this platform hasn\'t turned on real identity checks yet, so this stays pending for now. Nothing you need to do.</div>';
    } else {
      el.innerHTML = "";
    }
  }

  function initProfileForm() {
    $("#profile-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var displayName = $("#p-display-name").value.trim();
      var bio = $("#p-bio").value.trim();
      if (!displayName) return;
      api("/v1/creator/apply", { method: "POST", body: { displayName: displayName, bio: bio || undefined } })
        .then(function (res) {
          if (res.status === 401) { logout(); return; }
          if (!res.ok) {
            notice($("#dashboard-notice"), "error", (res.data && res.data.error) || "Couldn't save your profile.");
            return;
          }
          notice($("#dashboard-notice"), "success", "Profile saved.");
        });
    });
  }

  function initPersonaForm() {
    $("#persona-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var personaId = $("#pr-id").value.trim();
      var displayName = $("#pr-display-name").value.trim();
      var description = $("#pr-description").value.trim();
      var photos = $("#pr-photos").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      var scans = $("#pr-scans").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!personaId || !displayName) return;

      api("/v1/creator/persona", {
        method: "POST",
        body: { personaId: personaId, displayName: displayName, description: description || undefined, referencePhotoUrls: photos, scanUrls: scans }
      }).then(function (res) {
        if (res.status === 401) { logout(); return; }
        if (res.status === 409) {
          notice($("#dashboard-notice"), "error", "That persona ID is already taken by another creator — pick a different one.");
          return;
        }
        if (!res.ok) {
          notice($("#dashboard-notice"), "error", (res.data && res.data.error) || "Couldn't save your persona.");
          return;
        }
        notice($("#dashboard-notice"), "success", "Persona saved.");
      });
    });
  }

  function initVerificationButton() {
    $("#btn-start-verification").addEventListener("click", function () {
      var btn = $("#btn-start-verification");
      btn.disabled = true;
      api("/v1/creator/verification", { method: "POST" }).then(function (res) {
        btn.disabled = false;
        if (res.status === 401) { logout(); return; }
        if (res.status === 503) {
          notice($("#dashboard-notice"), "info", "Identity verification isn't turned on for this platform yet.");
          return;
        }
        if (!res.ok) {
          notice($("#dashboard-notice"), "error", (res.data && res.data.error) || "Couldn't start verification.");
          return;
        }
        var v = res.data.verification || {};
        if (v.url) {
          window.open(v.url, "_blank", "noopener");
        }
        loadDashboard();
      });
    });
  }

  function initPayoutForm() {
    $("#payout-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var amount = Number($("#payout-amount").value);
      if (!(amount > 0)) return;
      var btn = $("#btn-request-payout");
      btn.disabled = true;
      clearNotice($("#payout-notice"));

      api("/v1/creator/payout", { method: "POST", body: { amountUsd: amount } }).then(function (res) {
        btn.disabled = false;
        if (res.status === 401) { logout(); return; }
        if (res.status === 403) {
          notice($("#payout-notice"), "info", "Payouts aren't available until you're verified" +
            (res.data && res.data.code === "not_verified" ? " and this platform has real payment processing turned on." : "."));
          return;
        }
        if (!res.ok) {
          notice($("#payout-notice"), "error", (res.data && res.data.error) || "Couldn't process that payout request.");
          return;
        }
        notice($("#payout-notice"), "success", "Payout requested.");
        loadDashboard();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Nav + boot
  // ---------------------------------------------------------------------

  function initNav() {
    $all("[data-view]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        var v = el.dataset.view;
        if (v === "dashboard" && !state.sessionToken) v = "auth";
        showView(v);
        if (v === "dashboard") loadDashboard();
      });
    });
    $("#nav-logout-btn").addEventListener("click", logout);
  }

  function boot() {
    load();
    initNav();
    initAuthTabs();
    initAuthForm();
    initProfileForm();
    initPersonaForm();
    initVerificationButton();
    initPayoutForm();
    updateNav();

    if (state.sessionToken) {
      // Verify the stored session is still good before dropping the user straight into the
      // dashboard — an expired/invalid token falls back to the home view instead of a broken
      // dashboard full of 401s.
      api("/v1/auth/me").then(function (res) {
        if (!res.ok) { clearSession(); updateNav(); showView("home"); return; }
        showView("dashboard");
        loadDashboard();
      });
    } else {
      showView("home");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

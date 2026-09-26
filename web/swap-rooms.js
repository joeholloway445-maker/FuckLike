(function () {
  "use strict";

  var SWAP_API = "http://127.0.0.1:8765";
  var ROOMS_KEY = "fucklike_rooms_v1";
  var APP_KEY = "fucklike_v1";

  var SHELLS = [
    { id: "velvet-bedroom", name: "Velvet Bedroom", vibe: "private", capacity: 4, nodes: ["bed", "mirror", "chaise", "window"], line: "Low light, rumpled sheets, a mirror that sees everything." },
    { id: "afterhours-club", name: "Afterhours Club", vibe: "public", capacity: 12, nodes: ["booth", "bar", "dance-floor", "vip-rope"], line: "Bass, bottle service, and a booth that locks." },
    { id: "mirror-dungeon", name: "Mirror Dungeon", vibe: "private", capacity: 4, nodes: ["cross", "bench", "chain-point", "mirror-wall"], line: "Action nodes, not cartoon props. Unreal lights the steel." },
    { id: "glass-penthouse", name: "Glass Penthouse", vibe: "private", capacity: 6, nodes: ["sofa", "floor-window", "bar-cart", "bed"], line: "City glow on skin. Nobody downstairs can hear you." },
    { id: "temple-bath", name: "Temple Bath", vibe: "private", capacity: 4, nodes: ["pool-edge", "stone-bench", "steam", "altar"], line: "Wet stone, brass, and a room that feels older than the building." },
    { id: "neon-motel", name: "Neon Motel", vibe: "private", capacity: 2, nodes: ["bed", "bathroom-door", "neon-window", "chair"], line: "One bed. Bad carpet. Perfect for a secret." },
    { id: "rooftop", name: "Rooftop", vibe: "public", capacity: 10, nodes: ["ledge", "lounge", "fire-pit", "dj-table"], line: "Wind, city, and whoever you let up the stairs." },
    { id: "dressing-room", name: "Dressing Room", vibe: "private", capacity: 3, nodes: ["vanity", "rack", "stool", "full-mirror"], line: "Outfit changes, eye contact, and the lock on the door." }
  ];

  var POSES = [
    { id: "stand", label: "Stand", adult: false },
    { id: "sit", label: "Sit", adult: false },
    { id: "lean", label: "Lean", adult: false },
    { id: "dance", label: "Dance", adult: false },
    { id: "kneel", label: "Kneel", adult: true },
    { id: "pin", label: "Against the wall", adult: true },
    { id: "straddle", label: "Straddle", adult: true }
  ];

  function $(sel) { return document.querySelector(sel); }
  function loadRooms() {
    try { return JSON.parse(localStorage.getItem(ROOMS_KEY)) || blankRooms(); }
    catch (e) { return blankRooms(); }
  }
  function blankRooms() {
    return { owned: [], activeId: null, streamUrl: "http://127.0.0.1:8888" };
  }
  function saveRooms(data) { localStorage.setItem(ROOMS_KEY, JSON.stringify(data)); }
  function companions() {
    try {
      var app = JSON.parse(localStorage.getItem(APP_KEY) || "{}");
      return app.companions || [];
    } catch (e) { return []; }
  }
  function nsfwOn() {
    try {
      var app = JSON.parse(localStorage.getItem(APP_KEY) || "{}");
      return !app.settings || app.settings.nsfw !== false;
    } catch (e) { return true; }
  }
  function shellById(id) {
    return SHELLS.filter(function (s) { return s.id === id; })[0];
  }
  function uid() { return "r_" + Math.random().toString(36).slice(2, 10); }

  function renderShells() {
    var box = $("#room-shells");
    if (!box) return;
    box.innerHTML = SHELLS.map(function (s) {
      return '<div class="shell-card"><div class="name">' + s.name + '</div>' +
        '<div class="vibe">' + s.vibe + " · " + s.capacity + " slots · " + s.line + '</div>' +
        '<button class="btn btn-secondary" style="margin-top:0.45rem" data-shell="' + s.id + '">Create this room</button></div>';
    }).join("");
    box.querySelectorAll("[data-shell]").forEach(function (btn) {
      btn.onclick = function () { createRoom(btn.getAttribute("data-shell")); };
    });
  }

  function createRoom(shellId) {
    var shell = shellById(shellId);
    if (!shell) return;
    var data = loadRooms();
    var furniture = {};
    shell.nodes.forEach(function (n) { furniture[n] = n === shell.nodes[0]; });
    var room = {
      id: uid(),
      shell: shell.id,
      name: shell.name,
      visibility: shell.vibe === "public" ? "public" : "private",
      capacity: shell.capacity,
      furniture: furniture,
      occupants: [],
      poses: {},
      chat: [{ from: "room", text: "Room opened. Unreal stream is optional — lobby works either way.", t: Date.now() }]
    };
    data.owned.unshift(room);
    data.activeId = room.id;
    saveRooms(data);
    renderRooms();
  }

  function renderRooms() {
    var data = loadRooms();
    var list = $("#room-list");
    if (!list) return;
    if (!data.owned.length) {
      list.innerHTML = '<p class="muted">No rooms yet. Pick a shell.</p>';
    } else {
      list.innerHTML = data.owned.map(function (r) {
        var shell = shellById(r.shell);
        return '<button class="room-item' + (r.id === data.activeId ? " active" : "") + '" data-room="' + r.id + '">' +
          '<div class="name">' + r.name + '</div><div class="vibe">' +
          (r.visibility || "private") + " · " + ((shell && shell.name) || r.shell) + '</div></button>';
      }).join("");
      list.querySelectorAll("[data-room]").forEach(function (btn) {
        btn.onclick = function () {
          var d = loadRooms();
          d.activeId = btn.getAttribute("data-room");
          saveRooms(d);
          renderRooms();
        };
      });
    }
    renderStage(data);
    var url = $("#room-stream-url");
    if (url && document.activeElement !== url) url.value = data.streamUrl || "http://127.0.0.1:8888";
  }

  function activeRoom(data) {
    return (data.owned || []).filter(function (r) { return r.id === data.activeId; })[0];
  }

  function renderStage(data) {
    var stage = $("#room-stage");
    var dock = $("#room-dock");
    var status = $("#room-stream-status");
    if (!stage || !dock) return;
    var room = activeRoom(data);
    if (!room) {
      stage.innerHTML = '<h3>No room open</h3><p class="stage-note">Create a shell. When PeriliminalSpace_UE5 is running, this stage becomes the Unreal pixel stream. Until then you still own the room, the furniture nodes, and the chat.</p>';
      dock.innerHTML = '<p class="muted">Enter a room to place furniture, invite a companion, and run poses.</p>';
      if (status) status.textContent = "Unreal stream not attached.";
      return;
    }
    var shell = shellById(room.shell) || { name: room.shell, line: "", nodes: [] };
    var placed = Object.keys(room.furniture || {}).filter(function (k) { return room.furniture[k]; });
    stage.innerHTML =
      '<h3>' + room.name + '</h3>' +
      '<p class="stage-note">' + shell.line + '</p>' +
      '<p class="stage-note">Graphics path: Unreal 5 · PeriliminalSpace_UE5 · Lumen / Nanite. This lobby is the IMVU-style control surface, not the final render.</p>' +
      '<p class="stage-note">Placed: ' + (placed.join(", ") || "nothing yet") + '</p>';
    if (status) {
      status.textContent = "Stream target " + (data.streamUrl || "http://127.0.0.1:8888") +
        ". Start Launch_Periliminal_Game.bat in PeriliminalSpace_UE5, then hit Launch Unreal room.";
    }
    dock.innerHTML = dockHtml(room);
    bindDock(room);
  }

  function dockHtml(room) {
    var shell = shellById(room.shell) || { nodes: [] };
    var comps = companions();
    var furniture = shell.nodes.map(function (n) {
      var on = room.furniture && room.furniture[n];
      return '<button type="button" class="chip' + (on ? " on" : "") + '" data-furn="' + n + '">' + n + '</button>';
    }).join("");
    var inviteOpts = '<option value="">Invite companion…</option>' + comps.map(function (c) {
      return '<option value="' + c.id + '">' + c.name + '</option>';
    }).join("");
    var occ = (room.occupants || []).map(function (id) {
      var c = comps.filter(function (x) { return x.id === id; })[0];
      var name = c ? c.name : id;
      var pose = (room.poses && room.poses[id]) || "stand";
      var poseBtns = POSES.filter(function (p) { return !p.adult || nsfwOn(); }).map(function (p) {
        return '<button type="button" class="chip' + (pose === p.id ? " on" : "") + '" data-pose="' + p.id + '" data-who="' + id + '">' + p.label + '</button>';
      }).join("");
      return '<div class="occ-item"><div class="name">' + name + '</div><div class="row">' + poseBtns +
        '</div><button type="button" class="btn btn-ghost" data-boot="' + id + '">Boot</button></div>';
    }).join("") || '<p class="muted">Nobody in the room.</p>';
    var chat = (room.chat || []).slice(-12).map(function (line) {
      return '<div class="line"><span class="who">' + line.from + '</span> ' + line.text + '</div>';
    }).join("");
    return '<h3>Room card</h3>' +
      '<label class="dev-field">Name<input id="room-name" value="' + escapeAttr(room.name) + '" /></label>' +
      '<div class="row"><button type="button" class="chip' + (room.visibility !== "public" ? " on" : "") + '" id="vis-private">Private</button>' +
      '<button type="button" class="chip' + (room.visibility === "public" ? " on" : "") + '" id="vis-public">Public</button></div>' +
      '<h3>Furniture nodes</h3><div class="row">' + furniture + '</div>' +
      '<h3>Who\'s here</h3>' + occ +
      '<select id="room-invite">' + inviteOpts + '</select>' +
      '<h3>Room chat</h3><div class="room-chat" id="room-chat">' + chat + '</div>' +
      '<form id="room-chat-form" class="chat-input"><input id="room-chat-text" placeholder="Say it in the room…" autocomplete="off" /><button class="btn btn-primary" type="submit">Send</button></form>';
  }

  function escapeAttr(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function patchRoom(mutator) {
    var data = loadRooms();
    var room = activeRoom(data);
    if (!room) return;
    mutator(room);
    saveRooms(data);
    renderRooms();
  }

  function bindDock(room) {
    var name = $("#room-name");
    if (name) name.onchange = function () { patchRoom(function (r) { r.name = name.value.slice(0, 40) || r.name; }); };
    var priv = $("#vis-private");
    var pub = $("#vis-public");
    if (priv) priv.onclick = function () { patchRoom(function (r) { r.visibility = "private"; }); };
    if (pub) pub.onclick = function () { patchRoom(function (r) { r.visibility = "public"; }); };
    document.querySelectorAll("[data-furn]").forEach(function (btn) {
      btn.onclick = function () {
        var key = btn.getAttribute("data-furn");
        patchRoom(function (r) { r.furniture[key] = !r.furniture[key]; });
      };
    });
    var invite = $("#room-invite");
    if (invite) invite.onchange = function () {
      var id = invite.value;
      if (!id) return;
      patchRoom(function (r) {
        if (r.occupants.indexOf(id) === -1 && r.occupants.length < r.capacity) {
          r.occupants.push(id);
          r.poses[id] = "stand";
          var c = companions().filter(function (x) { return x.id === id; })[0];
          r.chat.push({ from: "room", text: (c ? c.name : "Someone") + " walked in.", t: Date.now() });
        }
      });
    };
    document.querySelectorAll("[data-pose]").forEach(function (btn) {
      btn.onclick = function () {
        patchRoom(function (r) { r.poses[btn.getAttribute("data-who")] = btn.getAttribute("data-pose"); });
      };
    });
    document.querySelectorAll("[data-boot]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-boot");
        patchRoom(function (r) {
          r.occupants = r.occupants.filter(function (x) { return x !== id; });
          delete r.poses[id];
        });
      };
    });
    var form = $("#room-chat-form");
    if (form) form.onsubmit = function (e) {
      e.preventDefault();
      var input = $("#room-chat-text");
      var text = (input.value || "").trim();
      if (!text) return;
      patchRoom(function (r) { r.chat.push({ from: "you", text: text.slice(0, 280), t: Date.now() }); });
    };
  }

  function launchUnreal() {
    var data = loadRooms();
    var url = ($("#room-stream-url") && $("#room-stream-url").value.trim()) || data.streamUrl || "http://127.0.0.1:8888";
    data.streamUrl = url;
    saveRooms(data);
    var status = $("#room-stream-status");
    if (status) {
      status.textContent = "Opening " + url + ". If it is blank, run Launch_Periliminal_Game.bat in PeriliminalSpace_UE5 and enable Pixel Streaming. The room lobby stays live either way.";
    }
    window.open(url, "fucklike-unreal");
  }

  function setSwapHealth(ok, text) {
    var el = $("#swap-health");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
    el.classList.toggle("bad", !ok);
  }

  function swapReady() {
    var face = $("#swap-face");
    var target = $("#swap-target");
    var adult = $("#swap-adult");
    var consent = $("#swap-consent");
    var btn = $("#swap-go");
    if (!btn) return;
    var filesOk = face && face.files && face.files[0] && target && target.files && target.files[0];
    var flags = adult && adult.checked && consent && consent.checked;
    btn.disabled = !(window.__flSwapOnline && filesOk && flags);
  }

  function checkSwap() {
    fetch(SWAP_API + "/health", { method: "GET" }).then(function (res) {
      return res.json().then(function (data) {
        window.__flSwapOnline = !!(res.ok);
        var gpu = (data && data.gpu) ? " · " + data.gpu : "";
        var cuda = data && data.cuda ? "CUDA up" : "worker answered, CUDA not confirmed";
        setSwapHealth(true, "5080 worker online · " + cuda + gpu);
        swapReady();
      });
    }).catch(function () {
      window.__flSwapOnline = false;
      setSwapHealth(false, "5080 worker offline. Start local-swap/api.py on this PC, then come back. Swap stays locked until it answers.");
      swapReady();
    });
  }

  function initSwap() {
    ["swap-face", "swap-target", "swap-adult", "swap-consent"].forEach(function (id) {
      var el = $("#" + id);
      if (el) el.addEventListener("change", swapReady);
    });
    var form = $("#swap-form");
    if (!form) return;
    form.onsubmit = function (e) {
      e.preventDefault();
      if (!window.__flSwapOnline) return;
      var body = new FormData();
      body.append("consent", "true");
      body.append("adult", "true");
      body.append("enhance", "true");
      body.append("keep_audio", "true");
      body.append("source_face", $("#swap-face").files[0]);
      body.append("target", $("#swap-target").files[0]);
      var status = $("#swap-status");
      var result = $("#swap-result");
      status.textContent = "Sending to the 5080…";
      result.innerHTML = "";
      fetch(SWAP_API + "/v1/swap", { method: "POST", body: body }).then(function (res) {
        return res.json().then(function (data) { return { res: res, data: data }; });
      }).then(function (pack) {
        if (!pack.res.ok) throw new Error((pack.data && pack.data.detail) || "swap rejected");
        pollSwap(pack.data.job_id, 0);
      }).catch(function (err) {
        status.textContent = "Swap failed: " + err.message;
      });
    };
  }

  function pollSwap(jobId, n) {
    var status = $("#swap-status");
    var result = $("#swap-result");
    fetch(SWAP_API + "/v1/swap/" + jobId).then(function (res) { return res.json(); }).then(function (job) {
      if (job.status === "done" && job.output_path) {
        status.textContent = "Done.";
        var url = SWAP_API + "/v1/swap/" + jobId + "/file";
        var isVideo = /\.(mp4|webm|mov|gif)$/i.test(job.output_path || "");
        result.innerHTML = isVideo
          ? '<video src="' + url + '" controls autoplay loop></video>'
          : '<img src="' + url + '" alt="swap result" />';
        return;
      }
      if (job.status === "error" || job.error) {
        status.textContent = job.error || "Worker error.";
        return;
      }
      if (n > 40) {
        status.textContent = "Still running. Check the worker log.";
        return;
      }
      status.textContent = "Working… " + (job.status || "queued");
      setTimeout(function () { pollSwap(jobId, n + 1); }, 1500);
    }).catch(function () {
      status.textContent = "Lost the worker mid-swap.";
    });
  }

  function init() {
    renderShells();
    renderRooms();
    initSwap();
    checkSwap();
    var launch = $("#btn-launch-unreal");
    if (launch) launch.onclick = launchUnreal;
    var url = $("#room-stream-url");
    if (url) url.onchange = function () {
      var data = loadRooms();
      data.streamUrl = url.value.trim() || data.streamUrl;
      saveRooms(data);
    };
    document.querySelectorAll('[data-view="swap"]').forEach(function (el) {
      el.addEventListener("click", function () { setTimeout(checkSwap, 50); });
    });
    document.querySelectorAll('[data-view="rooms"]').forEach(function (el) {
      el.addEventListener("click", function () { setTimeout(renderRooms, 50); });
    });
    setInterval(function () {
      var swapView = $("#view-swap");
      if (swapView && !swapView.classList.contains("hidden")) checkSwap();
    }, 8000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

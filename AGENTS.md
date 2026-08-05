# FuckLike — Agent / AI Handoff

This repo is the **FuckLike companion product** front door + deploy path.

The full system is intentionally split so another AI (or human) can pick it up and run.

## What this repo contains

| Path | Purpose |
|------|---------|
| `web/` | Working companion web app (create, gallery, chat, settings). Pure static HTML/JS/CSS. No build step. |
| `docs/ARCHITECTURE.md` | Full system map (Companion Core, Spatial/Godot, LingBot Infinity, Haptics opt-in, Backend Brain, Google Colab) |
| `DEPLOY.md` | Exact steps to put backend + frontend live on Hostinger KVM4 |

## Related repos (owner: joeholloway445-maker)

These are the rest of the stack. Connect them; do not re-invent.

| Repo | Role |
|------|------|
| `HDV_Foundation` | Real multi-agent backend (HOPE / DREAM / VISION / KNOLL / APEX), gateway, orchestrator, deploy scripts for Hostinger |
| `hdv-orchestrator` | Apex-controlled 20,480-node topology service |
| `hdv-agent-core` | Hierarchical agent core with one-way memory |
| `FuckLike-Godot-PeriHuman` | Godot 4 client (3D spaces, companions, teledildonics hooks) |
| `gspot` | Godot 4 plugin for buttplug.io (haptics) |
| `godot-multiplayer` | Multiplayer + VOIP template |
| `godot4-third-person-controller` | Movement (use this, not shooter controls) |
| `tps-demo` | High-quality lighting/environment — **strip combat**, keep visuals |
| `mistral-APEX-Nodes` | Inference / persona models |
| `lingbot-world` | World model (LingBot Infinity direction) |

## Product rules (do not violate)

1. **Everything ships together** — no “phase 2 later” for core features.
2. **Haptics / teledildonics / haptic suits are strictly opt-in.** Default = OFF. Nothing is locked behind hardware.
3. User can create companions, chat, use images/voice, enter 3D spaces, and use LingBot environments **with zero hardware**.
4. Prefer ownership: run brain on the user’s Hostinger KVM4. Use free/cheap compute (Ollama local, Google Colab free GPU) for what is not owned.
5. No placeholder buttons on the main path. If it’s in the UI, it must do something.

## Current web app behavior

- File: `web/index.html` + `web/app.js` + `web/styles.css`
- Works offline immediately (open `index.html` or serve the folder).
- Age gate → Home → Gallery / Create / Chat / Settings.
- Companions and settings persist in `localStorage`.
- Chat uses local personality replies until `API_BASE` is set.
- In `web/app.js` near the top:

```js
const API_BASE = "";  // set to "https://api.fucklike.ai" when gateway is live
```

## How another AI should proceed

### Goal A — Make the public site real (recommended first)

1. Follow `DEPLOY.md` on the Hostinger KVM4.
2. Clone/run `HDV_Foundation` as the API (`api.fucklike.ai`).
3. Serve `web/` as `fucklike.ai`.
4. Set `API_BASE` in `app.js` to the live gateway. **Already wired** — `app.js` calls
   `POST /v1/companion/chat` (not `/v1/intent`; that endpoint is HOPE's task-routing/governance
   surface, not a persona chat surface — see `HDV_Foundation/companion/`) and falls back to the
   local personality pool on any network failure/timeout, so chat degrades gracefully instead of
   breaking. No frontend code changes needed to go live — only the `API_BASE` value.

### Goal B — Spatial / 3D

1. Start from `FuckLike-Godot-PeriHuman` + `godot4-third-person-controller`.
2. Pull lighting/environment from `tps-demo` (remove all combat).
3. Wire WebSocket to the running HDV gateway.
4. Attach `gspot` only behind the same opt-in Settings flag used in the web app.

### Goal C — World model + GPU

1. LingBot Infinity / `lingbot-world` for continuous environment state.
2. Google Colab for GPU burst (LingBot, heavy image/video, large personas).
3. Orchestrate Colab jobs from the backend; do not require Colab for basic chat.

### Goal D — Inference without paid lock-in

- Prefer Ollama (or similar) on the KVM4 for default chat.
- Fall back to Colab or a cheap OpenAI-compatible endpoint only when needed.
- Keep the provider behind the existing HDV provider seam so it stays swappable.

## Environment / tools expected

- Node 22+
- Git
- Hostinger KVM4 (Ubuntu) — user already has this
- Caddy (or nginx) for HTTPS
- Optional: Docker, Ollama, Google Colab, Godot 4.x
- Domains: `fucklike.ai`, `fucklike.me`, `api.fucklike.ai` (DNS must point at the VPS)

## Non-goals / do not do

- Do not require hardware for any core feature.
- Do not leave “coming soon” on primary CTAs.
- Do not put secrets in the repo.
- Do not assume SSH access — produce copy-paste commands for the owner.
- Do not rename HOPE / DREAM / VISION / KNOLL / APEX (system architecture names).

## Quick local test (no server)

```bash
cd web
python3 -m http.server 8080
# open http://localhost:8080
```

Age-gate → create a companion → chat. All local.

## Source of truth

- Product architecture: `docs/ARCHITECTURE.md`
- Go-live steps: `DEPLOY.md`
- This file: how an AI or collaborator should continue without re-deriving the plan.

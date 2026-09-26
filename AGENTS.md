# FuckLike — Agent / AI Handoff

This repo is the **FuckLike companion product** front door + deploy path.

The full system is intentionally split so another AI (or human) can pick it up and run.

## What this repo contains

| Path | Purpose |
|------|---------|
| `web/` | Companion web app. Includes Rooms + Swap (`web/swap-rooms.js`). |
| `docs/ARCHITECTURE.md` | System map |
| `docs/FACE_SWAP_LOCAL.md` | Local RTX 5080 FaceFusion spec |
| `docs/ROOMS_UE5.md` | IMVU-style rooms, Unreal graphics path |
| `docs/ANTIGRAVITY_TASK.md` | Copy-paste task for Google Antigravity |
| `local-swap/` | FaceFusion wrapper + FastAPI. Do not vendor FaceFusion. |
| `DEPLOY.md` | Hostinger KVM4 go-live |
| `.agents/skills/face-swap-local/SKILL.md` | Swap skill |
| `.agents/skills/rooms-unreal/SKILL.md` | Rooms skill |

## Related repos (owner: joeholloway445-maker)

| Repo | Role |
|------|------|
| `HDV_Foundation` | Multi-agent backend (HOPE / DREAM / VISION / KNOLL / APEX) |
| `hdv-orchestrator` | Apex-controlled topology service |
| `hdv-agent-core` | Hierarchical agent core |
| `PeriliminalSpace_UE5` | **Room renderer.** Unreal 5.8. This is the graphics path for rooms. |
| `FuckLike-Godot-PeriHuman` | Optional lightweight client. Not the room graphics path. |
| `gspot` | Godot buttplug.io plugin |
| `godot-multiplayer` | Multiplayer + VOIP template |
| `godot4-third-person-controller` | Movement reference |
| `tps-demo` | Lighting reference only if borrowing ideas. Do not make this the room client. |
| `mistral-APEX-Nodes` | Inference / persona models |
| `lingbot-world` | World model |

## Product rules (do not violate)

1. Everything ships together.
2. Haptics are strictly opt-in. Default OFF.
3. Core loops work with zero extra hardware. Rooms lobby works with Unreal offline.
4. Own the stack. Face swap stays on the local RTX 5080. Do not send faces to SaaS swappers.
5. No dead primary buttons.
6. Adult content is first-class. Age gate + consent. No cloud NSFW classifier on swaps or room poses.
7. **Rooms are IMVU-type social spaces rendered in Unreal.** Do not rebuild them as a Godot scene and call it done.

## How another AI should proceed

### Goal A — Public site
Follow `DEPLOY.md`. Gateway is `HDV_Foundation`. Chat already calls `POST /v1/companion/chat`.

### Goal B — Spatial / rooms (CURRENT, with Goal E)
Read `docs/ROOMS_UE5.md`.

Web lobby is already in `web/` (shells, furniture nodes, public/private, invite, poses, room chat, Launch Unreal).

Engine work belongs in `PeriliminalSpace_UE5`:
- One level per shell id
- Action nodes matching furniture ids
- Pixel Streaming on `http://127.0.0.1:8888` by default
- At least `velvet-bedroom` walkable, with the bed node driven by the lobby

Godot is optional and secondary. Do not spend this pass porting rooms into Godot.

### Goal C — World model
LingBot / `lingbot-world`. Not required for the first room.

### Goal D — Inference
Ollama on the KVM4 for chat. Swappable provider seam.

### Goal E — Local RTX 5080 face swap
Swap **panel is already in `web/`**. Do not build a second one.

Finish the worker:
- FaceFusion 3.9.x official repo, CUDA + TensorRT
- `local-swap/facefusion_wrapper.py` + install scripts
- API already on `127.0.0.1:8765` with CORS for localhost
- Panel unlocks when `/health` answers

## Environment

- Local: Windows 11 or Linux, RTX 5080, CUDA 12.8/12.9, FFmpeg, Unreal 5.8 for `PeriliminalSpace_UE5`
- Hostinger KVM4 for the public brain
- Domains: `fucklike.ai`, `api.fucklike.ai`

## Do not

- Vendor FaceFusion weights
- Send faces to Clothoff / DeepSwap / FaceSwapper.ai
- Train DeepFaceLab in this pass
- Rename HOPE / DREAM / VISION / KNOLL / APEX
- Treat the CSS stage as the final room render
- Build a new Unreal project. Extend `PeriliminalSpace_UE5`.

## Quick local test

```bash
cd web
python3 -m http.server 8080
```

Age-gate → Rooms → create Velvet Bedroom → invite a companion → pose. Swap stays locked until `python local-swap/api.py` is up.

## Source of truth

- Rooms: `docs/ROOMS_UE5.md`
- Swap: `docs/FACE_SWAP_LOCAL.md`
- Antigravity prompt: `docs/ANTIGRAVITY_TASK.md`

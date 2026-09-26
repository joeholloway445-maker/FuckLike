# Antigravity task — paste this into the agent

Repos:
- `joeholloway445-maker/FuckLike` (lobby, swap API, specs)
- `joeholloway445-maker/PeriliminalSpace_UE5` (room renderer)

Read `AGENTS.md`, `docs/FACE_SWAP_LOCAL.md`, `docs/ROOMS_UE5.md`, `.agents/skills/face-swap-local/SKILL.md`, `.agents/skills/rooms-unreal/SKILL.md`.

Do not create a new repo. Do not create a new Unreal project.

---

## 1. Finish the 5080 face swap worker

The Swap panel already exists in `web/index.html` + `web/swap-rooms.js`. Do not build a second panel.

Finish `local-swap/`:
- `install_windows.ps1` and `install_linux.sh` for official FaceFusion 3.9.x+, conda Python 3.12, CUDA 12.8/12.9 + TensorRT
- `facefusion_wrapper.py` CLI adapter. Do not copy FaceFusion source into git.
- Keep FastAPI on `127.0.0.1:8765`. CORS for localhost is already on.
- `/health` must report cuda true on the RTX 5080
- One image swap must write a file the existing Swap panel can display
- Require `adult=true` and `consent=true`. No pixel NSFW blocker.

## 2. IMVU-style rooms, Unreal graphics

Web lobby is already live: shells, furniture nodes, public/private, invite, poses, room chat, Launch Unreal. It persists in `localStorage` `fucklike_rooms_v1`. Keep it working with the engine offline.

In `PeriliminalSpace_UE5`:
- Add a FuckLike room map for shell id `velvet-bedroom` first, then the other shell ids in `web/swap-rooms.js`
- Action nodes named to match furniture ids (`bed`, `mirror`, `chaise`, `window`, …)
- Pixel Streaming so `http://127.0.0.1:8888` is the real render the Rooms panel opens
- A localhost bridge so placing the bed in the lobby shows/moves the bed in the level
- Lumen + Nanite. This is the quality bar. Do not ship a Godot room and call it the graphics path.
- Avatars can start as mannequins. Face-swapped portraits are a later texture source.

Adult poses in private rooms are allowed. No cloud classifier on poses.

## Constraints

- No secrets in git
- No FaceFusion weights in git
- No SaaS face swap
- No DeepFaceLab training this pass
- Do not rename HOPE / DREAM / VISION / KNOLL / APEX
- Do not rebuild the Swap or Rooms web UI from scratch

When finished, update `local-swap/README.md` with the exact 5080 commands and CUDA pins you used, and note the UE5 map path for `velvet-bedroom`.

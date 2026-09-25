# Antigravity task — paste this into the agent

Repo: `joeholloway445-maker/FuckLike` (this repo).
Read `AGENTS.md`, `docs/FACE_SWAP_LOCAL.md`, and `.agents/skills/face-swap-local/SKILL.md` first. Then execute Goal E.

---

Build the local uncensored face-swap workstation for FuckLike on the owner's NVIDIA RTX 5080.

Do not create a new repo. Work in this one.

Implement `local-swap/`:
- `install_windows.ps1` and `install_linux.sh` that clone official FaceFusion 3.9.x+, set up conda Python 3.12, CUDA 12.8/12.9 + TensorRT per current FaceFusion docs, and verify CUDA providers.
- `facefusion_wrapper.py` that calls FaceFusion CLI (do not copy FaceFusion source into git).
- FastAPI `api.py` on `127.0.0.1:8765` with `/health`, `POST /v1/swap`, `GET /v1/swap/{job_id}`, `GET /v1/swap/{job_id}/file`.
- Require `adult=true` and `consent=true`. No pixel NSFW blocker.
- `settings.example.json`, `requirements.txt`, `local-swap/README.md`.
- `.gitignore` entries for `settings.json`, `models/`, outputs, conda, FaceFusion clone.

Wire `web/` with a real Swap panel:
- Source face + target image/video upload or path.
- Calls the local API.
- Shows job status and result.
- If `/health` fails, disable the button and say the 5080 worker is offline.
- Keep the existing age gate. Do not invent placeholder CTAs.

Constraints:
- No secrets in git.
- No FaceFusion weights in git.
- No third-party SaaS face swap.
- Do not train DeepFaceLab in this pass.
- Do not rename HOPE / DREAM / VISION / KNOLL / APEX.
- Prefer ownership and localhost.

When finished, update `local-swap/README.md` with the exact commands the owner should run on the 5080 PC, and note any CUDA version pins you actually used.

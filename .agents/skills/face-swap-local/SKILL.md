# Skill: FuckLike local FaceFusion swap

Use this skill whenever the task is local face swap, FaceFusion, RTX 5080, uncensored swap, or Goal E.

## Intent

Stand up a local FaceFusion worker + FuckLike wrapper API + Swap UI. Adult content is allowed. Cloud swap sites are forbidden.

## Read first

- `AGENTS.md` Goal E
- `docs/FACE_SWAP_LOCAL.md`
- `docs/ANTIGRAVITY_TASK.md`
- existing `web/app.js` patterns (age gate, no dead buttons)
- `colab/generation_router.py` only as a future routing seam

## Hard rules

1. Official FaceFusion repo only. No “unlocked NSFW pack” mirrors.
2. Do not vendor engine source or ONNX weights.
3. Bind API to 127.0.0.1.
4. Require adult + consent flags.
5. Verify CUDA on the 5080; fail loud if `torch.cuda.is_available()` is false.
6. Keep install scripts copy-pasteable.
7. Match existing FuckLike naming and static `web/` style.

## Implementation order

1. `.gitignore` + example settings + README
2. Wrapper around FaceFusion CLI
3. FastAPI job queue (in-memory is fine for v1)
4. Windows install script (primary), Linux script (secondary)
5. Swap UI in `web/`
6. Smoke-test notes in README

## Done checks

- `/health` reports cuda
- one image swap produces a file
- UI works when worker up and fails honestly when down

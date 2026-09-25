# FuckLike — Local Face Swap Workstation (RTX 5080)

Uncensored, local-only face swap for adult companion media. Runs on the owner's NVIDIA RTX 5080. No SaaS. No content classifier that rejects explicit targets.

## Decision

| Item | Choice |
|------|--------|
| Engine | FaceFusion official repo, 3.9.x+ |
| Accel | CUDA + TensorRT |
| GPU | NVIDIA RTX 5080 |
| OS | Windows 11 primary, Linux secondary |
| API | FastAPI on `127.0.0.1:8765` |
| UI | New Swap panel in `web/` |
| Privacy | Media never leaves the workstation |
| Filters | None on adult content. Age 18+ gate + consent attestation required |

Do not vendor FaceFusion. Clone it next to the repo or into `%USERPROFILE%\.fucklike\facefusion` and call its CLI.

Official sources only:
- https://github.com/facefusion/facefusion
- https://docs.facefusion.io
- Windows CUDA notes: https://docs.facefusion.io/installation/accelerator/windows

## Why FaceFusion first

One-shot image + video, maintained, GUI + CLI, 50-series CUDA path exists, no per-identity training. DeepFaceLab stays a later optional backend for long trained clips. Rope / Roop-Unleashed stay optional. ComfyUI ReActor stays optional if Comfy is already installed.

## Layout

```
local-swap/
  README.md
  requirements.txt
  api.py                 # FastAPI job server
  facefusion_wrapper.py  # CLI / subprocess adapter
  settings.example.json
  install_windows.ps1
  install_linux.sh
web/
  ...existing files + Swap UI wired to localhost:8765
```

## API contract

`GET /health`
```json
{
  "ok": true,
  "engine": "facefusion",
  "cuda": true,
  "tensorrt": true,
  "gpu": "NVIDIA GeForce RTX 5080",
  "facefusion_path": "C:\\Users\\...\\.fucklike\\facefusion"
}
```

`POST /v1/swap` multipart or JSON-with-paths:
- `source_face`: image file or absolute path (the face to plant)
- `target`: image or video file or absolute path (the body / clip)
- `output_dir`: optional, default `%USERPROFILE%/.fucklike/swaps`
- `enhance`: bool, default true (GFPGAN or FaceFusion face enhancer)
- `keep_audio`: bool, default true for video
- `consent`: must be `true`
- `adult`: must be `true`

Returns `{ "job_id": "...", "status": "queued" }`.

`GET /v1/swap/{job_id}` → `queued | running | done | error` plus output path and log tail.

`GET /v1/swap/{job_id}/file` streams the result for the local web UI.

Reject the request if `consent` or `adult` is missing/false. Do not scan pixels for nudity.

## Install expectations (Windows)

`install_windows.ps1` must:
1. Check `nvidia-smi` and refuse to continue if no NVIDIA GPU.
2. Ensure Git, FFmpeg, Miniconda/conda exist or print exact download links.
3. Create conda env `fucklike-swap` with Python 3.12.
4. Install CUDA runtime 12.9.x + cuDNN as FaceFusion docs specify at time of implement.
5. Clone FaceFusion (not a random “unlocked pack”).
6. Install FaceFusion deps with CUDA + TensorRT providers.
7. Verify:
   - `python -c "import torch; print(torch.cuda.is_available())"`
   - onnxruntime providers include `CUDAExecutionProvider`
   - FaceFusion reports `cuda` (and `tensorrt` if the wheel installed)
8. Write `local-swap/settings.json` from the example.

Never commit `settings.json`, models, or output media.

## Quality defaults

- Prefer high-res swapper + face enhancer on.
- Execution providers: `tensorrt` then `cuda` then `cpu`.
- Thread count: leave a sensible default; 5080 has headroom.
- Video: preserve audio. Cap first milestone videos at a documented length if VRAM/temp disk needs it, but do not silently watermark.

## Integration with existing FuckLike compute

Existing path: `colab/generation_router.py` → A1111 or Prodia, plus `scripts/generation_queue.sql`.

Add a third backend conceptually:

```
explicit face swap + local worker healthy → local-swap API
explicit image gen → A1111
low-explicit fallback → Prodia
```

Do not make Colab or Hostinger a dependency for swap. The 5080 box is the worker.

## Safety (keep this thin and real)

- 18+ age gate already exists in `web/`.
- API requires `adult=true` and `consent=true`.
- README must say: only use faces you own or have explicit permission to edit. Non-consensual intimate imagery is illegal.
- No celebrity-hunt helpers. No “scrape her IG” tools.

## Done when

1. `install_windows.ps1` runs on a clean-enough 5080 box and produces a working FaceFusion CLI.
2. `python local-swap/api.py` serves `/health` with `cuda: true`.
3. One test image swap writes a file under the output dir.
4. `web/` Swap panel can pick source + target, hit the local API, and show/download the result when the worker is up.
5. Worker down → panel says so. No fake success.
6. README in `local-swap/` is copy-pasteable by a human who is not an ML engineer.

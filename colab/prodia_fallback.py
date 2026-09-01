# %% [markdown]
# # FuckLike — Prodia API Fallback
# $0.001/generation. Always-on cloud. No GPU required.
# Used when RunPod pod is cold or explicit_level < 2.
# Get key at: https://app.prodia.com/api

# %%
import os, time, requests
from pathlib import Path

PRODIA_KEY = os.environ.get("PRODIA_API_KEY", "")
PRODIA_BASE = "https://api.prodia.com/v1"

# Best NSFW-tolerant model on Prodia (as of mid-2025)
# Check https://app.prodia.com/api for current model list
PRODIA_MODEL = "dreamshaper_8.safetensors"

PRODIA_POSITIVE = (
    "photorealistic selfie, pov looking down at own chest, neck cropped out, "
    "{body_type} body type, {skin_tone} skin, {outfit}, {background}, "
    "ring light, DSLR photo, 4k, hyperrealistic, soft warm lighting"
)

PRODIA_NEGATIVE = (
    "face, head, hair at top of frame, cartoon, anime, blurry, deformed, "
    "watermark, text, logo, ugly, low quality"
)


def prodia_generate(spec: dict, output_dir: str) -> list[str]:
    """Generate images via Prodia API. Returns saved file paths."""
    if not PRODIA_KEY:
        raise RuntimeError("PRODIA_API_KEY not set")

    os.makedirs(output_dir, exist_ok=True)
    n = spec.get("count", 4)
    base_seed = spec.get("seed", 42)
    paths = []

    pos = PRODIA_POSITIVE.format(
        body_type=spec.get("body_type", "slim hourglass"),
        skin_tone=spec.get("skin_tone", "fair"),
        outfit=spec.get("outfit", "matching lace lingerie set"),
        background=spec.get("background", "cozy bedroom, unmade white sheets, fairy lights"),
    )
    neg = PRODIA_NEGATIVE
    if spec.get("extra_negative"):
        neg += ", " + spec["extra_negative"]

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "X-Prodia-Key": PRODIA_KEY,
    }

    for i in range(n):
        seed = base_seed + i

        # Submit job
        job_resp = requests.post(
            f"{PRODIA_BASE}/sd/generate",
            json={
                "model": PRODIA_MODEL,
                "prompt": pos,
                "negative_prompt": neg,
                "steps": 25,
                "cfg_scale": 7,
                "seed": seed,
                "width": 768,
                "height": 1024,
                "sampler": "DPM++ 2M Karras",
            },
            headers=headers,
            timeout=30,
        )
        job_resp.raise_for_status()
        job_id = job_resp.json().get("job")

        # Poll until done (usually 15-30s)
        for _ in range(60):
            time.sleep(3)
            status_resp = requests.get(
                f"{PRODIA_BASE}/job/{job_id}",
                headers=headers,
                timeout=15,
            )
            status_resp.raise_for_status()
            status_data = status_resp.json()
            if status_data.get("status") == "succeeded":
                image_url = status_data["imageUrl"]
                break
            if status_data.get("status") == "failed":
                raise RuntimeError(f"Prodia job {job_id} failed")
        else:
            raise RuntimeError(f"Prodia job {job_id} timed out")

        # Download image
        img_resp = requests.get(image_url, timeout=30)
        img_resp.raise_for_status()
        path = os.path.join(output_dir, f"selfie_{seed:08d}.jpg")
        with open(path, "wb") as f:
            f.write(img_resp.content)
        paths.append(path)
        print(f"  prodia: saved {path}")

    return paths

# %% [markdown]
# # FuckLike — A1111 REST API Backend
# Works identically on Colab (via ngrok) or RunPod persistent pod.
# Replaces the diffusers direct-load approach with A1111's /sdapi/v1/txt2img endpoint.

# %%
import os, base64, time, json, requests
from pathlib import Path

# A1111 base URL — set to RunPod pod URL in production, localhost on Colab
A1111_BASE = os.environ.get("A1111_URL", "http://127.0.0.1:7860")

# Top NSFW-capable models (must be installed on A1111 instance)
NSFW_MODELS = {
    "pony":    "ponyDiffusionV6XL_v6StartWithThisOne.safetensors",
    "epick":   "epiCRealismXL.safetensors",
    "illust":  "illustriousXL_v01.safetensors",
    "realvis": "RealVisXL_V4.0.safetensors",  # default / fallback
}

DEFAULT_MODEL = os.environ.get("NSFW_MODEL", "pony")

# %%
BASE_POSITIVE = (
    "score_9, score_8_up, score_7_up, "   # Pony booster tags
    "photorealistic selfie, pov looking down at own chest, neck cropped out, "
    "{body_type} body type, {skin_tone} skin, {outfit}, {background}, "
    "ring light reflection, DSLR photo, 4k, hyperrealistic, detailed skin texture, natural shadows, "
    "solo, 1girl"
)

BASE_NEGATIVE = (
    "score_1, score_2, score_3, "
    "face, head, hair at top of frame, cartoon, anime, painting, "
    "blurry, deformed, extra limbs, missing limbs, bad anatomy, "
    "watermark, text, logo, ugly, low quality, grayscale"
)

EXPLICIT_LORAS = {
    0: "",                               # SFW
    1: "",                               # tasteful
    2: "<lora:add_detail_xl:0.4>",       # suggestive
    3: "<lora:add_detail_xl:0.6>",       # explicit — swap for content-specific LoRA
}

def build_prompt(spec: dict) -> tuple[str, str]:
    pos = BASE_POSITIVE.format(
        body_type=spec.get("body_type", "slim hourglass"),
        skin_tone=spec.get("skin_tone", "fair"),
        outfit=spec.get("outfit", "matching lace lingerie set"),
        background=spec.get("background", "cozy bedroom, unmade white sheets, fairy lights"),
    )
    lora = EXPLICIT_LORAS.get(spec.get("explicit_level", 2), "")
    if lora:
        pos = pos + ", " + lora
    if spec.get("extra_positive"):
        pos = pos + ", " + spec["extra_positive"]

    neg = BASE_NEGATIVE
    if spec.get("extra_negative"):
        neg = neg + ", " + spec["extra_negative"]
    return pos, neg

# %%
def wait_for_a1111(timeout: int = 120):
    """Block until A1111 is accepting requests."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{A1111_BASE}/sdapi/v1/sd-models", timeout=5)
            if r.status_code == 200:
                print("A1111 ready")
                return True
        except Exception:
            pass
        time.sleep(3)
    raise RuntimeError(f"A1111 not ready after {timeout}s at {A1111_BASE}")

def set_model(model_key: str):
    model_name = NSFW_MODELS.get(model_key, NSFW_MODELS["realvis"])
    payload = {"sd_model_checkpoint": model_name}
    requests.post(f"{A1111_BASE}/sdapi/v1/options", json=payload, timeout=60)
    print(f"Model set: {model_name}")

# %%
def generate_images_a1111(spec: dict, output_dir: str) -> list[str]:
    """Call A1111 txt2img for each image in spec. Returns saved file paths."""
    os.makedirs(output_dir, exist_ok=True)
    pos, neg = build_prompt(spec)
    n = spec.get("count", 4)
    base_seed = spec.get("seed", 42)
    paths = []

    for i in range(n):
        seed = base_seed + i
        payload = {
            "prompt": pos,
            "negative_prompt": neg,
            "seed": seed,
            "steps": 28,
            "cfg_scale": 7.0,
            "width": 768,
            "height": 1024,
            "sampler_name": "DPM++ 2M Karras",
            "batch_size": 1,
            "n_iter": 1,
            "save_images": False,
            "send_images": True,
        }

        resp = requests.post(
            f"{A1111_BASE}/sdapi/v1/txt2img",
            json=payload,
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()

        img_b64 = data["images"][0]
        img_bytes = base64.b64decode(img_b64.split(",", 1)[-1] if "," in img_b64 else img_b64)

        path = os.path.join(output_dir, f"selfie_{seed:08d}.jpg")
        with open(path, "wb") as f:
            f.write(img_bytes)
        paths.append(path)
        print(f"  saved {path}")

    return paths

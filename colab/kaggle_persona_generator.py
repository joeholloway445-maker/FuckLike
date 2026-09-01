# %% [markdown]
# # FuckLike / Periliminal — Kaggle SFW + Game Asset Generator
# Run this as a Kaggle Notebook (Settings -> Accelerator -> GPU T4 x2 or P100).
# Kaggle gives 30 free GPU-hours/week, sessions up to 12h — this is the SFW /
# game-material channel (Colab free tier covers the rest of that rotation).
# NSFW generation is handled separately by the Perchance pipeline.
#
# Add SUPABASE_URL / SUPABASE_SERVICE_KEY / NGROK_AUTH_TOKEN as Kaggle Secrets
# (Add-ons -> Secrets) rather than hardcoding them.

# %%
# !pip install -q diffusers transformers accelerate fastapi uvicorn pyngrok Pillow supabase google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client

# %%
from kaggle_secrets import UserSecretsClient
import os

secrets = UserSecretsClient()
for key in ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "NGROK_AUTH_TOKEN"]:
    try:
        os.environ[key] = secrets.get_secret(key)
    except Exception:
        print(f"Secret {key} not set — skipping")

# %% [markdown]
# ## Model — SFW-safe checkpoint
# Use a general-purpose photoreal/illustration model here, NOT the NSFW
# checkpoints from the A1111/RunPod path. This channel serves:
#   - Periliminal game reference art (races, environments, UI concept art)
#   - FuckLike SFW/marketing imagery (app store safe, landing page assets)

# %%
import torch
from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler

MODEL_ID = os.environ.get("SFW_MODEL_ID", "stabilityai/stable-diffusion-xl-base-1.0")

pipe = StableDiffusionXLPipeline.from_pretrained(
    MODEL_ID, torch_dtype=torch.float16, use_safetensors=True, variant="fp16",
)
pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
pipe = pipe.to("cuda")

print("SFW model loaded:", MODEL_ID)

# %%
def generate_sfw_images(spec: dict, output_dir: str) -> list[str]:
    """Generate N images for a game-asset or SFW marketing spec."""
    os.makedirs(output_dir, exist_ok=True)
    prompt = spec["prompt"]
    negative = spec.get("negative_prompt", "blurry, deformed, watermark, text, low quality, ugly")
    n = spec.get("count", 4)
    base_seed = spec.get("seed", 42)
    paths = []

    for i in range(n):
        seed = base_seed + i
        generator = torch.Generator(device="cuda").manual_seed(seed)
        result = pipe(
            prompt=prompt, negative_prompt=negative,
            num_inference_steps=30, guidance_scale=7.5,
            width=spec.get("width", 1024), height=spec.get("height", 1024),
            generator=generator,
        )
        path = os.path.join(output_dir, f"sfw_{seed:08d}.png")
        result.images[0].save(path, "PNG")
        paths.append(path)
        print(f"  generated {path}")

    return paths

# %% [markdown]
# ## Supabase metadata + FastAPI + ngrok — same contract as the Colab A1111 router
# so Apps Script / n8n can hit this exactly like the other channels, just
# pointed at project="periliminal" or category="marketing" for FuckLike SFW.

# %%
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn, threading
from pyngrok import ngrok

class SFWRequest(BaseModel):
    project: str = "periliminal"          # "periliminal" | "fucklike"
    category: str = "reference_art"        # "reference_art" | "marketing" | "ui" | "environment"
    prompt: str
    negative_prompt: str = ""
    count: int = 4
    seed: int = 42
    width: int = 1024
    height: int = 1024

app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True, "service": "kaggle-sfw-generator", "model": MODEL_ID}

@app.post("/generate")
def generate(req: SFWRequest):
    spec = req.dict()
    tmp_dir = f"/tmp/sfw_{req.project}_{req.category}"

    try:
        paths = generate_sfw_images(spec, tmp_dir)
    except Exception as e:
        raise HTTPException(500, str(e))

    results = []
    if os.environ.get("SUPABASE_URL"):
        from supabase import create_client
        sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
        for path in paths:
            fname = os.path.basename(path)
            # Storage upload handled by whichever service ingests /tmp output —
            # Kaggle notebooks have no persistent storage, so this writes metadata
            # pointing at a local path the poller/n8n step downloads before the
            # session ends. Swap for direct Supabase Storage upload if preferred.
            sb.table("image_assets").insert({
                "project": req.project, "category": req.category,
                "bucket": f"{req.project}-assets", "storage_path": f"{req.category}/{fname}",
                "filename": fname, "explicit_level": 0, "metadata": spec,
            }).execute()
            results.append({"filename": fname, "path": path})
    else:
        results = [{"filename": os.path.basename(p), "path": p} for p in paths]

    return {"ok": True, "generated": len(results), "files": results}

# %%
NGROK_TOKEN = os.environ.get("NGROK_AUTH_TOKEN", "")
if NGROK_TOKEN:
    ngrok.set_auth_token(NGROK_TOKEN)

public_url = ngrok.connect(8000)
print("=" * 60)
print("KAGGLE SFW GENERATOR URL:", public_url)
print("Paste into n8n / Apps Script as the SFW channel endpoint")
print("=" * 60)

threading.Thread(target=lambda: uvicorn.run(app, host="0.0.0.0", port=8000), daemon=True).start()
print("Kaggle SFW generator running (session lasts up to 12h, 30h/week free)")

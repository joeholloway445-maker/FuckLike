# %% [markdown]
# # FuckLike Persona Image Generator
# Headless selfie batch generator for FuckLike personas.
# Run all cells top to bottom. Copy the ngrok URL into your Apps Script trigger.

# %% [markdown]
# ## 1. Install dependencies

# %%
# !pip install -q diffusers transformers accelerate xformers fastapi uvicorn pyngrok Pillow google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client supabase

# %% [markdown]
# ## 2. Authenticate Google Drive

# %%
from google.colab import auth
auth.authenticate_user()

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import os, json, io

drive_service = build("drive", "v3")

PERSONAS_FOLDER_ID = "1M_2W9sND3dAZdfyX61xZUpUvBCPePuFb"  # fucklike/personas/ in HDV Assets

def get_or_create_folder(name: str, parent_id: str) -> str:
    q = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and '{parent_id}' in parents and trashed=false"
    results = drive_service.files().list(q=q, fields="files(id)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]
    meta = {"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]}
    folder = drive_service.files().create(body=meta, fields="id").execute()
    return folder["id"]

def upload_image_to_drive(image_path: str, filename: str, folder_id: str) -> str:
    meta = {"name": filename, "parents": [folder_id]}
    media = MediaFileUpload(image_path, mimetype="image/jpeg")
    f = drive_service.files().create(body=meta, media_body=media, fields="id,webViewLink").execute()
    return f["id"]

print("Drive ready")

# %% [markdown]
# ## 3. Load model

# %%
import torch
from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler

MODEL_ID = "SG161222/RealVisXL_V4.0"

pipe = StableDiffusionXLPipeline.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.float16,
    use_safetensors=True,
    variant="fp16",
)
pipe.scheduler = DPMSolverMultistepScheduler.from_config(
    pipe.scheduler.config,
    use_karras_sigmas=True,
)
pipe = pipe.to("cuda")
pipe.enable_xformers_memory_efficient_attention()

print("Model loaded:", MODEL_ID)

# %% [markdown]
# ## 4. Prompt builder

# %%
BASE_POSITIVE = (
    "photorealistic selfie, looking down at own body, neck cropped out of frame, "
    "{body_type} body type, {skin_tone} skin, {outfit}, "
    "{background}, soft warm lighting, ring light reflection, "
    "DSLR photo, 4k, hyperrealistic, detailed skin texture, natural shadows"
)

BASE_NEGATIVE = (
    "face, head, hair visible at top of frame, cartoon, anime, painting, "
    "blurry, deformed, extra limbs, missing limbs, bad anatomy, "
    "watermark, text, logo, ugly, low quality"
)

def build_prompt(spec: dict) -> tuple[str, str]:
    pos = BASE_POSITIVE.format(
        body_type=spec.get("body_type", "slim hourglass"),
        skin_tone=spec.get("skin_tone", "fair"),
        outfit=spec.get("outfit", "matching lace lingerie set"),
        background=spec.get("background", "cozy bedroom, unmade white sheets, fairy lights"),
    )
    neg = BASE_NEGATIVE
    if spec.get("extra_negative"):
        neg = neg + ", " + spec["extra_negative"]
    return pos, neg

# %%
def generate_persona_images(spec: dict, output_dir: str) -> list[str]:
    """Generate N images for a persona spec. Returns list of saved file paths."""
    os.makedirs(output_dir, exist_ok=True)
    pos, neg = build_prompt(spec)
    n = spec.get("count", 4)
    base_seed = spec.get("seed", 42)
    paths = []

    for i in range(n):
        seed = base_seed + i
        generator = torch.Generator(device="cuda").manual_seed(seed)
        result = pipe(
            prompt=pos,
            negative_prompt=neg,
            num_inference_steps=25,
            guidance_scale=7.0,
            width=768,
            height=1024,
            generator=generator,
        )
        img = result.images[0]
        path = os.path.join(output_dir, f"selfie_{seed:08d}.jpg")
        img.save(path, "JPEG", quality=92)
        paths.append(path)
        print(f"  generated {path}")

    return paths

# %% [markdown]
# ## 5. Supabase metadata writer

# %%
import os
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")   # set as Colab secret
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

def write_metadata(persona_name: str, drive_file_id: str, filename: str, spec: dict):
    if not SUPABASE_URL:
        return
    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    sb.table("image_assets").insert({
        "project": "fucklike",
        "category": "personas",
        "bucket": "fucklike-assets",
        "storage_path": f"personas/{persona_name}/{filename}",
        "filename": filename,
        "drive_file_id": drive_file_id,
        "explicit_level": spec.get("explicit_level", 2),
        "metadata": spec,
    }).execute()

# %% [markdown]
# ## 6. FastAPI server + ngrok

# %%
import asyncio
import threading
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from pyngrok import ngrok

class PersonaRequest(BaseModel):
    name: str                          # persona slug, e.g. "riley"
    body_type: str = "slim hourglass"
    skin_tone: str = "fair"
    outfit: str = "matching lace lingerie set"
    background: str = "cozy bedroom, unmade white sheets, fairy lights"
    count: int = 4                     # images to generate
    seed: int = 42
    explicit_level: int = 2
    extra_negative: str = ""

app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True, "service": "fucklike-persona-generator"}

@app.post("/generate")
async def generate(req: PersonaRequest):
    spec = req.dict()
    persona_slug = req.name.lower().replace(" ", "_")
    tmp_dir = f"/tmp/persona_{persona_slug}"

    # Generate
    try:
        paths = generate_persona_images(spec, tmp_dir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Upload to Drive
    folder_id = get_or_create_folder(persona_slug, PERSONAS_FOLDER_ID)
    results = []
    for path in paths:
        fname = os.path.basename(path)
        drive_id = upload_image_to_drive(path, fname, folder_id)
        write_metadata(persona_slug, drive_id, fname, spec)
        results.append({"filename": fname, "drive_id": drive_id})
        os.remove(path)

    return {"ok": True, "persona": persona_slug, "generated": len(results), "files": results}

@app.post("/batch")
async def batch(personas: list[PersonaRequest]):
    results = []
    for p in personas:
        r = await generate(p)
        results.append(r)
    return {"ok": True, "total": len(results), "results": results}

# %%
# Set your ngrok auth token (get free one at ngrok.com)
NGROK_TOKEN = ""   # paste your token here or set as Colab secret

if NGROK_TOKEN:
    ngrok.set_auth_token(NGROK_TOKEN)

public_url = ngrok.connect(8000)
print("=" * 60)
print("GENERATOR URL:", public_url)
print("Paste this into your Apps Script COLAB_URL variable")
print("=" * 60)

def run():
    uvicorn.run(app, host="0.0.0.0", port=8000)

thread = threading.Thread(target=run, daemon=True)
thread.start()

# %% [markdown]
# ## 7. Optional: run a quick local test (no Apps Script needed)

# %%
test_spec = PersonaRequest(
    name="riley",
    body_type="slim hourglass",
    skin_tone="light tan",
    outfit="white cotton crop top, no bra, denim shorts",
    background="sun-lit bathroom mirror, marble countertop",
    count=2,
    seed=1001,
)
# import asyncio; asyncio.run(generate(test_spec))  # uncomment to test

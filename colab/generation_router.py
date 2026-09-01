# %% [markdown]
# # FuckLike — Generation Router
# Unified FastAPI server that routes requests to:
#   1. A1111 REST API (RunPod persistent pod or Colab localhost)
#   2. Prodia API (cloud fallback, always-on, low-explicit only)
# Replaces persona_generator.py's embedded diffusers pipeline.
# Handles live queue polling in a background thread.

# %%
import os, threading, time
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from pyngrok import ngrok

# Import backends
from a1111_backend import generate_images_a1111, wait_for_a1111, set_model, DEFAULT_MODEL
from prodia_fallback import prodia_generate, PRODIA_KEY
from body_archetypes import match_archetype, get_archetype_images

# Import Drive helpers from persona_generator (run that cell block first)
# from persona_generator import get_or_create_folder, upload_image_to_drive, write_metadata, PERSONAS_FOLDER_ID

# %%
PERSONAS_FOLDER_ID = os.environ.get("PERSONAS_FOLDER_ID", "1M_2W9sND3dAZdfyX61xZUpUvBCPePuFb")
USE_A1111 = os.environ.get("USE_A1111", "true").lower() == "true"

def smart_generate(spec: dict, output_dir: str) -> list[str]:
    """
    Route generation request to best available backend.
    Explicit level >= 2 → A1111 (unrestricted GPU).
    Explicit level < 2 or A1111 unavailable → Prodia.
    """
    explicit = spec.get("explicit_level", 2)

    if USE_A1111 and explicit >= 1:
        try:
            return generate_images_a1111(spec, output_dir)
        except Exception as e:
            print(f"A1111 failed ({e}), falling back to Prodia")

    if PRODIA_KEY and explicit <= 2:
        return prodia_generate(spec, output_dir)

    raise RuntimeError("No generation backend available. Set A1111_URL or PRODIA_API_KEY.")


# %%
class PersonaRequest(BaseModel):
    name: str
    body_type: str = "slim hourglass"
    skin_tone: str = "fair"
    outfit: str = "matching lace lingerie set"
    background: str = "cozy bedroom, unmade white sheets, fairy lights"
    count: int = 4
    seed: int = 42
    explicit_level: int = 2
    extra_positive: str = ""
    extra_negative: str = ""

app = FastAPI(title="FuckLike Persona Generator")

@app.get("/health")
def health():
    return {"ok": True, "a1111_mode": USE_A1111, "prodia_mode": bool(PRODIA_KEY)}

@app.get("/archetypes/{archetype_id}")
def get_archetype(archetype_id: str):
    """Return pre-generated Drive IDs for an archetype."""
    ids = get_archetype_images(archetype_id)
    if not ids:
        raise HTTPException(404, f"Archetype {archetype_id} not yet generated")
    return {"archetype_id": archetype_id, "drive_file_ids": ids}

@app.post("/match_archetype")
def match(req: PersonaRequest):
    """Instantly assign a persona to their closest archetype."""
    archetype_id = match_archetype(req.dict())
    if not archetype_id:
        return {"ok": False, "reason": "no archetypes generated yet"}
    ids = get_archetype_images(archetype_id)
    return {"ok": True, "archetype_id": archetype_id, "drive_file_ids": ids}

@app.post("/generate")
async def generate(req: PersonaRequest):
    spec = req.dict()
    persona_slug = req.name.lower().replace(" ", "_")
    tmp_dir = f"/tmp/persona_{persona_slug}"

    # Serve archetype immediately while custom generation runs
    archetype_id = match_archetype(spec)

    try:
        paths = smart_generate(spec, tmp_dir)
    except Exception as e:
        raise HTTPException(500, str(e))

    # Upload to Drive — must have Drive service initialized
    from persona_generator import get_or_create_folder, upload_image_to_drive, write_metadata
    folder_id = get_or_create_folder(persona_slug, PERSONAS_FOLDER_ID)
    results = []
    for path in paths:
        import os as _os
        fname = _os.path.basename(path)
        drive_id = upload_image_to_drive(path, fname, folder_id)
        write_metadata(persona_slug, drive_id, fname, spec)
        results.append({"filename": fname, "drive_id": drive_id})
        _os.remove(path)

    return {
        "ok": True,
        "persona": persona_slug,
        "generated": len(results),
        "files": results,
        "archetype_placeholder": archetype_id,
    }

@app.post("/batch")
async def batch(personas: list[PersonaRequest]):
    results = []
    for p in personas:
        r = await generate(p)
        results.append(r)
    return {"ok": True, "total": len(results), "results": results}


# %%
# Background queue poller (Supabase generation_queue)
def poll_queue(interval_seconds: int = 20):
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not supabase_url or not supabase_key:
        print("Queue poller disabled — set SUPABASE_URL + SUPABASE_SERVICE_KEY")
        return

    from supabase import create_client
    from persona_generator import get_or_create_folder, upload_image_to_drive, write_metadata

    sb = create_client(supabase_url, supabase_key)
    print(f"Queue poller started ({interval_seconds}s interval)")

    while True:
        try:
            rows = (
                sb.table("generation_queue")
                .select("*")
                .eq("status", "pending")
                .order("created_at")
                .limit(1)
                .execute()
            )
            if not rows.data:
                time.sleep(interval_seconds)
                continue

            row = rows.data[0]
            row_id, spec, persona_name = row["id"], row["spec"], row["persona_name"]

            sb.table("generation_queue").update({
                "status": "processing", "started_at": "now()",
            }).eq("id", row_id).execute()

            print(f"Queue: processing {row_id} ({persona_name})")

            try:
                tmp_dir = f"/tmp/queue_{row_id}"
                paths = smart_generate(spec, tmp_dir)
                folder_id = get_or_create_folder(persona_name, PERSONAS_FOLDER_ID)
                drive_ids = []
                for path in paths:
                    fname = __import__("os").path.basename(path)
                    drive_id = upload_image_to_drive(path, fname, folder_id)
                    write_metadata(persona_name, drive_id, fname, spec)
                    drive_ids.append(drive_id)
                    __import__("os").remove(path)

                sb.table("generation_queue").update({
                    "status": "done",
                    "drive_file_ids": drive_ids,
                    "finished_at": "now()",
                }).eq("id", row_id).execute()
                print(f"Queue: done {persona_name} — {len(drive_ids)} images")

            except Exception as e:
                sb.table("generation_queue").update({
                    "status": "error",
                    "error_msg": str(e),
                    "finished_at": "now()",
                }).eq("id", row_id).execute()
                print(f"Queue: error {row_id}: {e}")

        except Exception as e:
            print(f"Poller error: {e}")
            time.sleep(5)

        time.sleep(interval_seconds)


# %%
# Start background queue thread
poller_thread = threading.Thread(target=poll_queue, kwargs={"interval_seconds": 20}, daemon=True)
poller_thread.start()

# Start ngrok + server
NGROK_TOKEN = os.environ.get("NGROK_AUTH_TOKEN", "")
if NGROK_TOKEN:
    ngrok.set_auth_token(NGROK_TOKEN)

public_url = ngrok.connect(8000)
print("=" * 60)
print("GENERATOR URL:", public_url)
print("Paste into Apps Script COLAB_URL")
print("=" * 60)

def _run():
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

threading.Thread(target=_run, daemon=True).start()
print("Server running")

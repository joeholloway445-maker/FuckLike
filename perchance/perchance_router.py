"""
FuckLike — Perchance Orchestrator

Standalone FastAPI service for the NSFW channel. n8n (or any orchestrator)
calls this over HTTP — no custom n8n node needed, just HTTP Request nodes
hitting these endpoints. See ../n8n/fucklike_perchance_workflow.json for a
ready-to-import workflow.

Flow per persona request:
  1. Generate `count` images via Perchance (perchance_automation)
  2. Run every image through the QC gate (quality_check)
  3. Auto-retry failed images with a bumped seed, up to MAX_RETRIES rounds
  4. Anything still failing after retries goes to needs_review instead of
     being silently dropped or silently accepted
  5. Passing images upload to Drive + Supabase, same schema as the A1111 path

Run standalone:
    uvicorn perchance_router:app --host 0.0.0.0 --port 8100
"""

import os
import shutil
import asyncio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.concurrency import run_in_threadpool

from perchance_automation import generate_batch_sync
from quality_check import filter_batch

MAX_RETRIES = int(os.environ.get("PERCHANCE_MAX_RETRIES", "2"))
PERSONAS_FOLDER_ID = os.environ.get("PERSONAS_FOLDER_ID", "1M_2W9sND3dAZdfyX61xZUpUvBCPePuFb")

app = FastAPI(title="FuckLike Perchance NSFW Orchestrator")


class PersonaRequest(BaseModel):
    name: str
    body_type: str = "slim hourglass"
    skin_tone: str = "fair"
    outfit: str = "matching lace lingerie set"
    background: str = "cozy bedroom, unmade white sheets, fairy lights"
    count: int = 4
    seed: int = 42
    explicit_level: int = 2


@app.get("/health")
def health():
    return {"ok": True, "service": "perchance-orchestrator", "max_retries": MAX_RETRIES}


async def _generate_with_qc(spec: dict, tmp_dir: str) -> tuple[list[str], list[dict]]:
    """Generate spec['count'] images, running QC + retry until satisfied or MAX_RETRIES hit."""
    accepted: list[str] = []
    still_needed = spec.get("count", 4)
    round_seed_offset = 0
    all_rejected: list[dict] = []

    for attempt in range(MAX_RETRIES + 1):
        if still_needed <= 0:
            break

        round_spec = {**spec, "count": still_needed, "seed": spec.get("seed", 42) + round_seed_offset}
        round_dir = os.path.join(tmp_dir, f"round_{attempt}")

        paths = await run_in_threadpool(generate_batch_sync, round_spec, round_dir)
        passed, rejected = await run_in_threadpool(filter_batch, paths)

        accepted.extend(passed)
        all_rejected.extend(rejected)
        still_needed = spec.get("count", 4) - len(accepted)
        round_seed_offset += 1000  # jump seed range so retries don't reproduce the same failure

        if still_needed > 0 and attempt < MAX_RETRIES:
            print(f"  round {attempt}: {len(passed)} passed, {still_needed} still needed — retrying")

    return accepted, all_rejected


@app.post("/generate")
async def generate(req: PersonaRequest):
    spec = req.dict()
    persona_slug = req.name.lower().replace(" ", "_")
    tmp_dir = f"/tmp/perchance_{persona_slug}"

    accepted, rejected = await _generate_with_qc(spec, tmp_dir)

    if not accepted:
        raise HTTPException(500, f"All generations failed QC after {MAX_RETRIES} retries: {rejected}")

    # Upload accepted images to Drive + write Supabase metadata
    from persona_generator import get_or_create_folder, upload_image_to_drive, write_metadata
    folder_id = get_or_create_folder(persona_slug, PERSONAS_FOLDER_ID)
    results = []
    for path in accepted:
        fname = os.path.basename(path)
        drive_id = upload_image_to_drive(path, fname, folder_id)
        write_metadata(persona_slug, drive_id, fname, {**spec, "source": "perchance"})
        results.append({"filename": fname, "drive_id": drive_id})

    needs_review = len(rejected) > 0 and len(accepted) < spec.get("count", 4)

    shutil.rmtree(tmp_dir, ignore_errors=True)

    return {
        "ok": True,
        "persona": persona_slug,
        "requested": spec.get("count", 4),
        "generated": len(results),
        "files": results,
        "rejected_count": len(rejected),
        "rejected_reasons": [r["reason"] for r in rejected],
        "needs_review": needs_review,
    }


@app.post("/batch")
async def batch(personas: list[PersonaRequest]):
    results = []
    for p in personas:
        try:
            r = await generate(p)
        except HTTPException as e:
            r = {"ok": False, "persona": p.name, "error": e.detail}
        results.append(r)
    return {"ok": True, "total": len(results), "results": results}

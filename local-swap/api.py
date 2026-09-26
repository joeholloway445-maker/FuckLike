"""FuckLike local swap API. Antigravity: finish FaceFusion wiring + job runner."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from facefusion_wrapper import SwapJob, run_swap, probe_health

APP_DIR = Path(__file__).resolve().parent
SETTINGS_PATH = APP_DIR / "settings.json"
EXAMPLE_PATH = APP_DIR / "settings.example.json"

JOBS: dict[str, SwapJob] = {}

app = FastAPI(title="FuckLike Local Swap", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_settings() -> dict:
    path = SETTINGS_PATH if SETTINGS_PATH.exists() else EXAMPLE_PATH
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/health")
def health():
    settings = load_settings()
    info = probe_health(settings)
    return JSONResponse(info)


@app.post("/v1/swap")
async def create_swap(
    consent: bool = Form(...),
    adult: bool = Form(...),
    enhance: bool = Form(True),
    keep_audio: bool = Form(True),
    source_face: UploadFile | None = File(None),
    target: UploadFile | None = File(None),
    source_path: str | None = Form(None),
    target_path: str | None = Form(None),
):
    if not consent or not adult:
        raise HTTPException(400, "adult and consent must both be true")

    settings = load_settings()
    job = SwapJob(
        job_id=str(uuid.uuid4()),
        enhance=enhance,
        keep_audio=keep_audio,
        source_path=source_path,
        target_path=target_path,
    )
    JOBS[job.job_id] = job

    try:
        run_swap(job, settings, source_face=source_face, target=target)
    except FileNotFoundError as exc:
        job.status = "error"
        job.error = str(exc)
    except Exception as exc:  # engine not installed yet is expected during scaffold
        job.status = "error"
        job.error = str(exc)

    return {"job_id": job.job_id, "status": job.status, "error": job.error}


@app.get("/v1/swap/{job_id}")
def get_swap(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return job.as_dict()


@app.get("/v1/swap/{job_id}/file")
def get_swap_file(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    if job.status != "done" or not job.output_path:
        raise HTTPException(409, "job not finished")
    path = Path(job.output_path)
    if not path.exists():
        raise HTTPException(404, "output missing")
    return FileResponse(path)


if __name__ == "__main__":
    import uvicorn

    settings = load_settings()
    uvicorn.run(
        "api:app",
        host=settings.get("bind_host", "127.0.0.1"),
        port=int(settings.get("port", 8765)),
        reload=False,
    )

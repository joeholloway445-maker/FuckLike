"""Adapter over official FaceFusion CLI. Fill install detection + subprocess call."""

from __future__ import annotations

import os
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class SwapJob:
    job_id: str
    enhance: bool = True
    keep_audio: bool = True
    source_path: str | None = None
    target_path: str | None = None
    output_path: str | None = None
    status: str = "queued"
    error: str | None = None
    log_tail: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return data


def probe_health(settings: dict) -> dict[str, Any]:
    ff_dir = settings.get("facefusion_dir") or ""
    return {
        "ok": False,
        "engine": "facefusion",
        "cuda": False,
        "tensorrt": False,
        "gpu": os.environ.get("FUCKLIKE_GPU", ""),
        "facefusion_path": ff_dir,
        "facefusion_present": bool(ff_dir and Path(ff_dir).exists()),
        "python": shutil.which("python") or shutil.which("python3"),
        "note": "Scaffold only. Antigravity must implement CUDA probe + FaceFusion CLI.",
    }


def run_swap(job: SwapJob, settings: dict, source_face=None, target=None) -> SwapJob:
    """Persist uploads, then invoke FaceFusion. Currently raises until installed."""
    job.status = "error"
    job.error = (
        "FaceFusion wrapper not implemented yet. "
        "Follow docs/FACE_SWAP_LOCAL.md and finish this function."
    )
    return job

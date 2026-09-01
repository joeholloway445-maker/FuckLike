"""
FuckLike — Image Quality / Abnormality Gate

Two-stage check run on every generated image before it's accepted:

  1. Heuristic pass (free, instant, always runs)
     - blank/black/solid-color frame (failed render, placeholder leaked through)
     - corrupt or truncated file
     - resolution / aspect sanity
     - near-duplicate of the previous image in the batch (stuck seed)

  2. Vision pass (optional, ~$0.003-0.01/image, only runs if heuristics pass)
     - Claude vision call asking specifically about anatomical abnormalities:
       extra/missing limbs, fused fingers, warped proportions, floating
       objects, melted background — the standard SDXL/Perchance failure modes.
     - Skipped entirely if ANTHROPIC_API_KEY is not set; heuristics-only mode
       still catches the worst failures for free.
"""

import os
import io
import base64
import hashlib
from dataclasses import dataclass
from PIL import Image
import numpy as np

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
VISION_MODEL = os.environ.get("QC_VISION_MODEL", "claude-haiku-4-5-20251001")
ENABLE_VISION_QC = bool(ANTHROPIC_API_KEY) and os.environ.get("QC_ENABLE_VISION", "true").lower() == "true"


@dataclass
class QCResult:
    passed: bool
    stage: str          # "heuristic" | "vision" | "pass"
    reason: str
    confidence: float = 1.0


# ---------- Stage 1: heuristics ----------

def _load_image(path: str) -> Image.Image:
    img = Image.open(path)
    img.load()
    return img.convert("RGB")


def _is_blank_or_solid(img: Image.Image, std_threshold: float = 4.0) -> bool:
    """Detect placeholder/failed renders: near-uniform color across the frame."""
    arr = np.asarray(img.resize((64, 64)))
    return float(np.std(arr)) < std_threshold


def _resolution_sane(img: Image.Image, min_dim: int = 384) -> bool:
    w, h = img.size
    return w >= min_dim and h >= min_dim


def _phash(img: Image.Image) -> str:
    """Cheap perceptual hash for duplicate/stuck-seed detection."""
    small = img.resize((8, 8)).convert("L")
    pixels = np.asarray(small).flatten()
    avg = pixels.mean()
    bits = "".join("1" if p > avg else "0" for p in pixels)
    return hashlib.md5(bits.encode()).hexdigest()


def heuristic_check(path: str, prior_hashes: set[str]) -> QCResult:
    try:
        img = _load_image(path)
    except Exception as e:
        return QCResult(False, "heuristic", f"unreadable/corrupt file: {e}")

    if _is_blank_or_solid(img):
        return QCResult(False, "heuristic", "blank or solid-color frame (failed render)")

    if not _resolution_sane(img):
        return QCResult(False, "heuristic", f"resolution too small: {img.size}")

    h = _phash(img)
    if h in prior_hashes:
        return QCResult(False, "heuristic", "near-duplicate of a prior image in this batch (stuck seed)")
    prior_hashes.add(h)

    return QCResult(True, "heuristic", "ok")


# ---------- Stage 2: vision abnormality check ----------

VISION_PROMPT = """You are a QC gate for AI-generated photorealistic selfie images. \
Look at this image and answer ONLY with one line in this exact format:

VERDICT: PASS or FAIL
REASON: <short reason>

Fail the image if you see any of:
- extra or missing limbs, fingers, or fused fingers
- warped, melted, or anatomically impossible body proportions
- a visible face when the image is supposed to be headless/cropped at the neck
- floating disconnected body parts or objects
- garbled or melted background/furniture
- obvious watermark or text artifact

Otherwise PASS. Be reasonably lenient on minor stylistic softness — only fail on \
genuine anatomical or rendering errors a viewer would immediately notice."""


def _image_to_b64(path: str) -> tuple[str, str]:
    img = Image.open(path).convert("RGB")
    img.thumbnail((768, 768))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"


def vision_check(path: str) -> QCResult:
    if not ENABLE_VISION_QC:
        return QCResult(True, "vision", "vision QC disabled (no ANTHROPIC_API_KEY)")

    try:
        import anthropic
    except ImportError:
        return QCResult(True, "vision", "anthropic package not installed, skipping")

    b64, media_type = _image_to_b64(path)
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    try:
        resp = client.messages.create(
            model=VISION_MODEL,
            max_tokens=100,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                    {"type": "text", "text": VISION_PROMPT},
                ],
            }],
        )
        text = resp.content[0].text.strip()
        verdict_line = next((l for l in text.splitlines() if l.upper().startswith("VERDICT")), "VERDICT: PASS")
        reason_line = next((l for l in text.splitlines() if l.upper().startswith("REASON")), "REASON: ok")
        passed = "PASS" in verdict_line.upper()
        reason = reason_line.split(":", 1)[-1].strip()
        return QCResult(passed, "vision", reason)
    except Exception as e:
        # Vision QC failing open (never block the pipeline on an API hiccup)
        return QCResult(True, "vision", f"vision QC error, passing open: {e}")


# ---------- Combined gate ----------

def check_image(path: str, prior_hashes: set[str]) -> QCResult:
    result = heuristic_check(path, prior_hashes)
    if not result.passed:
        return result
    return vision_check(path)


def filter_batch(paths: list[str]) -> tuple[list[str], list[dict]]:
    """
    Run QC across a batch. Returns (passed_paths, rejected_records).
    rejected_records: [{"path": ..., "stage": ..., "reason": ...}]
    """
    prior_hashes: set[str] = set()
    passed, rejected = [], []

    for path in paths:
        result = check_image(path, prior_hashes)
        if result.passed:
            passed.append(path)
        else:
            rejected.append({"path": path, "stage": result.stage, "reason": result.reason})
            print(f"  QC REJECT [{result.stage}]: {os.path.basename(path)} — {result.reason}")

    return passed, rejected

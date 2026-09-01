#!/bin/bash
set -e

# ---- Download NSFW checkpoint if not already present ----
MODEL_DIR="/workspace/stable-diffusion-webui/models/Stable-diffusion"
mkdir -p "$MODEL_DIR"

# Pony Diffusion V6 XL — best all-around NSFW checkpoint
PONY_FILE="$MODEL_DIR/ponyDiffusionV6XL_v6StartWithThisOne.safetensors"
if [ ! -f "$PONY_FILE" ]; then
  echo "Downloading Pony Diffusion V6 XL..."
  # CivitAI direct download — requires CIVITAI_API_KEY env var
  curl -L \
    -H "Authorization: Bearer $CIVITAI_API_KEY" \
    "https://civitai.com/api/download/models/290640" \
    -o "$PONY_FILE"
fi

# epiCRealism XL — photorealistic alternative
EPIC_FILE="$MODEL_DIR/epiCRealismXL.safetensors"
if [ ! -f "$EPIC_FILE" ]; then
  echo "Downloading epiCRealism XL..."
  curl -L \
    -H "Authorization: Bearer $CIVITAI_API_KEY" \
    "https://civitai.com/api/download/models/456538" \
    -o "$EPIC_FILE"
fi

# ---- Start A1111 in background ----
cd /workspace/stable-diffusion-webui
python launch.py \
  --nowebui \
  --api \
  --api-log \
  --listen \
  --port 7860 \
  --no-half-vae \
  --xformers \
  --opt-sdp-attention \
  --cors-allow-origins "*" \
  --ckpt "$PONY_FILE" \
  &

A1111_PID=$!
echo "A1111 PID: $A1111_PID"

# Wait for A1111 to be ready
echo "Waiting for A1111..."
until curl -s http://127.0.0.1:7860/sdapi/v1/sd-models > /dev/null 2>&1; do
  sleep 5
done
echo "A1111 ready"

# ---- Start FuckLike generation router ----
cd /workspace
export A1111_URL="http://127.0.0.1:7860"
export USE_A1111="true"
python -c "
import uvicorn
from generation_router import app
uvicorn.run(app, host='0.0.0.0', port=8000, log_level='info')
" &

echo "All services started. A1111: :7860  Router: :8000"
wait $A1111_PID

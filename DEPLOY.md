# FuckLike — Production Deployment Guide

Two parallel paths exist. Pick one, or run both and let load decide:

- **Paid path (this doc, Steps 1-5)**: RunPod + A1111 + Prodia. Fastest,
  highest quality, ~$1.75/day for 8hr GPU runtime.
- **Free path (`n8n/README.md`)**: Perchance (browser-automated, free NSFW
  generation) for the explicit channel + Kaggle/Colab free GPU tiers for
  SFW/game material, orchestrated by self-hosted n8n with an automated
  quality gate. $0/day, lower throughput and no true "always-hot" GPU.

Both write to the same Drive folders and Supabase `image_assets` /
`generation_queue` tables, so they're interchangeable from the frontend's
point of view — only the `channel` field on a queue row picks the path.

## Architecture — Paid Path

```
RunPod Persistent Pod (RTX 3090, ~$0.22/hr)
├── A1111 WebUI API  :7860   (NSFW generation, Pony Diffusion / epiCRealism XL)
├── Generation Router :8000  (FastAPI — smart routing + queue polling)
│     ├── A1111 backend    → explicit_level >= 1 (GPU required)
│     └── Prodia fallback  → explicit_level 0-1, or A1111 down ($0.001/gen)
│
Google Drive  ← all generated images uploaded here
Supabase      ← metadata + live user generation_queue
Apps Script   ← batch trigger (polls Google Sheet of personas)
```

## Architecture — Free Path

```
n8n (self-hosted, free) — fucklike_batch_trigger_workflow.json
  polls generation_queue every 10 min
        │
        ▼
n8n orchestrator webhook — fucklike_orchestrator_workflow.json
  routes on spec.channel
        │
   ┌────┴────┐
 nsfw       sfw
   │          │
   ▼          ▼
perchance/          colab/kaggle_persona_generator.py
perchance_router.py   (Kaggle 30h/week free T4, or Colab free tier)
  → Playwright-drives      → game reference art (Periliminal)
    perchance.org           → SFW marketing assets (FuckLike)
  → QC gate (heuristic +
    Claude vision) auto-
    retries bad renders
  → needs_review flag on
    persistent failures
```

See `n8n/README.md` for full setup of the free path — this doc covers the
RunPod paid path below.

## Step 1 — RunPod Pod Setup

1. Go to **runpod.io** → New Pod
2. Template: **RunPod Stable Diffusion** (A1111 preinstalled)
3. GPU: RTX 3090 (24GB VRAM, $0.22/hr) or A5000 ($0.16/hr)
4. Storage: 50GB+
5. Set environment variables in RunPod UI:
   ```
   CIVITAI_API_KEY      = your CivitAI API key (free, needed for model download)
   SUPABASE_URL         = your Supabase project URL
   SUPABASE_SERVICE_KEY = service role key (bypasses RLS)
   PRODIA_API_KEY       = your Prodia API key (fallback)
   PERSONAS_FOLDER_ID   = 1M_2W9sND3dAZdfyX61xZUpUvBCPePuFb
   ARCHETYPES_FOLDER_ID = <Drive subfolder for archetypes>
   NSFW_MODEL           = pony   (or: epick / illust / realvis)
   ```
6. Upload `runpod/start.sh` to `/start.sh` and `chmod +x /start.sh`
7. Upload all `colab/*.py` files to `/workspace/`
8. Run `/start.sh` (or set as container start command)
9. Copy the RunPod **public URL** for port 8000 → paste into Apps Script `COLAB_URL`

## Step 2 — Models (via CivitAI)

Get a free API key at https://civitai.com/user/account

| Model | CivitAI ID | Best for |
|-------|-----------|---------|
| Pony Diffusion V6 XL | 290640 | All-around NSFW, anime + realistic |
| epiCRealism XL | 456538 | Photorealistic, SFW+NSFW |
| Illustrious XL | 795765 | Anime-style |

`start.sh` downloads Pony + epiCRealism automatically on first launch.

## Step 3 — Body Archetype Pre-generation

Run once after pod is up to generate 10 base templates:

```python
# In a Colab notebook or RunPod terminal:
import requests
# This hits your pod's router to generate all archetypes
resp = requests.post("http://<POD_URL>:8000/generate_archetypes")
print(resp.json())
```

Or add `generate_all_archetypes(...)` call to `start.sh` after A1111 is ready.

## Step 4 — Apps Script

1. Open **script.google.com** → paste `scripts/apps_script_trigger.js`
2. Set `COLAB_URL = "http://<POD_URL>:8000"` (RunPod public URL)
3. Set a time trigger: **every 10 minutes** → `runBatch()`
4. First run: call `setupSheet()` to create the Personas tab

## Step 5 — Supabase Setup

Run `scripts/generation_queue.sql` in the **catsino-casino** project dashboard
(project: `edoprprqqtvtezexskpr`)

Live user requests hit `POST /queue` on your frontend → insert row into
`generation_queue` → router picks it up within 20 seconds.

## Cost Estimate

| Mode | Cost | Throughput |
|------|------|-----------|
| RunPod RTX 3090 | $0.22/hr | ~4 images/min @ 768×1024 |
| Prodia fallback | $0.001/gen | ~15-30s/image |
| Prodia (100/day) | $0.10/day | Good for non-explicit |
| Perchance (free path) | $0 | ~1 image/30-90s, sequential only |
| Kaggle free GPU | $0 | 30 GPU-hrs/week, 12h/session max |
| Vision QC (Claude Haiku) | ~$0.003-0.01/image | Only runs on images that pass heuristics |

Running 8hr/day on RunPod: **~$1.75/day** for unlimited explicit generation.
Running the free path 24/7: **$0/day** GPU cost, just whatever you pay to
host n8n (a $5/mo VPS covers it, or run it on a machine you already have).

## Switching Between Colab and RunPod

The `generation_router.py` uses `A1111_URL` env var, so:
- **Colab**: `A1111_URL=http://127.0.0.1:7860` (localhost)
- **RunPod**: `A1111_URL=http://<pod-internal>:7860` (already set in start.sh)

The Apps Script only needs the public URL for port 8000.

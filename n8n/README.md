# n8n Orchestration — FuckLike / Periliminal

Self-hosted n8n is free with no execution or workflow limits — the only cost
is wherever you run the container (a $5/mo VPS, or the same box hosting the
Perchance/Kaggle services below). This replaces Apps Script as the 24/7
scheduler and adds a real routing + QC-retry layer in front of generation.

## Two channels, one orchestrator

```
                      ┌─────────────────────────┐
generation_queue  →   │  n8n Batch Trigger        │  (every 10 min, cron, free)
(Supabase)             │  fucklike_batch_trigger  │
                      └───────────┬─────────────┘
                                  │ POST /generate {channel, spec}
                                  ▼
                      ┌─────────────────────────┐
                      │  n8n Orchestrator webhook │
                      │  fucklike_orchestrator    │
                      └──────┬──────────┬─────────┘
                    channel=nsfw    channel=sfw
                             │              │
                             ▼              ▼
                 ┌────────────────┐  ┌──────────────────┐
                 │ Perchance router │  │ Kaggle/Colab A1111 │
                 │ + QC gate +      │  │ SFW generator      │
                 │ auto-retry       │  │ (game + marketing) │
                 └────────────────┘  └──────────────────┘
```

- **NSFW channel** → `perchance/perchance_router.py` — drives the actual
  Perchance generator via Playwright, runs every image through the
  abnormality QC gate (`perchance/quality_check.py`), auto-retries failures
  with a new seed, and flags anything that still fails as `needs_review`
  instead of silently dropping it or silently shipping a bad image.
- **SFW/game-material channel** → whichever of Kaggle (`colab/kaggle_persona_generator.py`)
  or Colab free tier is live that day. Used for Periliminal race/environment
  reference art and FuckLike's SFW marketing assets — no QC gate needed since
  there's no explicit-content risk to catch.

## Setup

1. **Run n8n** (Docker, free):
   ```bash
   docker run -d --name n8n -p 5678:5678 \
     -v n8n_data:/home/node/.n8n \
     -e GENERIC_TIMEZONE="America/Chicago" \
     n8nio/n8n
   ```
   Or deploy on Render/Railway's free/hobby tier — see `render.com/deploy-docker/n8n`.

2. **Set n8n environment variables** (Settings → Variables, or container `-e` flags):
   ```
   SUPABASE_URL              = your Supabase project URL
   SUPABASE_SERVICE_KEY      = service role key
   PERCHANCE_ROUTER_URL      = http://<host>:8100   (perchance_router.py)
   KAGGLE_COLAB_SFW_URL      = <ngrok URL from kaggle_persona_generator.py>
   N8N_SELF_WEBHOOK_URL      = http://localhost:5678/webhook/generate  (this n8n instance)
   REVIEW_ALERT_WEBHOOK_URL  = wherever you want needs_review pings (Slack webhook, Discord, etc.)
   ```

3. **Import both workflows** (n8n UI → Import from File):
   - `fucklike_orchestrator_workflow.json` — the routing + QC-review webhook
   - `fucklike_batch_trigger_workflow.json` — the 24/7 cron that drains `generation_queue`

4. **Activate both workflows.** The batch trigger fires every 10 minutes,
   pulls up to 5 pending rows, and posts each to the orchestrator. The
   orchestrator fans out to Perchance or Kaggle/Colab based on `channel`.

5. **Start the Perchance service** (needs Playwright + a real display-less
   Chromium — works fine on the same box as n8n, or on RunPod alongside A1111):
   ```bash
   cd perchance
   pip install -r requirements.txt
   playwright install chromium --with-deps
   uvicorn perchance_router:app --host 0.0.0.0 --port 8100
   ```

## Why this instead of raw Apps Script

Apps Script (`scripts/apps_script_trigger.js`) still works and is kept for a
zero-infra path — it's a fine backup. n8n gets you three things Apps Script
can't: a two-branch router (NSFW vs SFW) without hand-written conditionals in
`.gs`, automatic retry-with-QC on the NSFW path, and a `needs_review` alert
hook instead of images just silently failing into the "error" bucket.

## Cost

Free if self-hosted (VPS you already have, or a $5/mo box). No per-execution
charges, no workflow caps — that's the whole point of self-hosting n8n over
Zapier/Make.

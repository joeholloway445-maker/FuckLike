"""
FuckLike — Perchance Browser Automation

Perchance has no official API. This drives the actual generator page with
Playwright (headless Chromium), the same way a real browser session would:
submit a prompt into the generator's text input, wait for the per-image
iframe to render a completed seed, then pull the rendered image out.

Runs as a standalone async module — imported by perchance_router.py, or
run directly for a one-off test generation.
"""

import asyncio
import os
import time
import base64
from pathlib import Path
from playwright.async_api import async_playwright, Page

# Set this to your own Perchance generator URL (perchance.org/ai-photo-generator
# or a custom NSFW-tuned generator you've published under your account).
PERCHANCE_GENERATOR_URL = os.environ.get(
    "PERCHANCE_GENERATOR_URL",
    "https://perchance.org/ai-photo-generator",
)

PROMPT_INPUT_SELECTOR = os.environ.get("PERCHANCE_PROMPT_SELECTOR", "textarea#userPromptInput, textarea.promptTextarea")
GENERATE_BUTTON_SELECTOR = os.environ.get("PERCHANCE_GENERATE_SELECTOR", "button.generateButton, button#generateButton")
IMAGE_SELECTOR = os.environ.get("PERCHANCE_IMAGE_SELECTOR", "img.generatedImage, .imageContainer img")

# Perchance renders each image inside its own iframe and swaps a placeholder
# for the finished frame once the seed resolves — this can take anywhere from
# 10-90s server-side depending on load. Poll rather than fixed-sleep.
POLL_INTERVAL_SECONDS = 4
MAX_WAIT_SECONDS = 120


async def _wait_for_image(page: Page, timeout: int = MAX_WAIT_SECONDS) -> str:
    """Poll the generator page until a finished image src (not a placeholder) appears."""
    deadline = time.time() + timeout
    last_src = None

    while time.time() < deadline:
        try:
            img = await page.query_selector(IMAGE_SELECTOR)
            if img:
                src = await img.get_attribute("src")
                # A finished Perchance image is either a data: URI or a resolved
                # CDN url with a seed query param — placeholders are blank/loading gifs.
                if src and ("data:image" in src or ("seed=" in src and "placeholder" not in src)):
                    if src == last_src:
                        # Same src across two polls = render settled
                        return src
                    last_src = src
        except Exception:
            pass
        await asyncio.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(f"Perchance image did not finish rendering within {timeout}s")


async def _save_image_from_src(src: str, out_path: str, page: Page):
    if src.startswith("data:image"):
        header, b64data = src.split(",", 1)
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(b64data))
    else:
        # Resolved CDN URL — fetch it via the page context so cookies/referrer match
        resp = await page.request.get(src)
        body = await resp.body()
        with open(out_path, "wb") as f:
            f.write(body)


async def generate_one(prompt: str, negative_prompt: str, seed: int, out_path: str) -> str:
    """Generate a single image via Perchance and save it to out_path."""
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})

        try:
            await page.goto(PERCHANCE_GENERATOR_URL, wait_until="networkidle", timeout=60000)

            prompt_box = await page.wait_for_selector(PROMPT_INPUT_SELECTOR, timeout=30000)
            await prompt_box.fill(prompt)

            # Some Perchance generators expose a separate negative-prompt field
            neg_box = await page.query_selector("textarea#negativePromptInput, textarea.negativePromptTextarea")
            if neg_box and negative_prompt:
                await neg_box.fill(negative_prompt)

            seed_box = await page.query_selector("input#seedInput, input.seedInput")
            if seed_box:
                await seed_box.fill(str(seed))

            gen_button = await page.wait_for_selector(GENERATE_BUTTON_SELECTOR, timeout=30000)
            await gen_button.click()

            src = await _wait_for_image(page)
            await _save_image_from_src(src, out_path, page)

            return out_path
        finally:
            await browser.close()


async def generate_batch(spec: dict, output_dir: str) -> list[str]:
    """
    Generate `count` images for a persona spec via Perchance.
    Sequential by design — Perchance rate-limits concurrent sessions from one IP,
    and running one browser context at a time is far more stable than parallel tabs.
    """
    os.makedirs(output_dir, exist_ok=True)

    prompt = (
        f"photorealistic selfie, pov looking down at own body, neck cropped out of frame, "
        f"{spec.get('body_type', 'slim hourglass')} body type, {spec.get('skin_tone', 'fair')} skin, "
        f"{spec.get('outfit', 'matching lace lingerie set')}, "
        f"{spec.get('background', 'cozy bedroom, unmade white sheets, fairy lights')}, "
        f"soft warm lighting, DSLR photo, 4k, hyperrealistic, detailed skin texture"
    )
    negative = (
        "face, head, hair at top of frame, cartoon, anime, painting, blurry, deformed, "
        "extra limbs, missing limbs, bad anatomy, watermark, text, logo, ugly, low quality"
    )

    n = spec.get("count", 4)
    base_seed = spec.get("seed", 42)
    paths = []

    for i in range(n):
        seed = base_seed + i
        out_path = os.path.join(output_dir, f"perchance_{seed:08d}.jpg")
        try:
            await generate_one(prompt, negative, seed, out_path)
            paths.append(out_path)
            print(f"  perchance: saved {out_path}")
        except Exception as e:
            print(f"  perchance: failed seed {seed}: {e}")

    return paths


def generate_batch_sync(spec: dict, output_dir: str) -> list[str]:
    """Sync wrapper for use inside FastAPI (called via run_in_threadpool)."""
    return asyncio.run(generate_batch(spec, output_dir))


if __name__ == "__main__":
    test_spec = {
        "body_type": "curvy hourglass",
        "skin_tone": "olive",
        "outfit": "black lace bodysuit",
        "background": "dim bedroom, candlelight",
        "count": 1,
        "seed": 4242,
    }
    result = generate_batch_sync(test_spec, "/tmp/perchance_test")
    print("Result:", result)

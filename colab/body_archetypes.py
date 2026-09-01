# %% [markdown]
# # FuckLike — Body Archetype Template System
# Pre-generate ~10 body templates that can serve new personas immediately.
# New personas get assigned the closest archetype while custom images generate.
#
# Archetypes: 5 silhouettes × 2 skin tone ranges = 10 base templates
# Drive folder: fucklike/personas/_archetypes/

# %%
import os, json
from typing import Optional

ARCHETYPES = [
    # (archetype_id, body_type, skin_tone, seed_base)
    {"id": "slim_fair",      "body_type": "slim hourglass",   "skin_tone": "fair porcelain",  "seed_base": 9001},
    {"id": "slim_tan",       "body_type": "slim hourglass",   "skin_tone": "light tan",        "seed_base": 9002},
    {"id": "curvy_fair",     "body_type": "curvy hourglass",  "skin_tone": "fair",             "seed_base": 9003},
    {"id": "curvy_tan",      "body_type": "curvy hourglass",  "skin_tone": "medium tan",       "seed_base": 9004},
    {"id": "petite_fair",    "body_type": "petite slim",       "skin_tone": "fair",             "seed_base": 9005},
    {"id": "petite_dark",    "body_type": "petite slim",       "skin_tone": "deep brown",       "seed_base": 9006},
    {"id": "athletic_tan",   "body_type": "athletic toned",   "skin_tone": "medium tan",       "seed_base": 9007},
    {"id": "athletic_dark",  "body_type": "athletic toned",   "skin_tone": "deep brown",       "seed_base": 9008},
    {"id": "plus_fair",      "body_type": "plus size curvy",  "skin_tone": "fair",             "seed_base": 9009},
    {"id": "plus_dark",      "body_type": "plus size curvy",  "skin_tone": "deep brown",       "seed_base": 9010},
]

# Generic neutral outfits/backgrounds that work for any persona
ARCHETYPE_SPEC = {
    "outfit": "matching nude-tone lace lingerie set",
    "background": "soft neutral white studio, minimal",
    "count": 6,         # 6 images per archetype
    "explicit_level": 2,
}

ARCHETYPES_FOLDER_ID = os.environ.get("ARCHETYPES_FOLDER_ID", "")  # Drive subfolder
ARCHETYPES_CACHE_PATH = "/tmp/archetypes_cache.json"

# %%
def load_archetype_cache() -> dict:
    """Load {archetype_id: [drive_file_ids]} from local cache."""
    if os.path.exists(ARCHETYPES_CACHE_PATH):
        with open(ARCHETYPES_CACHE_PATH) as f:
            return json.load(f)
    return {}

def save_archetype_cache(cache: dict):
    with open(ARCHETYPES_CACHE_PATH, "w") as f:
        json.dump(cache, f)

def match_archetype(spec: dict) -> Optional[str]:
    """
    Find the closest archetype to the given persona spec.
    Returns archetype_id or None if no archetypes generated yet.
    """
    cache = load_archetype_cache()
    if not cache:
        return None

    body = spec.get("body_type", "").lower()
    tone = spec.get("skin_tone", "").lower()

    # Simple keyword scoring
    scores = {}
    for a in ARCHETYPES:
        if a["id"] not in cache:
            continue
        score = 0
        for word in a["body_type"].lower().split():
            if word in body:
                score += 2
        for word in a["skin_tone"].lower().split():
            if word in tone:
                score += 2
        # Skin tone range heuristic
        dark_words = {"dark", "deep", "brown", "ebony", "chocolate"}
        tan_words  = {"tan", "olive", "medium", "caramel", "latina"}
        fair_words = {"fair", "pale", "porcelain", "light", "white"}
        a_tone = a["skin_tone"].lower()
        s_tone = spec.get("skin_tone", "").lower()
        for group in [dark_words, tan_words, fair_words]:
            if any(w in a_tone for w in group) and any(w in s_tone for w in group):
                score += 3
        scores[a["id"]] = score

    if not scores:
        return None
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else list(cache.keys())[0]

def get_archetype_images(archetype_id: str) -> list[str]:
    """Return Drive file IDs for an archetype."""
    cache = load_archetype_cache()
    return cache.get(archetype_id, [])

# %%
def generate_all_archetypes(generate_fn, upload_fn, get_or_create_folder_fn, write_metadata_fn):
    """
    Generate all 10 archetypes. Call once during initial setup.
    generate_fn(spec, output_dir) -> [paths]
    upload_fn(path, fname, folder_id) -> drive_id
    get_or_create_folder_fn(name, parent_id) -> folder_id
    write_metadata_fn(persona_name, drive_id, fname, spec)
    """
    if not ARCHETYPES_FOLDER_ID:
        print("ARCHETYPES_FOLDER_ID not set — skipping archetype generation")
        return

    cache = load_archetype_cache()
    for a in ARCHETYPES:
        if a["id"] in cache:
            print(f"Archetype {a['id']} already cached, skipping")
            continue

        spec = {**ARCHETYPE_SPEC, **a, "name": a["id"]}
        folder_id = get_or_create_folder_fn(a["id"], ARCHETYPES_FOLDER_ID)
        tmp_dir = f"/tmp/archetype_{a['id']}"

        try:
            paths = generate_fn(spec, tmp_dir)
            drive_ids = []
            for path in paths:
                fname = os.path.basename(path)
                drive_id = upload_fn(path, fname, folder_id)
                write_metadata_fn(a["id"], drive_id, fname, spec)
                drive_ids.append(drive_id)
                os.remove(path)
            cache[a["id"]] = drive_ids
            save_archetype_cache(cache)
            print(f"Archetype {a['id']}: {len(drive_ids)} images")
        except Exception as e:
            print(f"Archetype {a['id']} failed: {e}")

    print("All archetypes done")

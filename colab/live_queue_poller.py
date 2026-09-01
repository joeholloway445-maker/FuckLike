# %% [markdown]
# # FuckLike — Live Queue Poller
# Add this cell block at the bottom of persona_generator.py to handle live user requests.
# Polls Supabase `generation_queue` for pending rows and processes them.

# %%
import time, os
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")  # service role key

def poll_queue(interval_seconds: int = 30):
    """Poll generation_queue for pending requests and process them."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("Supabase credentials not set — queue polling disabled")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    print(f"Queue poller started, checking every {interval_seconds}s")

    while True:
        try:
            # Claim one pending row
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
            row_id = row["id"]
            spec = row["spec"]
            persona_name = row["persona_name"]

            # Mark as processing
            sb.table("generation_queue").update({
                "status": "processing",
                "started_at": "now()",
            }).eq("id", row_id).execute()

            print(f"Processing queue item {row_id}: {persona_name}")

            try:
                tmp_dir = f"/tmp/queue_{row_id}"
                paths = generate_persona_images(spec, tmp_dir)

                # Upload to Drive
                folder_id = get_or_create_folder(persona_name, PERSONAS_FOLDER_ID)
                drive_ids = []
                for path in paths:
                    fname = os.path.basename(path)
                    drive_id = upload_image_to_drive(path, fname, folder_id)
                    write_metadata(persona_name, drive_id, fname, spec)
                    drive_ids.append(drive_id)
                    os.remove(path)

                sb.table("generation_queue").update({
                    "status": "done",
                    "drive_file_ids": drive_ids,
                    "finished_at": "now()",
                }).eq("id", row_id).execute()

                print(f"Done: {persona_name} — {len(drive_ids)} images")

            except Exception as e:
                sb.table("generation_queue").update({
                    "status": "error",
                    "error_msg": str(e),
                    "finished_at": "now()",
                }).eq("id", row_id).execute()
                print(f"Error on {row_id}: {e}")

        except Exception as e:
            print(f"Poller error: {e}")
            time.sleep(5)

        time.sleep(interval_seconds)

# %%
# Run the poller in background alongside the FastAPI server
import threading
poller_thread = threading.Thread(target=poll_queue, kwargs={"interval_seconds": 20}, daemon=True)
poller_thread.start()
print("Live queue poller running")

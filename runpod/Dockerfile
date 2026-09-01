FROM runpod/stable-diffusion:web-automatic-9.0.0

# Install extra Python deps needed by the queue poller
RUN pip install --no-cache-dir supabase fastapi uvicorn requests

# Copy the FuckLike generation scripts into the image
COPY ../colab/a1111_backend.py    /workspace/a1111_backend.py
COPY ../colab/prodia_fallback.py  /workspace/prodia_fallback.py
COPY ../colab/body_archetypes.py  /workspace/body_archetypes.py
COPY ../colab/generation_router.py /workspace/generation_router.py
COPY start.sh                     /start.sh

RUN chmod +x /start.sh

# A1111 listens on 7860; our router on 8000
EXPOSE 7860 8000

CMD ["/start.sh"]

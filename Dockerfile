# ─── AEGIS Backend — Node.js + Python (Kokoro-82M TTS) ───────────────────────
# Uses debian-slim so we can install both Node.js and Python in one container.
# Kokoro-82M runs as a child process when TTS_SERVICE=local.

FROM python:3.11-slim

# ── System dependencies ───────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    curl \
    espeak-ng \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 22 via NodeSource ─────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python: install kokoro + deps ─────────────────────────────────────────────
COPY scripts/requirements-tts.txt ./scripts/
RUN pip install --no-cache-dir -r scripts/requirements-tts.txt

# ── Pre-download Kokoro model weights at build time (baked into image) ─────────
RUN python -c "\
from huggingface_hub import hf_hub_download; \
hf_hub_download(repo_id='hexgrad/Kokoro-82M', filename='kokoro-v1_0.pth'); \
print('Kokoro weights ready.')"

# ── Node.js: install dependencies ────────────────────────────────────────────
COPY package*.json ./
RUN npm ci --omit=dev

# ── Copy source ───────────────────────────────────────────────────────────────
COPY . .

EXPOSE 3000
CMD ["npm", "start"]

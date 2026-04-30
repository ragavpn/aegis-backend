#!/usr/bin/env python3
"""
AEGIS TTS — Kokoro-82M inline subprocess script.
Called by ttsService.js (Node.js) as a child process.

Protocol:
  stdin  → one JSON line: {"text": "...", "voice": "af_heart", "speed": 1.0}
  stdout → raw WAV bytes (24 kHz, mono, PCM_16)
  stderr → log messages (ignored by Node)
"""

import sys
import json
import io
import numpy as np
import soundfile as sf
from kokoro import KPipeline

def main():
    try:
        raw = sys.stdin.buffer.read()
        params = json.loads(raw)
        text  = params.get("text", "")
        voice = params.get("voice", "af_heart")
        speed = float(params.get("speed", 1.0))
    except Exception as e:
        sys.stderr.write(f"[tts_kokoro] Failed to parse input: {e}\n")
        sys.exit(1)

    if not text.strip():
        sys.stderr.write("[tts_kokoro] Empty text received.\n")
        sys.exit(1)

    sys.stderr.write(f"[tts_kokoro] Loading pipeline...\n")
    pipeline = KPipeline(lang_code="a")   # 'a' = American English

    sys.stderr.write(f"[tts_kokoro] Synthesising {len(text)} chars | voice={voice} | speed={speed}\n")

    chunks = []
    for _, _, audio in pipeline(text, voice=voice, speed=speed):
        chunks.append(audio)

    if not chunks:
        sys.stderr.write("[tts_kokoro] No audio chunks produced.\n")
        sys.exit(1)

    combined = np.concatenate(chunks)
    sys.stderr.write(f"[tts_kokoro] Generated {len(combined)} samples ({len(combined)/24000:.1f}s)\n")

    buf = io.BytesIO()
    sf.write(buf, combined, 24000, format="WAV", subtype="PCM_16")
    buf.seek(0)

    # Write WAV bytes to stdout — Node reads this as the audio buffer
    sys.stdout.buffer.write(buf.read())
    sys.stdout.buffer.flush()

if __name__ == "__main__":
    main()

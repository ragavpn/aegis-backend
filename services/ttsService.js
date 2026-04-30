import logger from '../utils/logger.js';
import { supabase } from '../db/supabaseClient.js';
import { generateMonologueScript, generateDailyDigestScript } from './llmService.js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// ─── TTS Provider Config ──────────────────────────────────────────────────────
// Set TTS_SERVICE in Railway to switch providers:
//   "edge"        → Microsoft Edge Read Aloud TTS  (NO API KEY — voice via EDGE_TTS_VOICE) [default]
//   "kokoroweb"   → Kokoro-web self-hosted OpenAI-compatible API (needs KOKORO_WEB_URL)
//                   API key optional — any string works if KW_SECRET_API_KEY is blank on host
//   "huggingface" → HuggingFace Kokoro via fal-ai  (needs HF_TOKEN, HUGGINGFACE_VOICE_ID)
//   "elevenlabs"  → ElevenLabs standard TTS API   (needs ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)
//   "local"       → aegis-tts sidecar (same Railway project, needs TTS_LOCAL_URL)
//
// Defaults to "edge" if not set (free, no key needed).

const getTTSService = () => (process.env.TTS_SERVICE || 'edge').toLowerCase();

// ─── ElevenLabs Provider ──────────────────────────────────────────────────────
const generateAudioWithElevenLabs = async (script) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  logger.info(`[TTS] Using ElevenLabs with voice: ${voiceId}`);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: script,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} - ${errTxt}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// ─── HuggingFace Kokoro Provider (via fal-ai router) ─────────────────────────
const generateAudioWithHuggingFace = async (script) => {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) throw new Error('HF_TOKEN is not set');

  const voiceId = process.env.HUGGINGFACE_VOICE_ID || 'af_heart';
  logger.info(`[TTS] Using Kokoro (fal-ai router) with voice: ${voiceId}`);

  const res = await fetch('https://router.huggingface.co/fal-ai/fal-ai/kokoro/american-english', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hfToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: script,
      voice: voiceId,
    }),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => res.statusText);
    throw new Error(`HuggingFace (fal-ai) TTS API failed: ${res.status} - ${errTxt}`);
  }

  const result = await res.json();
  logger.info(`[TTS] fal-ai response keys: ${Object.keys(result).join(', ')}`);

  const audioUrl = result?.audio?.url || result?.audio_url || result?.url;
  if (!audioUrl) {
    throw new Error(`fal-ai response missing audio URL. Response: ${JSON.stringify(result)}`);
  }

  logger.info(`[TTS] Downloading audio from: ${audioUrl}`);
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`Failed to download audio from fal-ai URL: ${audioRes.status}`);
  }

  const arrayBuffer = await audioRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// ─── Local aegis-tts Sidecar Provider ────────────────────────────────────────
// Calls the aegis-tts FastAPI service running in the same Railway project.
// Railway private networking: http://aegis-tts.railway.internal:8000
// Set TTS_LOCAL_URL in aegis-backend env vars to the above address.
const generateAudioWithLocal = async (script) => {
  const baseUrl = (process.env.TTS_LOCAL_URL || 'http://aegis-tts.railway.internal:8000').replace(/\/$/, '');
  const voiceId = process.env.HUGGINGFACE_VOICE_ID || 'af_heart';
  logger.info(`[TTS] Using aegis-tts sidecar at ${baseUrl} | voice: ${voiceId}`);

  const res = await fetch(`${baseUrl}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: script, voice: voiceId, speed: 1.0 }),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => res.statusText);
    throw new Error(`aegis-tts sidecar failed: ${res.status} - ${errTxt}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// ─── Microsoft Edge TTS Provider (msedge-tts) ────────────────────────────────
// Uses Microsoft Edge's Read Aloud WebSocket API — NO API KEY required.
// Set EDGE_TTS_VOICE to any neural voice name, e.g.:
//   en-US-AriaNeural | en-US-GuyNeural | en-US-JennyNeural | en-GB-SoniaNeural
// Full list: https://learn.microsoft.com/azure/cognitive-services/speech-service/language-support
const generateAudioWithEdge = async (script) => {
  const voice = process.env.EDGE_TTS_VOICE || 'en-US-AriaNeural';
  logger.info(`[TTS] Using Microsoft Edge TTS | voice: ${voice}`);

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(script);

  const chunks = [];
  await new Promise((resolve, reject) => {
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', resolve);
    audioStream.on('error', reject);
  });

  const buf = Buffer.concat(chunks);
  if (buf.length === 0) throw new Error('Edge TTS returned empty audio');
  logger.info(`[TTS] Edge TTS done (${buf.length} bytes)`);
  return buf;
};

// ─── Kokoro-web Provider ─────────────────────────────────────────────────────
// https://github.com/eduardolat/kokoro-web
//
// ⚠️  SELF-HOSTED ONLY — the public voice-generator.pages.dev site runs the
// model via WebGPU in the browser; its /api/v1/audio/speech POST endpoint is
// NOT active on the public deployment (returns 405).
//
// To use this provider you must run the Docker image yourself:
//   docker run -p 3000:3000 -e KW_SECRET_API_KEY=any-key ghcr.io/eduardolat/kokoro-web:latest
// On Railway: add a new service from the Docker image in the same project, then
// use the private network URL: http://<service>.railway.internal:3000
//
// Required env vars:
//   KOKORO_WEB_URL     — base URL of your self-hosted instance (no default)
// Optional:
//   KOKORO_WEB_API_KEY — must match KW_SECRET_API_KEY on the container (default: "any-key")
//   KOKORO_WEB_VOICE   — Kokoro voice ID (default: "af_heart")
//   KOKORO_WEB_MODEL   — "model_q8f16" (best quality) | "model_q4" (faster, default: model_q8f16)
const generateAudioWithKokoroWeb = async (script) => {
  const baseUrl = (process.env.KOKORO_WEB_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error(
    'KOKORO_WEB_URL is not set. kokoro-web must be self-hosted — ' +
    'the public voice-generator.pages.dev does not expose a server-side API. ' +
    'Run: docker run -p 3000:3000 ghcr.io/eduardolat/kokoro-web:latest'
  );

  const apiKey = process.env.KOKORO_WEB_API_KEY || 'any-key'; // must match KW_SECRET_API_KEY on container
  const voice  = process.env.KOKORO_WEB_VOICE   || 'af_heart';
  const model  = process.env.KOKORO_WEB_MODEL   || 'model_q8f16';

  logger.info(`[TTS] Using Kokoro-web at ${baseUrl} | voice: ${voice} | model: ${model}`);

  const res = await fetch(`${baseUrl}/api/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, voice, input: script }),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => res.statusText);
    throw new Error(`Kokoro-web API failed: ${res.status} - ${errTxt}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (buf.length === 0) throw new Error('Kokoro-web returned empty audio');
  logger.info(`[TTS] Kokoro-web done (${buf.length} bytes)`);
  return buf;
};

// ─── Shared provider router ───────────────────────────────────────────────────
const generateAudio = async (script) => {
  const service = getTTSService();
  logger.info(`[TTS] TTS provider: "${service}"`);
  if (service === 'elevenlabs')  return generateAudioWithElevenLabs(script);
  if (service === 'huggingface') return generateAudioWithHuggingFace(script);
  if (service === 'edge')        return generateAudioWithEdge(script);
  if (service === 'kokoroweb')   return generateAudioWithKokoroWeb(script);
  if (service === 'local')       return generateAudioWithLocal(script);
  throw new Error(`Unknown TTS_SERVICE: "${service}". Use "edge", "kokoroweb", "elevenlabs", "huggingface", or "local".`);
};

// ─── Generate single-article podcast ─────────────────────────────────────────
export const generatePodcast = async (articleId, article, durationScale = 'default') => {
  try {
    logger.info(`[TTS] Generating podcast script for article ${articleId} (duration: ${durationScale})...`);
    const graphContext = article.graphContext || '';
    const script = await generateMonologueScript(article, durationScale, graphContext);

    if (!script || script.trim().length === 0) {
      throw new Error('LLM returned an empty podcast script.');
    }
    logger.info(`[TTS] Script generated (${script.length} chars).`);

    const audioBuffer = await generateAudio(script);

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('TTS provider returned an empty audio buffer.');
    }
    logger.info(`[TTS] Audio received (${audioBuffer.length} bytes). Uploading to Supabase...`);

    // WAV from local sidecar, MP3 from cloud providers
    const service = getTTSService();
    const ext = service === 'local' ? 'wav' : 'mp3';
    const contentType = service === 'local' ? 'audio/wav' : 'audio/mpeg';
    const fileName = `${articleId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('podcasts')
      .upload(fileName, audioBuffer, { contentType, upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from('podcasts').getPublicUrl(fileName);
    const audioUrl = publicUrlData.publicUrl;

    const wordCount = script.split(/\s+/).length;
    const durationSeconds = Math.round((wordCount / 130) * 60);

    logger.info(`[TTS] Podcast generated successfully for article ${articleId} (~${durationSeconds}s)`);
    return { audioUrl, durationSeconds };

  } catch (error) {
    logger.error(`[TTS] Error generating podcast: ${error.message}`);
    throw error;
  }
};

// ─── Generate daily digest podcast ───────────────────────────────────────────
export const generateDailyDigestPodcast = async (articles, durationScale = 'default') => {
  try {
    logger.info(`[TTS] Generating daily digest from ${articles.length} articles...`);
    const script = await generateDailyDigestScript(articles, durationScale);

    if (!script || script.trim().length === 0) {
      throw new Error('LLM returned an empty daily digest script.');
    }
    logger.info(`[TTS] Daily digest script ready (${script.length} chars). Sending to TTS...`);

    const audioBuffer = await generateAudio(script);

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('TTS provider returned an empty audio buffer for daily digest.');
    }

    const service = getTTSService();
    const ext = service === 'local' ? 'wav' : 'mp3';
    const contentType = service === 'local' ? 'audio/wav' : 'audio/mpeg';
    const fileName = `daily-digest-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('podcasts')
      .upload(fileName, audioBuffer, { contentType, upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from('podcasts').getPublicUrl(fileName);
    const audioUrl = publicUrlData.publicUrl;

    const wordCount = script.split(/\s+/).length;
    const durationSeconds = Math.round((wordCount / 130) * 60);

    logger.info(`[TTS] Daily digest podcast generated (~${durationSeconds}s)`);
    return { audioUrl, durationSeconds };

  } catch (error) {
    logger.error(`[TTS] Error generating daily digest: ${error.message}`);
    throw error;
  }
};

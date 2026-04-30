import logger from '../utils/logger.js';
import { supabase } from '../db/supabaseClient.js';
import { generateMonologueScript, generateDailyDigestScript } from './llmService.js';

// ─── TTS Provider Config ──────────────────────────────────────────────────────
// Set TTS_SERVICE in Railway to switch providers:
//   "elevenlabs"  → ElevenLabs standard TTS API   (needs ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)
//   "huggingface" → HuggingFace Kokoro via fal-ai  (needs HF_TOKEN, HUGGINGFACE_VOICE_ID)
//   "local"       → Self-hosted Kokoro-82M sidecar  (needs TTS_LOCAL_URL, e.g. http://aegis-tts.railway.internal:8000)
//
// Defaults to "huggingface" if not set.

const getTTSService = () => (process.env.TTS_SERVICE || 'huggingface').toLowerCase();

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

  // Use the HuggingFace router → fal-ai Kokoro endpoint
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

  // fal-ai returns { audio: { url: "https://..." } } or { audio_url: "..." }
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

// ─── Local Kokoro Sidecar Provider ───────────────────────────────────────────
// Calls the aegis-tts FastAPI sidecar running Kokoro-82M locally.
// Set TTS_LOCAL_URL to the Railway internal URL: http://aegis-tts.railway.internal:8000
const generateAudioWithLocal = async (script) => {
  const baseUrl = (process.env.TTS_LOCAL_URL || 'http://localhost:8000').replace(/\/$/, '');
  const voiceId = process.env.HUGGINGFACE_VOICE_ID || 'af_heart'; // reuse same variable
  logger.info(`[TTS] Using local Kokoro sidecar at ${baseUrl} | voice: ${voiceId}`);

  const res = await fetch(`${baseUrl}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: script, voice: voiceId, speed: 1.0 }),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => res.statusText);
    throw new Error(`Local Kokoro sidecar failed: ${res.status} - ${errTxt}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// ─── Shared provider router ───────────────────────────────────────────────────
const generateAudio = async (script) => {
  const service = getTTSService();
  logger.info(`[TTS] TTS provider: "${service}"`);
  if (service === 'elevenlabs') return generateAudioWithElevenLabs(script);
  if (service === 'huggingface') return generateAudioWithHuggingFace(script);
  if (service === 'local') return generateAudioWithLocal(script);
  throw new Error(`Unknown TTS_SERVICE value: "${service}". Use "elevenlabs", "huggingface", or "local".`);
};

export const generatePodcast = async (articleId, article, durationScale = 'default') => {
  try {
    // Step 1: Generate the monologue script via LLM
    logger.info(`[TTS] Generating podcast script for article ${articleId} (duration: ${durationScale})...`);
    const graphContext = article.graphContext || '';
    const script = await generateMonologueScript(article, durationScale, graphContext);

    if (!script || script.trim().length === 0) {
      throw new Error('LLM returned an empty podcast script.');
    }
    logger.info(`[TTS] Script generated (${script.length} chars).`);

    // Step 2: Route to the correct TTS provider
    const audioBuffer = await generateAudio(script);

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('TTS provider returned an empty audio buffer.');
    }
    logger.info(`[TTS] Audio received (${audioBuffer.length} bytes). Uploading to Supabase...`);

    // Step 3: Upload to Supabase Storage — WAV from local sidecar, MP3 from cloud providers
    const service = getTTSService();
    const ext = service === 'local' ? 'wav' : 'mp3';
    const contentType = service === 'local' ? 'audio/wav' : 'audio/mpeg';
    const fileName = `${articleId}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('podcasts')
      .upload(fileName, audioBuffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Step 4: Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('podcasts')
      .getPublicUrl(fileName);

    const audioUrl = publicUrlData.publicUrl;

    // Estimate duration (~130 words/min average TTS speed)
    const wordCount = script.split(/\s+/).length;
    const durationSeconds = Math.round((wordCount / 130) * 60);

    logger.info(`[TTS] Podcast generated successfully for article ${articleId} (~${durationSeconds}s)`);
    return { audioUrl, durationSeconds };

  } catch (error) {
    logger.error(`[TTS] Error generating podcast: ${error.message}`);
    throw error;
  }
};

// Generates the daily digest podcast from a set of articles
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

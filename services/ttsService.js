import logger from '../utils/logger.js';
import { supabase } from '../db/supabaseClient.js';
import { generateMonologueScript } from './llmService.js';

// ─── TTS Provider Config ──────────────────────────────────────────────────────
// Set TTS_SERVICE in Railway to switch providers:
//   "elevenlabs"  → ElevenLabs standard TTS API  (needs ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)
//   "huggingface" → HuggingFace Kokoro-82M inference (needs HF_TOKEN, HUGGINGFACE_VOICE_ID)
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

// ─── HuggingFace Kokoro Provider (Free Serverless Inference API) ──────────────
const generateAudioWithHuggingFace = async (script) => {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) throw new Error('HF_TOKEN is not set');

  // Voice ID from Railway env, defaults to af_heart (warm American female voice)
  const voiceId = process.env.HUGGINGFACE_VOICE_ID || 'af_heart';
  logger.info(`[TTS] Using HuggingFace Kokoro-82M (free serverless) with voice: ${voiceId}`);

  // Use the free HF Serverless Inference API directly — no paid provider routing
  const res = await fetch('https://api-inference.huggingface.co/models/hexgrad/Kokoro-82M', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hfToken}`,
      'Content-Type': 'application/json',
      'Accept': 'audio/flac',
    },
    body: JSON.stringify({
      inputs: script,
      parameters: {
        voice: voiceId,
      },
    }),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => res.statusText);
    throw new Error(`HuggingFace TTS API failed: ${res.status} - ${errTxt}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// ─── Main Exported Function ───────────────────────────────────────────────────
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
    const service = getTTSService();
    logger.info(`[TTS] TTS provider: "${service}"`);

    let audioBuffer;
    if (service === 'elevenlabs') {
      audioBuffer = await generateAudioWithElevenLabs(script);
    } else if (service === 'huggingface') {
      audioBuffer = await generateAudioWithHuggingFace(script);
    } else {
      throw new Error(`Unknown TTS_SERVICE value: "${service}". Use "elevenlabs" or "huggingface".`);
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('TTS provider returned an empty audio buffer.');
    }
    logger.info(`[TTS] Audio received (${audioBuffer.length} bytes). Uploading to Supabase...`);

    // Step 3: Upload to Supabase Storage
    // HuggingFace Kokoro returns FLAC, ElevenLabs returns MP3
    const isHF = service === 'huggingface';
    const fileExt = isHF ? 'flac' : 'mp3';
    const contentType = isHF ? 'audio/flac' : 'audio/mpeg';
    const fileName = `${articleId}.${fileExt}`;

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

import logger from '../utils/logger.js';
import { supabase } from '../db/supabaseClient.js';
import { generateMonologueScript } from './llmService.js';

export const generatePodcast = async (articleId, article, durationScale = 'default') => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not set in environment variables");
    }

    // Voice ID — configurable via Railway env var, falls back to the default George voice
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';

    // Step 1: Generate the podcast monologue script using the LLM
    logger.info(`[TTS] Generating podcast script for article ${articleId} (duration: ${durationScale})...`);
    const graphContext = article.graphContext || "";
    const script = await generateMonologueScript(article, durationScale, graphContext);

    if (!script || script.trim().length === 0) {
      throw new Error("LLM returned an empty podcast script.");
    }

    logger.info(`[TTS] Script generated (${script.length} chars). Sending to ElevenLabs TTS...`);

    // Step 2: Send script to ElevenLabs standard TTS API
    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: script,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!ttsResponse.ok) {
      const errTxt = await ttsResponse.text();
      throw new Error(`ElevenLabs TTS API failed: ${ttsResponse.status} - ${errTxt}`);
    }

    // Step 3: Read the audio buffer directly from the response (no polling needed)
    const arrayBuffer = await ttsResponse.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("ElevenLabs returned an empty audio buffer.");
    }

    logger.info(`[TTS] Audio received (${audioBuffer.length} bytes). Uploading to Supabase...`);

    // Step 4: Upload to Supabase Storage
    const fileName = `${articleId}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from('podcasts')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (uploadError) {
      throw uploadError;
    }

    // Step 5: Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('podcasts')
      .getPublicUrl(fileName);

    const audioUrl = publicUrlData.publicUrl;

    // Estimate duration from word count (~130 words per minute average TTS speed)
    const wordCount = script.split(/\s+/).length;
    const durationSeconds = Math.round((wordCount / 130) * 60);

    logger.info(`[TTS] Podcast generated successfully for article ${articleId} (~${durationSeconds}s)`);
    return { audioUrl, durationSeconds };

  } catch (error) {
    logger.error(`[TTS] Error generating podcast: ${error.message}`);
    throw error;
  }
};

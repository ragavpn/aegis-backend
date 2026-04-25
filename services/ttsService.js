import logger from '../utils/logger.js';
import { supabase } from '../db/supabaseClient.js';
import { generateDialogue } from './llmService.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

/**
 * Generates a two-person podcast for an article using LLM dialogue + ElevenLabs TTS.
 * Uploads the result to Supabase Storage and saves the URL in the `podcasts` table.
 * 
 * @param {string} articleId - The UUID of the article
 * @param {object} article - The article object
 * @returns {Promise<string>} The public URL of the generated audio
 */
export const generatePodcast = async (articleId, article) => {
  let tempFiles = [];
  let mergedFile = null;

  ffmpeg.setFfmpegPath(ffmpegStatic);

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not set in environment variables");
    }

    logger.info(`[TTS] Generating dialogue for article ${articleId}...`);
    // Pass empty graphContext for now, or fetch it if needed. 
    // In podcasts.js, we don't have graphContext, but llmService.generateDialogue handles empty context.
    const dialogue = await generateDialogue(article, "");

    if (!Array.isArray(dialogue) || dialogue.length === 0) {
      throw new Error("Failed to generate dialogue array from LLM.");
    }

    logger.info(`[TTS] Generated ${dialogue.length} dialogue lines. Synthesizing audio via ElevenLabs...`);

    // Voice mapping (Example ElevenLabs voices)
    // Alex (Male) -> 'pNInz6obpgDQGcFmaJgB' (Adam)
    // Jordan (Female) -> 'EXAVITQu4vr4xnSDxMaL' (Bella)
    const voiceMap = {
      "Alex": process.env.ELEVENLABS_VOICE_ALEX || 'pNInz6obpgDQGcFmaJgB',
      "Jordan": process.env.ELEVENLABS_VOICE_JORDAN || 'EXAVITQu4vr4xnSDxMaL'
    };

    const tmpDir = os.tmpdir();
    
    // Generate each line sequentially
    for (let i = 0; i < dialogue.length; i++) {
      const line = dialogue[i];
      const speaker = line.speaker === "Jordan" ? "Jordan" : "Alex";
      const voiceId = voiceMap[speaker];
      
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: line.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.5 }
        })
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`ElevenLabs Error for line ${i}: ${response.statusText} - ${errTxt}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const tempPath = path.join(tmpDir, `aegis_${articleId}_part${i}.mp3`);
      await writeFileAsync(tempPath, buffer);
      tempFiles.push(tempPath);
    }

    mergedFile = path.join(tmpDir, `aegis_${articleId}_final.mp3`);
    if (fs.existsSync(mergedFile)) await unlinkAsync(mergedFile);

    logger.info(`[TTS] Concatenating ${tempFiles.length} files...`);
    
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      tempFiles.forEach(file => command.input(file));
      
      command
        .on('error', (err) => {
          logger.error(`[TTS] ffmpeg error: ${err.message}`);
          reject(err);
        })
        .on('end', () => {
          logger.info('[TTS] ffmpeg concatenation finished.');
          resolve();
        })
        .mergeToFile(mergedFile, tmpDir);
    });

    logger.info('[TTS] Uploading merged file to Supabase...');
    const fileBuffer = fs.readFileSync(mergedFile);

    // Upload to Supabase Storage
    const fileName = `${articleId}.mp3`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('podcasts')
      .upload(fileName, fileBuffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (uploadError) {
      throw uploadError;
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('podcasts')
      .getPublicUrl(fileName);
      
    const audioUrl = publicUrlData.publicUrl;

    // Insert into podcasts table
    const { error: dbError } = await supabase
      .from('podcasts')
      .upsert({
        article_id: articleId,
        audio_url: audioUrl,
        duration_seconds: 0
      }, { onConflict: 'article_id' });

    if (dbError) {
      throw dbError;
    }

    logger.info(`[TTS] Podcast generated successfully for article ${articleId}`);
    return audioUrl;

  } catch (error) {
    logger.error(`[TTS] Error generating podcast: ${error.message}`);
    throw error;
  } finally {
    // Cleanup temp files
    try {
      for (const file of tempFiles) {
        if (fs.existsSync(file)) await unlinkAsync(file);
      }
      if (mergedFile && fs.existsSync(mergedFile)) await unlinkAsync(mergedFile);
    } catch (cleanupErr) {
      logger.error(`[TTS] Failed to cleanup temp files: ${cleanupErr.message}`);
    }
  }
};

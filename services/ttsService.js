import logger from '../utils/logger.js';
import { supabase } from '../db/supabaseClient.js';
import { generateDialogue } from './llmService.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

export const generatePodcast = async (articleId, article) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not set in environment variables");
    }

    // You specified voice IDs in the plan comments
    // host - EST9Ui6982FZPSi7gCHi
    // guest - 7WggD3IoWTIPT19PNyrW
    const hostVoiceId = process.env.ELEVENLABS_HOST_VOICE_ID || 'EST9Ui6982FZPSi7gCHi';
    const guestVoiceId = process.env.ELEVENLABS_GUEST_VOICE_ID || '7WggD3IoWTIPT19PNyrW';

    logger.info(`[TTS] Requesting Studio Podcast generation for article ${articleId}...`);
    
    // We pass the raw article text as the source for the podcast
    let sourceText = article.content || "No content available";
    if (article.title) sourceText = article.title + "\n\n" + sourceText;
    
    // Ensure text is not too long for the API
    if (sourceText.length > 50000) {
       sourceText = sourceText.substring(0, 50000);
    }

    const startResponse = await fetch('https://api.elevenlabs.io/v1/studio/podcasts', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model_id: "eleven_multilingual_v2",
        mode: "conversational",
        source: {
          source_type: "text",
          text: sourceText
        },
        duration_scale: "default",
        language: "en",
        host_voice_id: hostVoiceId,
        guest_voice_id: guestVoiceId
      })
    });

    if (!startResponse.ok) {
      const errTxt = await startResponse.text();
      throw new Error(`Failed to start ElevenLabs Podcast generation: ${startResponse.status} - ${errTxt}`);
    }

    const startData = await startResponse.json();
    const podcastId = startData.podcast_id;
    
    if (!podcastId) {
        throw new Error("No podcast_id returned from ElevenLabs.");
    }
    
    logger.info(`[TTS] Podcast job started with ID: ${podcastId}. Polling for completion...`);

    // Poll until completed
    let isCompleted = false;
    let podcastUrl = null;
    let durationSeconds = 0; // The API doesn't return exact duration until downloaded, we'll estimate or just default to 300
    
    // We'll poll every 10 seconds for up to 10 minutes
    const maxRetries = 60;
    let retries = 0;
    
    // To simplify downloading without bringing back ffmpeg dependencies, we get the audio stream from the download endpoint
    while (!isCompleted && retries < maxRetries) {
        // Wait 10 seconds
        await new Promise(resolve => setTimeout(resolve, 10000));
        retries++;
        
        logger.info(`[TTS] Polling status for ${podcastId} (attempt ${retries}/${maxRetries})...`);
        
        const statusResponse = await fetch(`https://api.elevenlabs.io/v1/studio/podcasts/${podcastId}`, {
             method: 'GET',
             headers: {
               'xi-api-key': apiKey
             }
        });
        
        if (!statusResponse.ok) {
             logger.warn(`[TTS] Polling failed: ${statusResponse.status}`);
             continue;
        }
        
        const statusData = await statusResponse.json();
        // The ElevenLabs API response format for podcast status
        // Usually returns the podcast project or an error
        if (statusData.project && statusData.project.state === "completed") {
             // In Studio projects, audio is sometimes available at a URL or via download endpoint
             // To download the audio: GET /v1/projects/{project_id}/snapshots/{snapshot_id}/stream
             logger.info(`[TTS] Podcast generation completed on ElevenLabs end!`);
             isCompleted = true;
             
             // The podcast API usually exposes the actual audio file once ready
             // Wait, the documentation says "To get the audio, use the download endpoint" but doesn't specify if it's the project download or something else
             // Usually, GET /v1/studio/podcasts/{id} might just be the project
             
             // Actually, ElevenLabs Projects API provides GET /v1/projects/{project_id}
             // For simplicity, we just use the podcast id to download it if it's available
             
             // We need to fetch the audio blob
             logger.info(`[TTS] Downloading completed audio for podcast ${podcastId}...`);
             
             // First we need to get the snapshot ID or just download the project
             // Wait, there isn't a direct "download podcast" endpoint in standard docs, usually you stream the project snapshot
             // Or sometimes the podcast response contains `audio_url`.
             // We will assume `statusData` has audio_url or we can use the download endpoint if provided
        } else if (statusData.status === "succeeded" || statusData.state === "completed" || statusData.status === "completed") {
             logger.info(`[TTS] Podcast generation completed! Downloading...`);
             isCompleted = true;
        } else if (statusData.status === "failed" || statusData.state === "failed") {
             throw new Error(`ElevenLabs generation failed: ${JSON.stringify(statusData.error || statusData)}`);
        }
        
        // Let's implement the simpler way which handles typical async job results
        // Actually, if we use the create project and return endpoint, maybe we just stream it
        // The actual endpoint for downloading the podcast according to ElevenLabs docs:
        // Wait, ElevenLabs API for podcasts returns `project_id`.
    }
    
    if (!isCompleted) {
        throw new Error(`Podcast generation timed out after ${maxRetries * 10} seconds.`);
    }
    
    // Now download the generated audio.
    // Assuming the podcast ID can be used directly or it's a project ID
    // Let's use the simplest approach, trying to download the project or podcast
    
    // According to ElevenLabs standard API for podcasts:
    // GET /v1/studio/podcasts/{podcast_id} Returns the podcast project details.
    // If we need the audio, we typically use the Projects API to stream it:
    // GET /v1/projects/{project_id}/stream
    // So we fetch that endpoint
    
    logger.info(`[TTS] Streaming audio from ElevenLabs for podcast ${podcastId}...`);
    const streamResponse = await fetch(`https://api.elevenlabs.io/v1/projects/${podcastId}/stream`, {
        method: 'POST', // or GET depending on the endpoint, usually POST for convert, GET for stream
        headers: {
            'xi-api-key': apiKey
        }
    });
    
    // Wait, the API for downloading a project's audio is GET /v1/projects/{project_id}/snapshots/{snapshot_id}/stream
    // Or if the podcast API returns a different way. Let's just use the direct podcast ID if they have a streaming endpoint
    // Actually, maybe the podcast response provides an audio stream?
    // Let's use the most generic fetching and upload the buffer directly.
    
    const projectResponse = await fetch(`https://api.elevenlabs.io/v1/projects/${podcastId}`, {
        headers: { 'xi-api-key': apiKey }
    });
    
    let audioBuffer;
    
    if (projectResponse.ok) {
        const projectData = await projectResponse.json();
        durationSeconds = projectData.duration || 300; // estimated duration
        
        // If they have snapshots, get the latest one
        if (projectData.snapshots && projectData.snapshots.length > 0) {
             const latestSnapshotId = projectData.snapshots[projectData.snapshots.length - 1].snapshot_id;
             const snapshotResponse = await fetch(`https://api.elevenlabs.io/v1/projects/${podcastId}/snapshots/${latestSnapshotId}/stream`, {
                 headers: { 'xi-api-key': apiKey }
             });
             if (snapshotResponse.ok) {
                 const arrayBuffer = await snapshotResponse.arrayBuffer();
                 audioBuffer = Buffer.from(arrayBuffer);
             }
        }
    }
    
    // Fallback if we couldn't get it via snapshots
    if (!audioBuffer) {
        throw new Error("Could not download audio buffer from ElevenLabs");
    }

    logger.info(`[TTS] Uploading file to Supabase...`);

    // Upload to Supabase Storage
    const fileName = `${articleId}.mp3`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('podcasts')
      .upload(fileName, audioBuffer, {
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

    logger.info(`[TTS] Podcast generated successfully for article ${articleId}`);
    return { audioUrl, durationSeconds };

  } catch (error) {
    logger.error(`[TTS] Error generating podcast: ${error.message}`);
    throw error;
  }
};

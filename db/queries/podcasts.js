import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

export const getPodcastByArticleId = async (articleId) => {
  const { data, error } = await supabase
    .from('podcasts')
    .select('audio_url, duration_seconds')
    .eq('article_id', articleId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
    logger.error({ err: error }, 'Failed to fetch podcast by article ID');
    throw error;
  }
  return data;
};

export const savePodcast = async (userId, articleId, audioUrl, durationSeconds) => {
  const { data, error } = await supabase
    .from('podcasts')
    .insert([{ 
      user_id: userId, 
      article_id: articleId, 
      audio_url: audioUrl,
      duration_seconds: durationSeconds
    }])
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to save podcast');
    throw error;
  }
  return data;
};

// Daily digest podcasts use a special sentinel article_id so they don't clash with per-article podcasts
const DAILY_DIGEST_SENTINEL = '00000000-0000-0000-0000-000000000001';

export const getDailyDigestPodcast = async () => {
  // Return only if generated within the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('podcasts')
    .select('audio_url, duration_seconds, created_at')
    .eq('article_id', DAILY_DIGEST_SENTINEL)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error({ err: error }, 'Failed to fetch daily digest podcast');
    throw error;
  }
  return data;
};

export const saveDailyDigestPodcast = async (userId, audioUrl, durationSeconds) => {
  const { data, error } = await supabase
    .from('podcasts')
    .insert([{
      user_id: userId,
      article_id: DAILY_DIGEST_SENTINEL,
      audio_url: audioUrl,
      duration_seconds: durationSeconds
    }])
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to save daily digest podcast');
    throw error;
  }
  return data;
};

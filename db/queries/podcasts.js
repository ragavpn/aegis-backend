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

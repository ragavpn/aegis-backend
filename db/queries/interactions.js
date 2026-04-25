import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

/**
 * Upsert a user's article interaction (one row per user+article pair).
 * Requires `article_interactions` to have UNIQUE(user_id, article_id).
 */
export const upsertInteraction = async (userId, interactionData) => {
  const { articleId, liked, bookmarked, readDurationSeconds, scrollDepthPercent } = interactionData;

  const { data, error } = await supabase
    .from('article_interactions')
    .upsert(
      {
        user_id: userId,
        article_id: articleId,
        liked,
        bookmarked,
        read_duration_seconds: readDurationSeconds,
        scroll_depth_percent: scrollDepthPercent,
      },
      { onConflict: 'user_id,article_id' }
    )
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to upsert article interaction');
    throw error;
  }
  return data;
};

/**
 * Fetch the last N interactions for a user (for the recommendation engine).
 */
export const getUserInteractions = async (userId, limit = 20) => {
  const { data, error } = await supabase
    .from('article_interactions')
    .select('*, articles!inner(modules)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ err: error }, 'Failed to fetch user interactions');
    throw error;
  }
  return data ?? [];
};

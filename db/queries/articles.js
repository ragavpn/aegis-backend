import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

export const insertArticle = async (articleData) => {
  const { title, body, summary, modules, sources, sweep_id, graph_context_used } = articleData;

  const { data, error } = await supabase
    .from('articles')
    .insert([
      { title, body, summary, modules, sources, sweep_id, graph_context_used }
    ])
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to insert article into Supabase');
    throw error;
  }

  return data;
};

export const getLatestArticles = async (limit = 10) => {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ err: error }, 'Failed to fetch latest articles');
    throw error;
  }

  return data;
};

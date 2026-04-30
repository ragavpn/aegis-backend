import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

export const insertArticle = async (articleData) => {
  const { title, body, summary, modules, sources, sweep_id, graph_context_used } = articleData;

  const { data, error } = await supabase
    .from('articles')
    .insert([{ title, body, summary, modules, sources, sweep_id, graph_context_used }])
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to insert article into Supabase');
    throw error;
  }
  return data;
};

export const getLatestArticles = async (limit = 50) => {
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

import { scoreArticle } from '../../services/recommendationEngine.js';

export const getLatestArticlesForUser = async (userId, limit = 50) => {
  // Fetch up to 100 recent articles to score
  const articles = await getLatestArticles(100);
  
  // Fetch recent interactions to inform the recommendation engine
  const { data: interactions, error } = await supabase
    .from('article_interactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error }, 'Failed to fetch interactions for recommendation engine');
    // Fallback to plain chronological sorting
    return articles.slice(0, limit);
  }

  // Score and sort articles
  const scored = articles.map(article => {
    return {
      ...article,
      score: scoreArticle(userId, article, interactions || [])
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
};

export const getArticleById = async (id) => {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    logger.error({ err: error }, `Failed to fetch article ${id}`);
    throw error;
  }
  return data;
};

export const getArticlesLast24Hours = async (limit = 10) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, summary, modules')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ err: error }, 'Failed to fetch last-24h articles');
    throw error;
  }
  return data;
};

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getArticleById, getArticlesLast24Hours } from '../db/queries/articles.js';
import { getPodcastByArticleId, savePodcast, getDailyDigestPodcast, saveDailyDigestPodcast } from '../db/queries/podcasts.js';
import { generatePodcast, generateDailyDigestPodcast } from '../services/ttsService.js';
import { extractEntities } from '../services/llmService.js';
import { getGraphContext } from '../services/graphService.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(requireAuth);

/**
 * POST /podcasts/generate
 * Body: { article_id: UUID, duration_scale?: "short"|"default"|"long" }
 */
router.post('/generate', async (req, res) => {
  const { article_id, duration_scale } = req.body;

  if (!article_id) {
    return res.status(400).json({ error: 'article_id is required' });
  }

  try {
    // 1. Check if podcast already exists in DB
    const existingPodcast = await getPodcastByArticleId(article_id);

    if (existingPodcast && existingPodcast.audio_url) {
      logger.info(`[Podcasts] Returning existing podcast for ${article_id}`);
      return res.json({ audio_url: existingPodcast.audio_url });
    }

    // 2. Fetch the article
    const article = await getArticleById(article_id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // 3. Retrieve Graph Context
    logger.info(`[Podcasts] Extracting entities for article ${article_id}`);
    const entities = await extractEntities(article.summary || article.body || '');
    const graphContext = await getGraphContext(entities);
    article.graphContext = graphContext;

    // 4. Generate audio
    const { audioUrl, durationSeconds } = await generatePodcast(article_id, article, duration_scale || 'default');

    // 5. Save to DB
    await savePodcast(req.user.id, article_id, audioUrl, durationSeconds);

    res.json({ audio_url: audioUrl });
  } catch (error) {
    logger.error(`[Podcasts] Error generating podcast: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate podcast audio' });
  }
});

/**
 * POST /podcasts/generate-daily
 * Body (optional): { duration_scale?: "short" | "default" | "long" }
 * Generates (or returns cached) a daily digest podcast from the last 24h articles.
 */
router.post('/generate-daily', async (req, res) => {
  const durationScale = req.body?.duration_scale || 'default';

  try {
    // 1. Return cached digest if one was made in the last 24h
    const existing = await getDailyDigestPodcast();
    if (existing && existing.audio_url) {
      logger.info('[Podcasts] Returning cached daily digest podcast');
      return res.json({ audio_url: existing.audio_url, duration_seconds: existing.duration_seconds, cached: true });
    }

    // 2. Fetch last 24h articles (up to 10)
    const articles = await getArticlesLast24Hours(10);
    if (!articles || articles.length === 0) {
      return res.status(404).json({ error: 'No articles found in the last 24 hours to create a digest.' });
    }

    logger.info(`[Podcasts] Generating daily digest (scale: ${durationScale}) from ${articles.length} articles`);

    // 3. Generate digest audio
    const { audioUrl, durationSeconds } = await generateDailyDigestPodcast(articles, durationScale);

    // 4. Save to DB
    await saveDailyDigestPodcast(req.user.id, audioUrl, durationSeconds);

    res.json({ audio_url: audioUrl, duration_seconds: durationSeconds, cached: false });
  } catch (error) {
    logger.error(`[Podcasts] Error generating daily digest: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate daily digest podcast' });
  }
});

export default router;

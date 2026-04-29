import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getArticleById } from '../db/queries/articles.js';
import { getPodcastByArticleId, savePodcast } from '../db/queries/podcasts.js';
import { generatePodcast } from '../services/ttsService.js';
import { extractEntities } from '../services/llmService.js';
import { getGraphContext } from '../services/graphService.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(requireAuth);

/**
 * POST /podcasts/generate
 * Body: { article_id: UUID }
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

    // 2. If it doesn't exist, fetch the article text
    const article = await getArticleById(article_id);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // 3. Retrieve Graph Context
    logger.info(`[Podcasts] Extracting entities for article ${article_id}`);
    const entities = await extractEntities(article.summary || article.body || "");
    const graphContext = await getGraphContext(entities);
    article.graphContext = graphContext;

    // 4. Generate the audio
    const { audioUrl, durationSeconds } = await generatePodcast(article_id, article, duration_scale || 'default');

    // 5. Save to DB
    await savePodcast(req.user.id, article_id, audioUrl, durationSeconds);

    res.json({ audio_url: audioUrl });
  } catch (error) {
    logger.error(`[Podcasts] Error generating podcast: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate podcast audio' });
  }
});

export default router;

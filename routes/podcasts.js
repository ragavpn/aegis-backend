import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getArticleById } from '../db/queries/articles.js';
import { getPodcastByArticleId, savePodcast } from '../db/queries/podcasts.js';
import { generatePodcast } from '../services/ttsService.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(requireAuth);

/**
 * POST /podcasts/generate
 * Body: { article_id: UUID }
 */
router.post('/generate', async (req, res) => {
  const { article_id } = req.body;

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

    // 3. Generate the audio
    const audio_url = await generatePodcast(article_id, article);

    // 4. Save to DB
    await savePodcast(req.user.id, article_id, audio_url, 0);

    res.json({ audio_url });
  } catch (error) {
    logger.error(`[Podcasts] Error generating podcast: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate podcast audio' });
  }
});

export default router;

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getLatestArticles } from '../db/queries/articles.js';
import { getUserInteractions } from '../db/queries/interactions.js';
import { scoreArticle } from '../services/recommendationEngine.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(requireAuth);

/**
 * GET /articles
 * Returns articles sorted by the user's recommendation score.
 */
router.get('/', async (req, res) => {
  const userId = req.user.id;
  try {
    const [articles, interactions] = await Promise.all([
      getLatestArticles(50),
      getUserInteractions(userId, 20),
    ]);

    const scored = articles
      .map(article => ({ ...article, _score: scoreArticle(article, interactions) }))
      .sort((a, b) => b._score - a._score);

    res.json({ data: scored });
  } catch (error) {
    logger.error(`[Articles] GET /: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

/**
 * POST /articles/generate
 * Manually trigger article generation (pull-to-refresh).
 */
router.post('/generate', async (req, res) => {
  try {
    const { generateAndStoreArticle } = await import('../services/articleGenerator.js');
    await generateAndStoreArticle();
    res.json({ data: { success: true } });
  } catch (error) {
    logger.error(`[Articles] POST /generate: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate articles' });
  }
});

export default router;

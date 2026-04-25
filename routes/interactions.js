import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { upsertInteraction } from '../db/queries/interactions.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(requireAuth);

/**
 * POST /interactions
 * Record or update a user's interaction with an article.
 * Body: { articleId, liked?, bookmarked?, readDurationSeconds?, scrollDepthPercent? }
 */
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { articleId, liked, bookmarked, readDurationSeconds, scrollDepthPercent } = req.body;

  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }

  try {
    const data = await upsertInteraction(userId, {
      articleId,
      liked,
      bookmarked,
      readDurationSeconds,
      scrollDepthPercent,
    });
    res.json({ data });
  } catch (error) {
    logger.error(`[Interactions] POST /: ${error.message}`);
    res.status(500).json({ error: 'Failed to save interaction' });
  }
});

export default router;

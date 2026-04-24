import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPreferences, upsertPreferences } from '../db/queries/preferences.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const prefs = await getPreferences(req.user.id);
    res.json(prefs);
  } catch (error) {
    logger.error(`Error fetching preferences: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

router.put('/', async (req, res) => {
  try {
    const prefs = await upsertPreferences(req.user.id, req.body);
    res.json(prefs);
  } catch (error) {
    logger.error(`Error updating preferences: ${error.message}`);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;

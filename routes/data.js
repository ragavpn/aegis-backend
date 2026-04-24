import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getCrucixLatest, getCrucixHealth } from '../services/crucixClient.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(requireAuth);

router.get('/latest', async (req, res) => {
  try {
    const data = await getCrucixLatest();
    res.json(data);
  } catch (error) {
    logger.error(`Error fetching latest from Crucix: ${error.message}`);
    res.status(502).json({ error: 'Failed to fetch data from Crucix engine' });
  }
});

router.get('/health', async (req, res) => {
  try {
    const data = await getCrucixHealth();
    res.json(data);
  } catch (error) {
    logger.error(`Error fetching health from Crucix: ${error.message}`);
    res.status(502).json({ error: 'Failed to fetch health from Crucix engine' });
  }
});

export default router;

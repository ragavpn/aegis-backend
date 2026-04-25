import express from 'express';
import { saveDeviceToken } from '../db/queries/tokens.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.post('/register-token', async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'FCM token is required' });
  }

  try {
    await saveDeviceToken(token);
    logger.info(`Successfully registered FCM token: \${token.substring(0, 15)}...`);
    res.status(200).json({ success: true, message: 'Token registered successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to register token via API');
    res.status(500).json({ error: 'Internal server error while registering token' });
  }
});

export default router;

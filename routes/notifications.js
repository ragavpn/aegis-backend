import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { saveDeviceToken } from '../db/queries/tokens.js';
import {
  getNotifications,
  markNotificationRead,
  deleteDeviceToken,
} from '../db/queries/notifications.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /notifications/register-token
 * Register FCM device token — no auth required, called on first launch.
 */
router.post('/register-token', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'FCM token is required' });
  }
  try {
    await saveDeviceToken(token);
    res.json({ data: { success: true } });
  } catch (error) {
    logger.error(`[Notifications] register-token: ${error.message}`);
    res.status(500).json({ error: 'Failed to register token' });
  }
});

// All routes below require auth
router.use(requireAuth);

/**
 * GET /notifications
 * List notifications for the authenticated user with unread count.
 */
router.get('/', async (req, res) => {
  try {
    const notifications = await getNotifications(req.user.id);
    const unreadCount = notifications.filter(n => !n.is_read).length;
    res.json({ data: { notifications, unreadCount } });
  } catch (error) {
    logger.error(`[Notifications] GET /: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * PATCH /notifications/:id/read
 * Mark a single notification as read (ownership enforced in query).
 */
router.patch('/:id/read', async (req, res) => {
  try {
    await markNotificationRead(req.user.id, req.params.id);
    res.json({ data: { success: true } });
  } catch (error) {
    logger.error(`[Notifications] PATCH /:id/read: ${error.message}`);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * DELETE /notifications/register-token
 * Remove FCM token on sign-out.
 */
router.delete('/register-token', async (req, res) => {
  try {
    await deleteDeviceToken(req.user.id);
    res.json({ data: { success: true } });
  } catch (error) {
    logger.error(`[Notifications] DELETE register-token: ${error.message}`);
    res.status(500).json({ error: 'Failed to remove token' });
  }
});

export default router;

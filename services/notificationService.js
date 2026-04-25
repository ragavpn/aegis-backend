import admin from 'firebase-admin';
import logger from '../utils/logger.js';
import { getDeviceTokenForUser, getAllDeviceTokensWithUsers } from '../db/queries/tokens.js';
import { insertNotification } from '../db/queries/notifications.js';

let isInitialized = false;

const initFirebase = () => {
  if (isInitialized) return;

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT is missing. Push notifications will be disabled.');
    return;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountRaw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isInitialized = true;
    logger.info('Firebase Admin SDK initialized successfully.');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Firebase Admin SDK. Please ensure FIREBASE_SERVICE_ACCOUNT contains a valid JSON string.');
  }
};

export const sendNotification = async (userId, { tier, title, body, articleId }) => {
  initFirebase();
  if (!isInitialized) return;

  try {
    // 1. Save notification to DB
    await insertNotification(userId, { tier, title, body, articleId });

    // 2. Fetch specific device token
    const token = await getDeviceTokenForUser(userId);
    if (!token) {
      logger.info(`No device token found for user ${userId}. Skipping push notification.`);
      return;
    }

    // 3. Send via FCM
    const message = {
      notification: {
        title,
        body,
      },
      data: {
        articleId: articleId ? articleId.toString() : ''
      },
      android: {
        priority: tier === 'FLASH' ? 'high' : 'normal'
      },
      token: token
    };

    const response = await admin.messaging().send(message);
    logger.info(`Successfully sent push notification to user ${userId}: ${response}`);
  } catch (error) {
    logger.error({ err: error }, `Error sending push notification to user ${userId}`);
  }
};

export const broadcastArticleNotification = async (tier, title, body, articleId) => {
  initFirebase();
  if (!isInitialized) return;

  const tokensWithUsers = await getAllDeviceTokensWithUsers();
  if (!tokensWithUsers || tokensWithUsers.length === 0) {
    logger.info('No device tokens found. Skipping broadcast.');
    return;
  }

  logger.info(`Broadcasting article to ${tokensWithUsers.length} users with tier ${tier}...`);
  for (const { user_id } of tokensWithUsers) {
    if (user_id) {
      await sendNotification(user_id, { tier, title, body, articleId });
    }
  }
};

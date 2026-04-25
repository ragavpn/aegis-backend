import admin from 'firebase-admin';
import logger from '../utils/logger.js';
import { getAllDeviceTokens } from '../db/queries/tokens.js';

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

export const sendArticleNotification = async (articleTitle, articleId) => {
  initFirebase();
  if (!isInitialized) return;

  const tokens = await getAllDeviceTokens();
  if (!tokens || tokens.length === 0) {
    logger.info('No device tokens found. Skipping push notification.');
    return;
  }

  const message = {
    notification: {
      title: 'Aegis Intelligence',
      body: articleTitle,
    },
    data: {
      articleId: articleId.toString()
    },
    tokens: tokens
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    logger.info(`Successfully sent ${response.successCount} push notifications.`);
    if (response.failureCount > 0) {
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          logger.warn(`Failed to send push to token index ${idx}: ${res.error}`);
        }
      });
    }
  } catch (error) {
    logger.error({ err: error }, 'Error sending multicast push notification.');
  }
};

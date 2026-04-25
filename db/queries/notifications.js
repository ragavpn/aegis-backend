import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

/**
 * Fetch notifications for a user, ordered newest first.
 */
export const getNotifications = async (userId, limit = 50) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ err: error }, 'Failed to fetch notifications');
    throw error;
  }
  return data ?? [];
};

/**
 * Mark a single notification as read (validates ownership via user_id).
 */
export const markNotificationRead = async (userId, notificationId) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) {
    logger.error({ err: error }, `Failed to mark notification ${notificationId} as read`);
    throw error;
  }
};

/**
 * Save a new notification row for a user.
 */
export const insertNotification = async (userId, { title, body, type, actionUrl }) => {
  const { data, error } = await supabase
    .from('notifications')
    .insert([{ user_id: userId, title, body, type, action_url: actionUrl, is_read: false }])
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to insert notification');
    throw error;
  }
  return data;
};

/**
 * Remove FCM device token for a user (called on sign-out).
 */
export const deleteDeviceToken = async (userId) => {
  const { error } = await supabase
    .from('device_tokens')
    .delete()
    .eq('user_id', userId);

  if (error) {
    logger.error({ err: error }, 'Failed to delete device token');
    throw error;
  }
};

import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

export const saveDeviceToken = async (userId, token) => {
  const { data, error } = await supabase
    .from('device_tokens')
    .upsert([{ user_id: userId, token }], { onConflict: 'token' })
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to save device token');
    throw error;
  }
  return data;
};

export const getDeviceTokenForUser = async (userId) => {
  const { data, error } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('user_id', userId)
    .single();

  if (error) {
    logger.error({ err: error }, `Failed to fetch device token for user ${userId}`);
    return null;
  }
  return data?.token;
};

export const getAllDeviceTokensWithUsers = async () => {
  const { data, error } = await supabase
    .from('device_tokens')
    .select('user_id, token');

  if (error) {
    logger.error({ err: error }, 'Failed to fetch device tokens with users');
    return [];
  }
  
  return data;
};

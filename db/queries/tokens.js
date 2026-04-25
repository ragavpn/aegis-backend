import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

export const saveDeviceToken = async (token) => {
  const { data, error } = await supabase
    .from('device_tokens')
    .upsert([{ token }], { onConflict: 'token' })
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to save device token');
    throw error;
  }
  return data;
};

export const getAllDeviceTokens = async () => {
  const { data, error } = await supabase
    .from('device_tokens')
    .select('token');

  if (error) {
    logger.error({ err: error }, 'Failed to fetch device tokens');
    return [];
  }
  
  return data.map(row => row.token);
};

import { supabase } from '../supabaseClient.js';

export const getPreferences = async (userId) => {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is 'No rows found'
    throw error;
  }
  return data || {};
};

export const upsertPreferences = async (userId, prefs) => {
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
};

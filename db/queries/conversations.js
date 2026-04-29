import { supabase } from '../supabaseClient.js';
import logger from '../../utils/logger.js';

export const createConversation = async (userId, title = 'New Conversation') => {
  const { data, error } = await supabase
    .from('conversations')
    .insert([{ user_id: userId, title }])
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to create conversation');
    throw error;
  }
  return data;
};

export const addMessage = async (conversationId, role, content) => {
  const { data, error } = await supabase
    .from('messages')
    .insert([{ conversation_id: conversationId, role, content }])
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to add message');
    throw error;
  }
  return data;
};

export const getHistory = async (conversationId, limit = 10) => {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ err: error }, 'Failed to fetch conversation history');
    throw error;
  }
  return data.reverse();
};

export const listConversations = async (userId) => {
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      id,
      title,
      created_at,
      messages:messages(content)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ err: error }, 'Failed to list conversations');
    throw error;
  }
  
  // Format to include last message preview
  return data.map(conv => ({
    id: conv.id,
    title: conv.title,
    created_at: conv.created_at,
    last_message: conv.messages && conv.messages.length > 0 
      ? conv.messages[conv.messages.length - 1].content 
      : null
  }));
};

export const deleteAllConversations = async (userId) => {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('user_id', userId);

  if (error) {
    logger.error({ err: error }, 'Failed to delete conversations');
    throw error;
  }
};

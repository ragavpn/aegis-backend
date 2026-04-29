import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { extractEntitiesFromQuery, chatWithRAG } from '../services/llmService.js';
import { getGraphContext } from '../services/graphService.js';
import { getLatestArticles } from '../db/queries/articles.js';
import { createConversation, addMessage, getHistory, listConversations, deleteAllConversations } from '../db/queries/conversations.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(requireAuth);

// GET /conversations
router.get('/', async (req, res) => {
  try {
    const conversations = await listConversations(req.user.id);
    res.json({ conversations });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// POST /conversations
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = await createConversation(req.user.id, title || 'New Conversation');
    res.json({ conversation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /conversations/:id
router.get('/:id', async (req, res) => {
  try {
    const messages = await getHistory(req.params.id, 50);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch conversation history' });
  }
});

// POST /conversations/:id/messages
router.post('/:id/messages', async (req, res) => {
  const conversationId = req.params.id;
  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  try {
    logger.info(`Processing chat query: "${content}"`);

    // 1. Save user message
    await addMessage(conversationId, 'user', content);

    // 2. Fetch history
    const history = await getHistory(conversationId, 10);
    
    // Convert history format to match the old 'messages' array format expected by chatWithRAG
    const messagesArray = history.map(m => ({ role: m.role, content: m.content }));
    // If the newly added message isn't in the history fetch due to timing, ensure it's there
    if (!messagesArray.some(m => m.content === content)) {
      messagesArray.push({ role: 'user', content });
    }

    // 3. Extract entities + fetch graph context
    const [entities, recentArticles] = await Promise.all([
      extractEntitiesFromQuery(content),
      getLatestArticles(8)
    ]);

    // 4. Fetch graph context
    let graphContext = "";
    if (entities && entities.length > 0) {
      graphContext = await getGraphContext(entities);
    }

    // 5. Build article context
    let articleContext = "";
    if (recentArticles && recentArticles.length > 0) {
      articleContext = "Recent Aegis Intelligence Reports (latest first):\n";
      recentArticles.forEach((article, idx) => {
        const date = article.created_at 
          ? new Date(article.created_at).toISOString().split('T')[0] 
          : 'Unknown date';
        articleContext += `\n[${idx + 1}] ${date} — ${article.title}\n`;
        articleContext += `Summary: ${article.summary}\n`;
      });
    }

    const combinedContext = [graphContext, articleContext].filter(Boolean).join('\n\n---\n\n');

    // 6. Generate RAG response
    const responseText = await chatWithRAG(messagesArray, combinedContext);

    // 7. Save assistant message
    const assistantMessage = await addMessage(conversationId, 'assistant', responseText);

    res.json({
      role: 'assistant',
      content: responseText,
      meta: {
        entitiesExtracted: entities,
        graphContextUsed: !!graphContext && graphContext !== "No relevant graph context found."
      }
    });

  } catch (error) {
    logger.error(`Error in /conversations/:id/messages: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate chat response' });
  }
});

// DELETE /conversations — clear all conversation history for the authenticated user
router.delete('/', async (req, res) => {
  try {
    await deleteAllConversations(req.user.id);
    res.json({ success: true, message: 'All conversations deleted' });
  } catch (error) {
    logger.error(`Error in DELETE /conversations: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete conversations' });
  }
});

export default router;

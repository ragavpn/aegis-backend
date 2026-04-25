import express from 'express';
import { extractEntitiesFromQuery, chatWithRAG } from '../services/llmService.js';
import { getGraphContext } from '../services/graphService.js';
import { getLatestArticles } from '../db/queries/articles.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const latestMessage = messages[messages.length - 1];
  if (latestMessage.role !== 'user') {
    return res.status(400).json({ error: 'The last message must be from the user' });
  }

  try {
    const userQuery = latestMessage.content;
    logger.info(`Processing chat query: "${userQuery}"`);

    // 1. Extract entities + fetch graph context (run in parallel with article fetch)
    const [entities, recentArticles] = await Promise.all([
      extractEntitiesFromQuery(userQuery),
      getLatestArticles(8)
    ]);
    logger.info(`Extracted entities: ${JSON.stringify(entities)}`);

    // 2. Fetch graph context using extracted entities
    let graphContext = "";
    if (entities && entities.length > 0) {
      graphContext = await getGraphContext(entities);
      logger.info(`Graph context retrieved: ${graphContext ? 'Yes' : 'No'}`);
    } else {
      logger.info('No entities extracted, skipping graph context retrieval.');
    }

    // 3. Build article context from the 8 most recent Aegis intelligence reports
    let articleContext = "";
    if (recentArticles && recentArticles.length > 0) {
      articleContext = "Recent Aegis Intelligence Reports (latest first):\n";
      recentArticles.forEach((article, idx) => {
        const date = article.created_at 
          ? new Date(article.created_at).toISOString().split('T')[0] 
          : 'Unknown date';
        articleContext += `\n[${idx + 1}] ${date} — ${article.title}\n`;
        articleContext += `Summary: ${article.summary}\n`;
        if (article.modules && article.modules.length > 0) {
          articleContext += `Modules: ${article.modules.join(', ')}\n`;
        }
      });
    }

    // 4. Combine both context sources
    const combinedContext = [graphContext, articleContext].filter(Boolean).join('\n\n---\n\n');

    // 5. Generate RAG response
    const responseText = await chatWithRAG(messages, combinedContext);

    res.json({
      role: 'assistant',
      content: responseText,
      meta: {
        entitiesExtracted: entities,
        graphContextUsed: !!graphContext && graphContext !== "No relevant graph context found.",
        articleContextUsed: recentArticles?.length > 0
      }
    });

  } catch (error) {
    logger.error(`Error in /conversations/chat: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate chat response' });
  }
});

export default router;

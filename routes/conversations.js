import express from 'express';
import { extractEntitiesFromQuery, chatWithRAG } from '../services/llmService.js';
import { getGraphContext } from '../services/graphService.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  // Get the latest user query
  const latestMessage = messages[messages.length - 1];
  if (latestMessage.role !== 'user') {
    return res.status(400).json({ error: 'The last message must be from the user' });
  }

  try {
    const userQuery = latestMessage.content;
    logger.info(`Processing chat query: "\${userQuery}"`);

    // 1. Extract Entities
    const entities = await extractEntitiesFromQuery(userQuery);
    logger.info(`Extracted entities: \${JSON.stringify(entities)}`);

    // 2. Fetch Graph Context
    let graphContext = "";
    if (entities && entities.length > 0) {
      graphContext = await getGraphContext(entities);
      logger.info(`Graph context retrieved: \${graphContext ? 'Yes' : 'No'}`);
    } else {
      logger.info('No entities extracted, skipping graph context retrieval.');
    }

    // 3. Generate Augmented Response
    const responseText = await chatWithRAG(messages, graphContext);
    
    res.json({
      role: 'assistant',
      content: responseText,
      meta: {
        entitiesExtracted: entities,
        graphContextUsed: !!graphContext
      }
    });

  } catch (error) {
    logger.error(`Error in /conversations/chat: \${error.message}`);
    res.status(500).json({ error: 'Failed to generate chat response' });
  }
});

export default router;

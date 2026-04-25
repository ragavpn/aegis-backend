import { getCrucixLatest } from './crucixClient.js';
import { generateArticle, extractEdges, extractEntities } from './llmService.js';
import { storeEdges, getGraphContext } from './graphService.js';
import { insertArticle } from '../db/queries/articles.js';
import { sendArticleNotification } from './notificationService.js';
import logger from '../utils/logger.js';

export const generateAndStoreArticle = async () => {
  try {
    logger.info('Starting article generation pipeline...');

    // 1. Fetch latest data from Crucix
    const sweepData = await getCrucixLatest();
    if (!sweepData || sweepData.error) {
      logger.warn(`No sweep data available from Crucix: ${sweepData?.error || 'Empty response'}`);
      return false;
    }

    // 2. Prune data to avoid LLM token limits (especially for Groq free tier)
    const prunedData = JSON.parse(JSON.stringify(sweepData));
    if (prunedData.news) {
      prunedData.news = prunedData.news.slice(0, 5).map(n => ({ title: n.title, summary: n.summary ? n.summary.substring(0, 200) : '' }));
    }
    if (prunedData.tg && prunedData.tg.urgent) {
      prunedData.tg.urgent = prunedData.tg.urgent.slice(0, 10).map(p => ({ source: p.source, text: p.text ? p.text.substring(0, 200) : '' }));
    }
    if (prunedData.tg) {
      delete prunedData.tg.feed; // Very large array
      delete prunedData.tg.posts;
    }
    delete prunedData.newsFeed;
    delete prunedData.delta; 
    delete prunedData.ideas; 

    // 3. Extract entities and get graph context
    logger.info('Extracting entities from sweep summary for graph context...');
    const summaryText = JSON.stringify(prunedData.news || prunedData.tg?.urgent || []);
    const entities = await extractEntities(summaryText);
    
    let graphContext = "";
    let graph_context_used = false;

    if (entities && entities.length > 0) {
      logger.info(`Fetching Neo4j graph context for entities: ${entities.join(', ')}`);
      graphContext = await getGraphContext(entities);
      if (graphContext && !graphContext.includes('No relevant graph context found')) {
        graph_context_used = true;
      }
    } else {
      logger.info('No entities extracted, skipping graph context retrieval.');
    }

    // 4. Generate Article
    logger.info('Calling OpenRouter to generate article text...');
    const articleText = await generateArticle(prunedData, graphContext);

    // Provide a simple title/summary extraction manually or ask Gemini to provide a JSON format.
    // For now, we'll assign a placeholder title and summary, but in production we'd want Gemini to format its output as JSON with {title, summary, body}.
    // Let's assume the first line is the title, or we just put a generic one.
    const titleMatch = articleText.split('\n')[0].replace(/#/g, '').trim();
    const title = titleMatch || `Aegis Intelligence Report - ${new Date().toISOString()}`;
    const summary = articleText.substring(0, 200) + '...';

    // 3. Save to Supabase
    const articleData = {
      title,
      body: articleText,
      summary,
      modules: ['Geopolitics', 'Finance'], // Placeholder, in production derive from preferences/data
      sources: sweepData.sources || [],
      sweep_id: sweepData.sweep_id || `sweep-${Date.now()}`,
      graph_context_used
    };

    logger.info('Saving article to Supabase...');
    const savedArticle = await insertArticle(articleData);

    // 4. Extract Edges
    logger.info('Extracting causal edges from the article...');
    const edges = await extractEdges(articleText);

    // 5. Store Edges in Neo4j
    if (edges && edges.length > 0) {
      logger.info(`Storing ${edges.length} edges in Neo4j...`);
      await storeEdges(edges, savedArticle.id);
    } else {
      logger.warn('No edges were extracted from the article.');
    }

    // 6. Send Push Notification
    logger.info('Sending push notifications for the new article...');
    await sendArticleNotification(savedArticle.title, savedArticle.id);

    logger.info('Article generation pipeline completed successfully.');
    return savedArticle;
  } catch (error) {
    logger.error(`Article generation pipeline failed: ${error.message}`);
    throw error;
  }
};

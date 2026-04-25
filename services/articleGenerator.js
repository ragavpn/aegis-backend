import { getCrucixLatest } from './crucixClient.js';
import { generateArticle, extractEdges } from './llmService.js';
import { storeEdges, getGraphContext } from './graphService.js';
import { insertArticle } from '../db/queries/articles.js';
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

    // For the sake of the prototype, we extract some key entities to query the graph context.
    // In a fully developed version, we might use an initial prompt to extract entities from sweep data first.
    // Here we'll just query based on a static list or dynamically extract from the payload.
    // We will ask Gemini to generate the article first, then extract edges from it.
    
    // We can run a preliminary pass to extract entities from sweep data or just pass no graph context initially
    // For simplicity, we won't query Neo4j yet until we have the article generated, OR we could skip graph context for now if we don't have entities.
    // Let's assume we don't have entity names yet, so we pass empty graph context.
    const graphContext = ""; 
    const graph_context_used = false;

    // 2. Generate Article
    logger.info('Calling OpenRouter to generate article text...');
    const articleText = await generateArticle(sweepData, graphContext);

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

    logger.info('Article generation pipeline completed successfully.');
    return savedArticle;
  } catch (error) {
    logger.error(`Article generation pipeline failed: ${error.message}`);
    throw error;
  }
};

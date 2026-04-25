import logger from '../utils/logger.js';

/**
 * Score formula:
 * - Module match: +3 per module the user has spent >30s reading before
 * - Explicit like on same module: +5
 * - Explicit dislike on same module: -10
 * - Read duration on same module (normalised 0–1): ×2 multiplier
 * - Discovery boost: if user has never interacted with this module, add +1
 * 
 * @param {object} article - The article to score
 * @param {Array} interactions - The user's past 20 interactions
 * @returns {number} The computed score
 */
export const scoreArticle = (article, interactions) => {
  let score = 0;
  
  if (!interactions || interactions.length === 0) {
    // Discovery boost for all modules if fresh user
    return article.modules.length * 1; 
  }

  // Pre-calculate interaction weights by module
  const moduleWeights = {};
  interactions.forEach(interaction => {
    // Assuming interaction data has joined article data (or we just use article_id to fetch it)
    // For simplicity, we assume interaction.articles.modules exists
    const modules = interaction.articles?.modules || [];
    
    modules.forEach(mod => {
      if (!moduleWeights[mod]) {
        moduleWeights[mod] = { count: 0, likes: 0, dislikes: 0, totalDuration: 0 };
      }
      moduleWeights[mod].count += 1;
      if (interaction.liked === true) moduleWeights[mod].likes += 1;
      if (interaction.liked === false) moduleWeights[mod].dislikes += 1;
      moduleWeights[mod].totalDuration += (interaction.read_duration_seconds || 0);
    });
  });

  article.modules.forEach(mod => {
    const weight = moduleWeights[mod];
    
    if (!weight) {
      // Discovery boost: never interacted with this module
      score += 1;
    } else {
      // Has interacted with this module
      if (weight.totalDuration > 30) {
        score += 3;
      }
      score += (weight.likes * 5);
      score -= (weight.dislikes * 10);
      
      // Normalised duration (capped at 5 minutes per interaction average = 300s)
      const avgDuration = weight.totalDuration / weight.count;
      const durationNorm = Math.min(avgDuration / 300, 1.0);
      score += (durationNorm * 2);
    }
  });

  return score;
};

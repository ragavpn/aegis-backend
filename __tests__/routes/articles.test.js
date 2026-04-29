import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Mock dependencies
jest.unstable_mockModule('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 'test-user-id' };
    next();
  }
}));

jest.unstable_mockModule('../../db/queries/articles.js', () => ({
  getLatestArticles: jest.fn().mockResolvedValue([
    { id: 'article-1', modules: ['Global Conflict'] },
    { id: 'article-2', modules: ['Cybersecurity'] }
  ])
}));

jest.unstable_mockModule('../../db/queries/interactions.js', () => ({
  getUserInteractions: jest.fn().mockResolvedValue([
    { article_id: 'article-3', liked: true, articles: { modules: ['Cybersecurity'] } }
  ])
}));

// We don't mock scoreArticle to test the integration between the route and the recommendation engine
const { default: articlesRouter } = await import('../../routes/articles.js');

const app = express();
app.use(express.json());
app.use('/articles', articlesRouter);

describe('Articles API', () => {
  it('GET /articles should fetch articles, score them, and return sorted data', async () => {
    const res = await request(app).get('/articles');
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.data).toHaveLength(2);
    // Because the user liked Cybersecurity in interactions, article-2 should score higher than article-1
    expect(res.body.data[0].id).toBe('article-2');
    expect(res.body.data[1].id).toBe('article-1');
    expect(res.body.data[0]._score).toBeDefined();
  });
});

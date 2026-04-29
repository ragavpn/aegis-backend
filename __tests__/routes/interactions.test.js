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

jest.unstable_mockModule('../../db/queries/interactions.js', () => ({
  upsertInteraction: jest.fn().mockResolvedValue({ id: 'int-1', article_id: 'test-article', liked: true })
}));

const { default: interactionsRouter } = await import('../../routes/interactions.js');

const app = express();
app.use(express.json());
app.use('/interactions', interactionsRouter);

describe('Interactions API', () => {
  it('POST /interactions should require articleId', async () => {
    const res = await request(app).post('/interactions').send({ liked: true });
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toBe('articleId is required');
  });

  it('POST /interactions should upsert interaction and return data', async () => {
    const res = await request(app)
      .post('/interactions')
      .send({ articleId: 'test-article', liked: true });
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.data.article_id).toBe('test-article');
    expect(res.body.data.liked).toBe(true);
  });
});

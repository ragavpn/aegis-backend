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

jest.unstable_mockModule('../../db/queries/tokens.js', () => ({
  saveDeviceToken: jest.fn().mockResolvedValue(true)
}));

jest.unstable_mockModule('../../db/queries/notifications.js', () => ({
  getNotifications: jest.fn().mockResolvedValue([
    { id: '1', read: false },
    { id: '2', read: true }
  ]),
  markNotificationRead: jest.fn().mockResolvedValue(true),
  deleteDeviceToken: jest.fn().mockResolvedValue(true),
  insertNotification: jest.fn().mockResolvedValue({ id: 'test-id' })
}));

const { default: notificationsRouter } = await import('../../routes/notifications.js');

const app = express();
app.use(express.json());
app.use('/notifications', notificationsRouter);

describe('Notifications API', () => {
  it('POST /notifications/register-token should save the token', async () => {
    const res = await request(app)
      .post('/notifications/register-token')
      .send({ token: 'test-fcm-token' });
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.data.success).toBe(true);
  });

  it('GET /notifications should fetch list and return unread count', async () => {
    const res = await request(app)
      .get('/notifications');
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.data.notifications).toHaveLength(2);
    expect(res.body.data.unreadCount).toBe(1);
  });

  it('PATCH /notifications/:id/read should mark as read', async () => {
    const res = await request(app)
      .patch('/notifications/1/read');
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.data.success).toBe(true);
  });

  it('DELETE /notifications/register-token should delete token', async () => {
    const res = await request(app)
      .delete('/notifications/register-token');
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.data.success).toBe(true);
  });
});

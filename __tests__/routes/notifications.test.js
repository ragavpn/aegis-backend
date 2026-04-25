import request from 'supertest';
import express from 'express';
import notificationsRouter from '../../routes/notifications.js';

// Mock dependencies
jest.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 'test-user-id' };
    next();
  }
}));

jest.mock('../../db/queries/tokens.js', () => ({
  saveDeviceToken: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../db/queries/notifications.js', () => ({
  getNotifications: jest.fn().mockResolvedValue([
    { id: '1', is_read: false },
    { id: '2', is_read: true }
  ]),
  markNotificationRead: jest.fn().mockResolvedValue(true),
  deleteDeviceToken: jest.fn().mockResolvedValue(true)
}));

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

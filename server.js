import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { validateEnv } from './config/index.js';
import logger from './utils/logger.js';

// Validate env vars before starting
validateEnv();

const app = express();
const PORT = process.env.PORT || 3000;

import { initNeo4j, verifyConnectivity } from './db/neo4jClient.js';
initNeo4j();
verifyConnectivity().catch(err => {
  logger.error('Failed to verify Neo4j at startup:', err);
});

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

import dataRoutes from './routes/data.js';
import preferencesRoutes from './routes/preferences.js';
import conversationsRoutes from './routes/conversations.js';

app.use('/data', dataRoutes);
app.use('/preferences', preferencesRoutes);
app.use('/conversations', conversationsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

import { startSweepWatcher } from './services/sweepWatcher.js';

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  // Start background tasks
  startSweepWatcher();
});

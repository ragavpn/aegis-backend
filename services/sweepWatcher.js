import { generateAndStoreArticle } from './articleGenerator.js';
import logger from '../utils/logger.js';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export const startSweepWatcher = () => {
  logger.info(`Starting sweep watcher. Checking Crucix every ${SWEEP_INTERVAL_MS / 1000 / 60} minutes.`);
  
  // Initial check on boot
  runSweepCheck();

  // Schedule subsequent checks
  setInterval(runSweepCheck, SWEEP_INTERVAL_MS);
};

let isRunning = false;

const runSweepCheck = async () => {
  if (isRunning) {
    logger.warn('Previous sweep check is still running, skipping this interval');
    return;
  }

  isRunning = true;
  try {
    logger.info('Sweep watcher triggered. Running article generator...');
    await generateAndStoreArticle();
  } catch (error) {
    logger.error({ err: error }, 'Sweep watcher failed during article generation');
  } finally {
    isRunning = false;
  }
};

import { generateAndStoreArticle } from './articleGenerator.js';
import { getCrucixHealth, getCrucixDelta } from './crucixClient.js';
import logger from '../utils/logger.js';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let lastKnownSweep = null;
let isRunning = false;

export const startSweepWatcher = () => {
  logger.info(`Starting sweep watcher. Checking Crucix every ${SWEEP_INTERVAL_MS / 1000 / 60} minutes.`);
  
  // Initial check on boot
  runSweepCheck();

  // Schedule subsequent checks
  setInterval(runSweepCheck, SWEEP_INTERVAL_MS);
};

const runSweepCheck = async () => {
  if (isRunning) {
    logger.warn('Previous sweep check is still running, skipping this interval');
    return;
  }

  isRunning = true;
  try {
    const health = await getCrucixHealth();
    
    if (health.lastSweep && health.lastSweep !== lastKnownSweep) {
      logger.info(`New sweep detected (timestamp: ${health.lastSweep}). Triggering article generator...`);
      lastKnownSweep = health.lastSweep;
      
      const delta = await getCrucixDelta();
      let notificationTier = 'ROUTINE';
      if (delta && delta.summary) {
        if (delta.summary.criticalChanges > 0) {
          notificationTier = 'FLASH';
        } else if (delta.summary.totalChanges > 5) {
          notificationTier = 'PRIORITY';
        }
      }
      logger.info(`Evaluated notification tier: ${notificationTier}`);

      // We can pass notificationTier to the generator if needed in the future
      const result = await generateAndStoreArticle();
      
      if (result === false) {
        logger.info('Sweep data not ready. Will check again on next interval.');
      }
    } else {
      logger.info('No new sweep detected. Waiting for next interval.');
    }
  } catch (error) {
    logger.error({ err: error }, 'Sweep watcher failed during check');
  } finally {
    isRunning = false;
  }
};

import { sweepExpiredHolds } from '../services/reservation.service.js';
import { logger } from '../utils/logger.js';

// Periodically releases expired holds. Safe to run on multiple instances
// since sweepExpiredHolds claims each booking with a conditional update.
export function startHoldSweeper({ intervalMs = 15_000 } = {}) {
  let running = false;

  const tick = async () => {
    if (running) return; // skip if the previous sweep is still going
    running = true;
    try {
      const n = await sweepExpiredHolds();
      if (n > 0) logger.info({ expired: n }, 'Released expired holds');
    } catch (err) {
      logger.error({ err }, 'Hold sweeper failed');
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  handle.unref();
  logger.info(`Hold sweeper started (every ${intervalMs}ms)`);
  return handle;
}

import 'dotenv/config';
import { buildApp } from './app';
import { startScheduler } from './scheduler';
import { validateEncryptionKey } from './lib/crypto';
import { logger } from './lib/logger';
import db from './db';

const log = logger.child({ module: 'index' });

if (!process.env.JWT_SECRET) {
  log.fatal('JWT_SECRET env var is not set');
  process.exit(1);
}
try {
  validateEncryptionKey();
} catch (err) {
  log.fatal({ err }, 'encryption key validation failed');
  process.exit(1);
}

const app = buildApp();
const PORT = process.env.PORT || 4000;

let scheduler: { stop: () => Promise<void> } | null = null;

const server = app.listen(PORT, () => {
  log.info({ port: PORT }, 'backend running');
  scheduler = startScheduler();
});

const SHUTDOWN_TIMEOUT_MS = 30_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    log.warn({ signal }, 'second signal received — exiting immediately');
    process.exit(1);
  }
  shuttingDown = true;
  log.info({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutting down gracefully');

  const forceExit = setTimeout(() => {
    log.error('shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close();
  await scheduler?.stop();
  await db.destroy();
  log.info('clean exit');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export default app;

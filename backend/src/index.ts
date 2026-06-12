import 'dotenv/config';
import { buildApp } from './app';
import { startScheduler } from './scheduler';
import { validateEncryptionKey } from './lib/crypto';
import db from './db';

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET env var is not set');
  process.exit(1);
}
try {
  validateEncryptionKey();
} catch (err) {
  console.error(`FATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const app = buildApp();
const PORT = process.env.PORT || 4000;

let scheduler: { stop: () => Promise<void> } | null = null;

const server = app.listen(PORT, () => {
  console.log(`opsatlas backend running on http://localhost:${PORT}`);
  scheduler = startScheduler();
});

const SHUTDOWN_TIMEOUT_MS = 30_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    console.warn(`[shutdown] second ${signal} received — exiting immediately`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing gracefully (max ${SHUTDOWN_TIMEOUT_MS / 1000}s)`);

  const forceExit = setTimeout(() => {
    console.error('[shutdown] timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close();
  await scheduler?.stop();
  await db.destroy();
  console.log('[shutdown] clean exit');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export default app;

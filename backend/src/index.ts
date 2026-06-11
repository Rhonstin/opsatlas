import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import connectionsRouter from './routes/connections';
import syncRouter from './routes/sync';
import instancesRouter from './routes/instances';
import dnsConnectionsRouter from './routes/dns-connections';
import dnsSyncRouter from './routes/dns-sync';
import dnsRecordsRouter from './routes/dns-records';
import autoUpdateRouter from './routes/auto-update';
import billingRouter from './routes/billing';
import configRouter from './routes/config';
import { authenticateToken } from './middleware/auth';
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

const app = express();
const PORT = process.env.PORT || 4000;

// Behind Caddy/Nginx in production — needed so rate limiting sees real client IPs
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await db.raw('select 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

app.use('/auth', authRouter);
app.use('/connections', authenticateToken, connectionsRouter);
app.use('/sync', authenticateToken, syncRouter);
app.use('/instances', authenticateToken, instancesRouter);
app.use('/dns-connections', authenticateToken, dnsConnectionsRouter);
app.use('/dns-sync', authenticateToken, dnsSyncRouter);
app.use('/dns/records', authenticateToken, dnsRecordsRouter);
app.use('/auto-update-policies', authenticateToken, autoUpdateRouter);
app.use('/billing', authenticateToken, billingRouter);
app.use('/config', authenticateToken, configRouter);

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

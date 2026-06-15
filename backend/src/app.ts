/** Express app assembly — no listen, no scheduler, no process side effects.
 * index.ts boots it for production; tests import it directly via supertest. */
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger';
import authRouter from './routes/auth';
import connectionsRouter from './routes/connections';
import syncRouter from './routes/sync';
import instancesRouter from './routes/instances';
import dnsConnectionsRouter from './routes/dns-connections';
import dnsSyncRouter from './routes/dns-sync';
import dnsRecordsRouter from './routes/dns-records';
import autoUpdateRouter from './routes/auto-update';
import billingRouter from './routes/billing';
import favoritesRouter from './routes/favorites';
import tagsRouter from './routes/tags';
import configRouter from './routes/config';
import apiKeysRouter from './routes/api-keys';
import mcpRouter from './mcp/router';
import { authenticateToken, requireAdmin } from './middleware/auth';
import db from './db';

export function buildApp(): express.Express {
  const app = express();

  // Behind Caddy/Nginx in production — needed so rate limiting sees real client IPs
  app.set('trust proxy', 1);

  app.use(pinoHttp({ logger, genReqId: () => crypto.randomUUID() }));
  app.use(cookieParser());
  app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      await db.raw('select 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
  });

  app.use('/mcp', mcpRouter);
  app.use('/auth', authRouter);
  app.use('/connections', authenticateToken, connectionsRouter);
  app.use('/sync', authenticateToken, syncRouter);
  app.use('/instances', authenticateToken, instancesRouter);
  app.use('/dns-connections', authenticateToken, dnsConnectionsRouter);
  app.use('/dns-sync', authenticateToken, dnsSyncRouter);
  app.use('/dns/records', authenticateToken, dnsRecordsRouter);
  app.use('/auto-update-policies', authenticateToken, autoUpdateRouter);
  app.use('/billing', authenticateToken, billingRouter);
  app.use('/favorites', authenticateToken, favoritesRouter);
  app.use('/tags', authenticateToken, tagsRouter);
  app.use('/config', authenticateToken, configRouter);
  app.use('/auth/api-keys', authenticateToken, requireAdmin, apiKeysRouter);

  return app;
}

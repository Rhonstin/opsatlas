import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import favoritesRouter from './routes/favorites';
import { authenticateToken } from './middleware/auth';
import { startScheduler } from './scheduler';

// Fail loudly in production if required env vars are missing
if (process.env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL', 'FRONTEND_URL'];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length) {
    console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 4000;

// Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false, // allow embedding provider OAuth pages
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
}));

const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

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
app.use('/favorites', authenticateToken, favoritesRouter);

app.listen(PORT, () => {
  console.log(`opsatlas backend running on http://localhost:${PORT}`);
  startScheduler();
});

export default app;

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

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`opsatlas backend running on http://localhost:${PORT}`);
  startScheduler();
});

export default app;

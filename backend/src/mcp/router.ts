import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server';
import db from '../db';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'mcp' });

const router = Router();

const transports = new Map<string, StreamableHTTPServerTransport>();

async function authenticateRequest(req: Request): Promise<string | null> {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    const row = await db('api_keys')
      .where({ key_hash: apiKey })
      .select('user_id')
      .first();
    if (row) {
      await db('api_keys').where({ key_hash: apiKey }).update({ last_used_at: new Date() });
      return row.user_id;
    }
  }

  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  const token = cookies?.opsatlas_token ?? req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
      return payload.userId;
    } catch {}
  }

  return null;
}

router.post('/', async (req: Request, res: Response) => {
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          log.info({ sessionId: sid }, 'MCP session initialized');
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          log.info({ sessionId: sid }, 'MCP session closed');
          transports.delete(sid);
        }
      };

      const server = createMcpServer(userId);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log.error({ err: error }, 'MCP request error');
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

router.get('/', async (req: Request, res: Response) => {
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

router.delete('/', async (req: Request, res: Response) => {
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

export default router;

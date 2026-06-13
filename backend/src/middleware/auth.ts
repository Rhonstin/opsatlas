import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  // Read from httpOnly cookie first, fall back to Authorization header (for CLI/tests)
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  const token = cookies?.opsatlas_token
    ?? req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as { userId: string; role?: string };
    req.userId = payload.userId;
    req.userRole = payload.role ?? 'viewer';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

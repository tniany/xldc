import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import { randomToken, tokenHash } from './security.js';

export type SafeUser = {
  id: number; username: string | null; display_name: string; avatar_url: string | null;
  role: 'user' | 'admin'; quota_total: number; quota_used: number; disabled: number;
};

declare global { namespace Express { interface Request { user?: SafeUser } } }

function cookieValue(req: Request, name: string) {
  const item = (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

export function createSession(res: Response, userId: number) {
  const token = randomToken();
  const expires = new Date(Date.now() + 30 * 86400_000);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(tokenHash(token), userId, expires.toISOString());
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `xldc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}

export function clearSession(req: Request, res: Response) {
  const token = cookieValue(req, 'xldc_session');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  res.setHeader('Set-Cookie', 'xldc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export function auth(req: Request, res: Response, next: NextFunction) {
  const token = cookieValue(req, 'xldc_session');
  if (!token) return res.status(401).json({ error: '请先登录' });
  const user = db.prepare(`SELECT u.id,u.username,u.display_name,u.avatar_url,u.role,u.quota_total,u.quota_used,u.disabled
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now')`).get(tokenHash(token)) as SafeUser | undefined;
  if (!user || user.disabled) return res.status(401).json({ error: '登录已失效或账号已停用' });
  req.user = user;
  next();
}

export function admin(req: Request, res: Response, next: NextFunction) {
  auth(req, res, () => req.user?.role === 'admin' ? next() : res.status(403).json({ error: '需要管理员权限' }));
}

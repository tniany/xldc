import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { admin, auth, clearSession, createSession } from './auth.js';
import { db, publicSettings, setting, setSetting } from './db.js';
import { hashPassword, randomToken, tokenHash, verifyPassword } from './security.js';
import { parseUpstreamModelIds, upstreamError, upstreamV1Url } from './model-sync.js';
import { checkinFishRange, hongKongDateKey } from './quota.js';
import { matchesDiscordRequirement, parseDiscordRequirements } from './discord-policy.js';

export const api = Router();
api.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    try {
      if (origin && host && new URL(origin).host !== host) return res.status(403).json({ error: '来源校验失败' });
    } catch { return res.status(403).json({ error: '来源校验失败' }); }
  }
  next();
});

const text = (value: unknown, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const integer = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
const quotaPerFish = () => Math.max(1, Number(setting('quota_per_fish')) || 5000);
const defaultUserQuota = () => integer(setting('new_user_default_fish'), 10) * quotaPerFish();

api.get('/public', (_req, res) => {
  const config = publicSettings();
  res.json({
    ...config,
    discord_enabled: Boolean(config.discord_client_id),
    public_remaining: Math.max(0, Number(config.public_quota_total) - Number(config.public_quota_used)),
  });
});

api.post('/auth/register', (req, res) => {
  if (setting('registration_enabled') !== 'true') return res.status(403).json({ error: '管理员暂未开放注册' });
  const username = text(req.body.username, 32).toLowerCase();
  const password = text(req.body.password, 128);
  if (!/^[a-z0-9_]{3,32}$/.test(username)) return res.status(400).json({ error: '账号需为 3-32 位字母、数字或下划线' });
  if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位' });
  try {
    const result = db.prepare('INSERT INTO users(username,password_hash,display_name,quota_total) VALUES (?,?,?,?)')
      .run(username, hashPassword(password), username, defaultUserQuota());
    createSession(res, Number(result.lastInsertRowid));
    res.status(201).json({ ok: true });
  } catch {
    res.status(409).json({ error: '这个账号已经被注册了' });
  }
});

api.post('/auth/login', (req, res) => {
  const username = text(req.body.username, 32).toLowerCase();
  const password = text(req.body.password, 128);
  const user = db.prepare('SELECT id,password_hash,disabled FROM users WHERE username=?').get(username) as { id: number; password_hash: string | null; disabled: number } | undefined;
  if (!user?.password_hash || !verifyPassword(password, user.password_hash) || user.disabled) return res.status(401).json({ error: '账号或密码不正确' });
  createSession(res, user.id);
  res.json({ ok: true });
});

api.post('/auth/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }); });
api.get('/auth/me', auth, (req, res) => res.json(req.user));

api.get('/auth/discord', (req, res) => {
  const clientId = setting('discord_client_id');
  const redirectUri = setting('discord_redirect_uri');
  if (!clientId || !redirectUri) return res.status(503).send('Discord 登录尚未配置');
  const state = randomToken('state_');
  res.setHeader('Set-Cookie', `xldc_oauth=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: 'identify email guilds guilds.members.read', state });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

api.get('/auth/discord/callback', async (req, res) => {
  const code = text(req.query.code, 300);
  const state = text(req.query.state, 300);
  const cookieState = (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith('xldc_oauth='))?.slice(11);
  if (!code || !state || state !== cookieState) return res.status(400).send('Discord 登录状态无效，请重新尝试');
  try {
    const redirectUri = setting('discord_redirect_uri');
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: setting('discord_client_id'), client_secret: setting('discord_client_secret'), grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    if (!tokenResponse.ok) throw new Error('token exchange failed');
    const token = await tokenResponse.json() as { access_token: string };
    const profileResponse = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new Error('profile fetch failed');
    const profile = await profileResponse.json() as { id: string; username: string; global_name?: string; avatar?: string };
    const displayName = profile.global_name || profile.username;
    const avatar = profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null;
    let user = db.prepare('SELECT id,disabled FROM users WHERE discord_id=?').get(profile.id) as { id: number; disabled: number } | undefined;
    if (!user) {
      if (setting('registration_enabled') !== 'true') return res.status(403).send('管理员暂未开放新用户注册');
      if (setting('discord_registration_requirements_enabled') === 'true') {
        const requirements = parseDiscordRequirements(setting('discord_registration_requirements'));
        if (!requirements.length) return res.status(403).send('Discord 注册限制尚未正确配置，请联系管理员');
        const memberships = new Map<string, string[]>();
        await Promise.all([...new Set(requirements.map(({ guildId }) => guildId))].map(async (guildId) => {
          const response = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
            headers: { authorization: `Bearer ${token.access_token}` },
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) return;
          const member = await response.json() as { roles?: unknown };
          memberships.set(guildId, Array.isArray(member.roles) ? member.roles.filter((role): role is string => typeof role === 'string') : []);
        }));
        if (!matchesDiscordRequirement(requirements, memberships)) {
          return res.status(403).send('你没有加入指定 Discord 服务器或缺少所需身份组，无法注册');
        }
      }
      const result = db.prepare('INSERT INTO users(discord_id,display_name,avatar_url,quota_total) VALUES (?,?,?,?)').run(profile.id, displayName, avatar, defaultUserQuota());
      user = { id: Number(result.lastInsertRowid), disabled: 0 };
    } else {
      db.prepare('UPDATE users SET display_name=?,avatar_url=? WHERE id=?').run(displayName, avatar, user.id);
    }
    if (user.disabled) return res.status(403).send('账号已停用');
    createSession(res, user.id);
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(502).send('Discord 登录失败，请检查后台配置');
  }
});

api.get('/dashboard', auth, (req, res) => {
  const keys = db.prepare('SELECT id,name,prefix,quota_limit,quota_used,revoked,last_used_at,created_at FROM api_keys WHERE user_id=? ORDER BY id DESC').all(req.user!.id);
  const usage = db.prepare("SELECT COALESCE(SUM(tokens),0) tokens FROM usage_logs WHERE user_id=? AND created_at>=datetime('now','-1 day')").get(req.user!.id) as { tokens: number };
  const config = publicSettings();
  const announcements = db.prepare('SELECT id,title,content,created_at FROM announcements WHERE published=1 ORDER BY id DESC LIMIT 5').all();
  const checkin = db.prepare('SELECT quota_granted,quota_used FROM daily_checkins WHERE user_id=? AND checkin_date=?')
    .get(req.user!.id, hongKongDateKey()) as { quota_granted: number; quota_used: number } | undefined;
  const checkinRange = checkinFishRange(setting('checkin_min_fish'), setting('checkin_max_fish'));
  res.json({
    user: req.user,
    keys,
    today_usage: usage.tokens,
    public_remaining: Math.max(0, Number(config.public_quota_total) - Number(config.public_quota_used)),
    quota_per_fish: Number(config.quota_per_fish),
    checkin: {
      claimed: Boolean(checkin),
      reward_quota: checkin?.quota_granted || 0,
      reward_min_quota: checkinRange.min * quotaPerFish(),
      reward_max_quota: checkinRange.max * quotaPerFish(),
      remaining: checkin ? Math.max(0, checkin.quota_granted - checkin.quota_used) : 0,
    },
    announcements,
  });
});

api.post('/checkin', auth, (req, res) => {
  const range = checkinFishRange(setting('checkin_min_fish'), setting('checkin_max_fish'));
  if (range.max <= 0) return res.status(403).json({ error: '管理员暂未开放签到奖励' });
  const rewardFish = randomInt(range.min, range.max + 1);
  const rewardQuota = rewardFish * quotaPerFish();
  const result = db.prepare('INSERT OR IGNORE INTO daily_checkins(user_id,checkin_date,quota_granted) VALUES (?,?,?)')
    .run(req.user!.id, hongKongDateKey(), rewardQuota);
  if (!result.changes) return res.status(409).json({ error: '今天已经签到过了' });
  res.status(201).json({ ok: true, reward_quota: rewardQuota });
});

api.post('/keys', auth, (req, res) => {
  const name = text(req.body.name, 40) || '默认钥匙';
  const perFish = quotaPerFish();
  const quotaLimit = req.body.quota_fish === '' || req.body.quota_fish == null ? null : integer(req.body.quota_fish) * perFish;
  const raw = randomToken('sk-xldc-');
  const prefix = raw.slice(0, 15);
  const result = db.prepare('INSERT INTO api_keys(user_id,name,prefix,key_hash,quota_limit) VALUES (?,?,?,?,?)')
    .run(req.user!.id, name, prefix, tokenHash(raw), quotaLimit);
  res.status(201).json({ id: Number(result.lastInsertRowid), key: raw, prefix, message: '请立即保存，关闭后无法再次查看完整 Key' });
});

api.delete('/keys/:id', auth, (req, res) => {
  const result = db.prepare('UPDATE api_keys SET revoked=1 WHERE id=? AND user_id=?').run(integer(req.params.id), req.user!.id);
  result.changes ? res.json({ ok: true }) : res.status(404).json({ error: '没有找到这个 Key' });
});

api.get('/models', auth, (_req, res) => res.json(db.prepare('SELECT model_id,display_name,description FROM models WHERE enabled=1 ORDER BY sort_order,id').all()));
api.get('/announcements', auth, (_req, res) => res.json(db.prepare('SELECT id,title,content,created_at FROM announcements WHERE published=1 ORDER BY id DESC').all()));

api.get('/admin/overview', admin, (_req, res) => {
  const users = (db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count;
  const keys = (db.prepare('SELECT COUNT(*) count FROM api_keys WHERE revoked=0').get() as { count: number }).count;
  const usage = (db.prepare("SELECT COALESCE(SUM(tokens),0) tokens FROM usage_logs WHERE created_at>=datetime('now','-1 day')").get() as { tokens: number }).tokens;
  res.json({ users, keys, usage, upstream_configured: Boolean(setting('upstream_api_key')) });
});

api.get('/admin/settings', admin, (_req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[];
  const values = Object.fromEntries(rows.map((row) => [row.key, row.key.includes('secret') || row.key.includes('api_key') ? '' : row.value]));
  values.upstream_api_key_configured = String(Boolean(setting('upstream_api_key')));
  values.discord_client_secret_configured = String(Boolean(setting('discord_client_secret')));
  res.json(values);
});

api.put('/admin/settings', admin, (req, res) => {
  const allowed = ['site_name','notice','upstream_url','upstream_api_key','quota_per_fish','public_quota_total','discord_client_id','discord_client_secret','discord_redirect_uri','registration_enabled','test_intercept_enabled','test_intercept_max_tokens','new_user_default_fish','checkin_fish','checkin_min_fish','checkin_max_fish','rpm_limit','coding_tools_block_enabled','coding_tools_blocklist','discord_registration_requirements_enabled','discord_registration_requirements'];
  for (const key of allowed) {
    if (!(key in req.body)) continue;
    const value = text(req.body[key], key.includes('key') || key.includes('secret') ? 1000 : 500);
    if ((key === 'upstream_api_key' || key === 'discord_client_secret') && !value) continue;
    setSetting(key, value);
  }
  res.json({ ok: true });
});

api.get('/admin/users', admin, (_req, res) => res.json(db.prepare('SELECT id,username,display_name,avatar_url,role,quota_total,quota_used,disabled,created_at FROM users ORDER BY id DESC').all()));
api.post('/admin/users', admin, (req, res) => {
  const username = text(req.body.username, 32).toLowerCase();
  const password = text(req.body.password, 128);
  const displayName = text(req.body.display_name, 60) || username;
  if (!/^[a-z0-9_]{3,32}$/.test(username)) return res.status(400).json({ error: '账号需为 3-32 位字母、数字或下划线' });
  if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位' });
  const perFish = quotaPerFish();
  try {
    db.prepare('INSERT INTO users(username,password_hash,display_name,quota_total) VALUES (?,?,?,?)')
      .run(username, hashPassword(password), displayName, req.body.quota_fish === '' || req.body.quota_fish == null ? defaultUserQuota() : integer(req.body.quota_fish) * perFish);
    res.status(201).json({ ok: true });
  } catch {
    res.status(409).json({ error: '这个账号已经存在' });
  }
});
api.patch('/admin/users/:id', admin, (req, res) => {
  const quotaTotal = integer(req.body.quota_fish) * quotaPerFish();
  const disabled = req.body.disabled ? 1 : 0;
  db.prepare('UPDATE users SET quota_total=?,disabled=? WHERE id=?').run(quotaTotal, disabled, integer(req.params.id));
  res.json({ ok: true });
});

api.get('/admin/models', admin, (_req, res) => res.json(db.prepare('SELECT * FROM models ORDER BY sort_order,id').all()));
api.post('/admin/models/sync', admin, async (_req, res) => {
  const upstreamKey = setting('upstream_api_key');
  if (!upstreamKey) return res.status(400).json({ error: '请先配置上游 API Key' });
  const modelsUrl = upstreamV1Url(setting('upstream_url'), 'models');
  try {
    const response = await fetch(modelsUrl, {
      headers: { authorization: `Bearer ${upstreamKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = upstreamError(payload);
      return res.status(502).json({ error: `上游模型接口返回 ${response.status}${detail ? `：${detail}` : ''}` });
    }
    const modelIds = parseUpstreamModelIds(payload);
    if (!modelIds.length) return res.status(502).json({ error: '上游没有返回有效模型' });
    const existing = new Set((db.prepare('SELECT model_id FROM models').all() as { model_id: string }[]).map((model) => model.model_id));
    const maxSort = Number((db.prepare('SELECT COALESCE(MAX(sort_order),0) value FROM models').get() as { value: number }).value);
    const upsert = db.prepare(`INSERT INTO models(model_id,display_name,description,enabled,sort_order) VALUES (?,?,?,1,?)
      ON CONFLICT(model_id) DO UPDATE SET enabled=1,
      description=CASE WHEN models.description IN ('','来自上游同步','来自小老鼠奶酪工坊主站')
      THEN excluded.description ELSE models.description END`);
    db.exec('BEGIN IMMEDIATE');
    try {
      modelIds.forEach((modelId, index) => upsert.run(modelId, modelId, '来自小老鼠奶酪工坊主站', maxSort + index + 1));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ ok: true, fetched: modelIds.length, added: modelIds.filter((id) => !existing.has(id)).length });
  } catch (error) {
    console.error('upstream model sync failed', { url: modelsUrl, error });
    const detail = error instanceof Error ? error.message : '';
    res.status(502).json({ error: `连接上游模型接口失败${detail ? `：${detail}` : ''}` });
  }
});
api.post('/admin/models', admin, (req, res) => {
  const modelId = text(req.body.model_id, 100);
  if (!modelId) return res.status(400).json({ error: '模型 ID 不能为空' });
  db.prepare('INSERT INTO models(model_id,display_name,description,enabled,sort_order) VALUES (?,?,?,?,?) ON CONFLICT(model_id) DO UPDATE SET display_name=excluded.display_name,description=excluded.description,enabled=excluded.enabled,sort_order=excluded.sort_order')
    .run(modelId, text(req.body.display_name, 100) || modelId, text(req.body.description, 300), req.body.enabled === false ? 0 : 1, integer(req.body.sort_order));
  res.json({ ok: true });
});
api.delete('/admin/models/:id', admin, (req, res) => { db.prepare('DELETE FROM models WHERE id=?').run(integer(req.params.id)); res.json({ ok: true }); });

api.get('/admin/usage', admin, (req, res) => {
  const limit = Math.min(500, Math.max(1, integer(req.query.limit, 100)));
  res.json(db.prepare(`SELECT l.id,u.username,u.display_name,k.name key_name,l.created_at,l.model,l.endpoint,l.tokens,
    l.first_byte_ms,l.duration_ms,l.ip,l.request_headers,l.status
    FROM usage_logs l JOIN users u ON u.id=l.user_id
    LEFT JOIN api_keys k ON k.id=l.api_key_id ORDER BY l.id DESC LIMIT ?`).all(limit));
});

api.get('/admin/announcements', admin, (_req, res) => res.json(db.prepare('SELECT * FROM announcements ORDER BY id DESC').all()));
api.post('/admin/announcements', admin, (req, res) => {
  const title = text(req.body.title, 100), content = text(req.body.content, 2000);
  if (!title || !content) return res.status(400).json({ error: '标题和内容都不能为空' });
  db.prepare('INSERT INTO announcements(title,content,published) VALUES (?,?,?)').run(title, content, req.body.published === false ? 0 : 1);
  res.json({ ok: true });
});
api.delete('/admin/announcements/:id', admin, (req, res) => { db.prepare('DELETE FROM announcements WHERE id=?').run(integer(req.params.id)); res.json({ ok: true }); });

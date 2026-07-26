import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashPassword } from './security.js';

const dbFile = resolve(process.env.DATA_DIR || './data', 'xldc.db');
mkdirSync(dirname(dbFile), { recursive: true });
export const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,
  discord_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  quota_total INTEGER NOT NULL DEFAULT 50000,
  quota_used INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  quota_limit INTEGER,
  quota_used INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  api_key_id INTEGER REFERENCES api_keys(id),
  model TEXT,
  endpoint TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_checkins (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,
  quota_granted INTEGER NOT NULL,
  quota_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, checkin_date)
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
`);

const defaults: Record<string, string> = {
  site_name: '小老鼠的奶酪工坊 - DC 分站',
  notice: '欢迎来到奶酪工坊，领取你的专属钥匙开始投喂灵感吧。',
  upstream_url: 'https://api.openai.com',
  upstream_api_key: '',
  quota_per_fish: '5000',
  public_quota_total: '5000000',
  public_quota_used: '0',
  discord_client_id: '',
  discord_client_secret: '',
  discord_redirect_uri: '',
  registration_enabled: 'true',
  test_intercept_enabled: 'false',
  test_intercept_max_tokens: '0',
  new_user_default_fish: '10',
  checkin_fish: '1',
  checkin_min_fish: '1',
  checkin_max_fish: '3',
  rpm_limit: '0',
  coding_tools_block_enabled: 'false',
  coding_tools_blocklist: 'codex,codex_cli,claude-code,claude_cli,cursor,cline,continue,aider,opencode,roo-code,roocode,windsurf',
};

const usageColumns = new Set((db.prepare('PRAGMA table_info(usage_logs)').all() as { name: string }[]).map((column) => column.name));
const usageMigrations: Record<string, string> = {
  duration_ms: 'ALTER TABLE usage_logs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0',
  first_byte_ms: 'ALTER TABLE usage_logs ADD COLUMN first_byte_ms INTEGER NOT NULL DEFAULT 0',
  ip: "ALTER TABLE usage_logs ADD COLUMN ip TEXT NOT NULL DEFAULT ''",
  request_headers: "ALTER TABLE usage_logs ADD COLUMN request_headers TEXT NOT NULL DEFAULT '{}'",
};
for (const [column, sql] of Object.entries(usageMigrations)) {
  if (!usageColumns.has(column)) db.exec(sql);
}
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value);

if (!(db.prepare('SELECT id FROM users WHERE role = ?').get('admin'))) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'change-me-now';
  db.prepare('INSERT INTO users(username,password_hash,display_name,role,quota_total) VALUES (?,?,?,?,?)')
    .run(username, hashPassword(password), '工坊管理员', 'admin', 500000);
  console.warn(`[bootstrap] Admin account created: ${username}. Change the default password immediately.`);
}
if (!(db.prepare('SELECT id FROM announcements LIMIT 1').get())) {
  db.prepare('INSERT INTO announcements(title,content) VALUES (?,?)')
    .run('工坊开张啦', '欢迎来到 DC 分站。请妥善保管 API Key，不要在公开频道中分享。');
}
if (!(db.prepare('SELECT id FROM models LIMIT 1').get())) {
  const stmt = db.prepare('INSERT INTO models(model_id,display_name,description,sort_order) VALUES (?,?,?,?)');
  stmt.run('gpt-4o-mini', 'GPT-4o mini', '快速、经济，适合日常对话与轻量任务', 1);
  stmt.run('gpt-4o', 'GPT-4o', '综合能力更强的多模态模型', 2);
}

export function setting(key: string) {
  return (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined)?.value || '';
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

export function publicSettings() {
  const keys = ['site_name', 'notice', 'quota_per_fish', 'public_quota_total', 'public_quota_used', 'discord_client_id', 'registration_enabled'];
  return Object.fromEntries(keys.map((key) => [key, setting(key)]));
}

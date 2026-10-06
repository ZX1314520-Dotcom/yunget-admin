/**
 * YunGet 管理后台 - 数据库初始化与访问
 * 引擎：better-sqlite3（同步、简单、单文件）
 */
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'yunget.db');

const fs = require('fs');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  android_ver TEXT NOT NULL DEFAULT '',
  app_ver TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'online',
  last_seen_at INTEGER,
  first_seen_at INTEGER,
  extra TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  downloaded INTEGER NOT NULL DEFAULT 0,
  speed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL NOT NULL DEFAULT 0,
  source_pan TEXT NOT NULL DEFAULT '',
  error TEXT DEFAULT '',
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_name TEXT NOT NULL DEFAULT '',
  logged_in INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

const DEFAULT_SETTINGS = {
  'admin_token': '',
  'server_name': 'YunGet 管理后台',
  'max_devices': '1000',
  'task_ttl_days': '30',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

module.exports = db;
module.exports.DB_PATH = DB_PATH;

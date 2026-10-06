/*
 * YunGet 管理后台 - HTTP 服务
 * 对外 API（供 YunGet App 上报）：
 *   POST /api/device/register    设备注册
 *   POST /api/device/heartbeat   设备心跳 + 批量任务上报
 *   POST /api/task              上报单个任务
 *   GET  /api/device/:id/tasks   拉取设备任务（预留）
 *  Web 管理界面：GET / （静态页面）
 */
const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : '';
}

function adminAuth(req, res, next) {
  const token = getSetting('admin_token');
  if (!token) return next();
  const auth = req.headers['x-admin-token'] || req.query.token;
  if (auth === token) return next();
  return res.status(401).json({ code: 401, error: '未授权：缺少或错误的 admin_token' });
}

function clientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

/* ============ App 上报 API（供 YunGet 客户端调用） ============ */

app.post('/api/device/register', (req, res) => {
  const b = req.body || {};
  const id = String(b.device_id || '').trim();
  if (!id) return res.status(400).json({ code: 400, error: '缺少 device_id' });

  const now = Date.now();
  const name = String(b.name || '').slice(0, 64);
  const model = String(b.model || '').slice(0, 64);
  const androidVer = String(b.android_ver || '').slice(0, 32);
  const appVer = String(b.app_ver || '').slice(0, 32);

  const exist = db.prepare('SELECT * FROM devices WHERE id=?').get(id);
  if (exist) {
    db.prepare('UPDATE devices SET name=?, model=?, android_ver=?, app_ver=?, ip=?, status=?, last_seen_at=? WHERE id=?')
      .run(name || exist.name, model || exist.model, androidVer || exist.android_ver, appVer || exist.app_ver, clientIP(req), 'online', now, id);
    return res.json({ code: 0, msg: 'updated', server_name: getSetting('server_name'), now });
  }

  db.prepare('INSERT INTO devices (id, name, model, android_ver, app_ver, ip, status, last_seen_at, first_seen_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, name, model, androidVer, appVer, clientIP(req), 'online', now, now);

  res.json({ code: 0, msg: 'registered', server_name: getSetting('server_name'), now });
});

app.post('/api/device/heartbeat', (req, res) => {
  const b = req.body || {};
  const id = String(b.device_id || '').trim();
  if (!id) return res.status(400).json({ code: 400, error: '缺少 device_id' });

  const now = Date.now();
  const exist = db.prepare('SELECT status FROM devices WHERE id=?').get(id);
  if (!exist) return res.status(404).json({ code: 404, error: '设备未注册，请先 register' });
  if (exist.status === 'banned') {
    db.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').run(now, id);
    return res.status(403).json({ code: 403, error: '设备已被禁用', banned: true });
  }

  db.prepare("UPDATE devices SET status='online', last_seen_at=?, ip=? WHERE id=?").run(now, clientIP(req), id);

  const tasks = Array.isArray(b.tasks) ? b.tasks : [];
  const upsertTask = db.prepare(`
    INSERT INTO tasks (id, device_id, file_name, url, size, downloaded, speed, status, progress, source_pan, error, created_at, updated_at)
    VALUES (@id, @device_id, @file_name, @url, @size, @downloaded, @speed, @status, @progress, @source_pan, @error, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      file_name=excluded.file_name, size=excluded.size, downloaded=excluded.downloaded,
      speed=excluded.speed, status=excluded.status, progress=excluded.progress,
      source_pan=excluded.source_pan, error=excluded.error, updated_at=excluded.updated_at
  `);
  const tx = db.transaction((items) => {
    for (const t of items) {
      if (!t.id) continue;
      upsertTask.run({
        id: String(t.id), device_id: id,
        file_name: String(t.file_name || '').slice(0, 256),
        url: String(t.url || '').slice(0, 2048),
        size: Number(t.size) || 0,
        downloaded: Number(t.downloaded) || 0,
        speed: Number(t.speed) || 0,
        status: String(t.status || 'pending'),
        progress: Math.min(100, Math.max(0, Number(t.progress) || 0)),
        source_pan: String(t.source_pan || ''),
        error: String(t.error || '').slice(0, 512),
        created_at: Number(t.created_at) || now,
        updated_at: now,
      });
    }
  });
  tx(tasks);

  const accounts = Array.isArray(b.accounts) ? b.accounts : [];
  const upsertAcc = db.prepare('INSERT INTO accounts (device_id, platform, account_name, logged_in, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_name=excluded.account_name, logged_in=excluded.logged_in, updated_at=excluded.updated_at');
  db.prepare('DELETE FROM accounts WHERE device_id=?').run(id);
  for (const a of accounts) {
    if (!a.platform) continue;
    upsertAcc.run(id, String(a.platform), String(a.account_name || '').slice(0, 128), a.logged_in === false ? 0 : 1, now);
  }

  res.json({ code: 0, server_name: getSetting('server_name'), now, commands: [] });
});

app.post('/api/task', (req, res) => {
  const b = req.body || {};
  const deviceId = String(b.device_id || '').trim();
  const taskId = String(b.id || b.task_id || '').trim();
  if (!deviceId || !taskId) return res.status(400).json({ code: 400, error: '缺少 device_id 或 id' });
  const dev = db.prepare('SELECT status FROM devices WHERE id=?').get(deviceId);
  if (!dev) return res.status(404).json({ code: 404, error: '设备未注册' });
  const now = Date.now();
  db.prepare('INSERT INTO tasks (id, device_id, file_name, url, size, downloaded, speed, status, progress, source_pan, error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET file_name=excluded.file_name, size=excluded.size, downloaded=excluded.downloaded, speed=excluded.speed, status=excluded.status, progress=excluded.progress, source_pan=excluded.source_pan, error=excluded.error, updated_at=excluded.updated_at')
    .run(taskId, deviceId, String(b.file_name||''), String(b.url||''), Number(b.size)||0, Number(b.downloaded)||0, Number(b.speed)||0, String(b.status||'pending'), Math.min(100, Math.max(0, Number(b.progress)||0)), String(b.source_pan||''), String(b.error||''), now, now);
  res.json({ code: 0 });
});

app.get('/api/device/:id/tasks', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks WHERE device_id=? ORDER BY updated_at DESC LIMIT 500').all(req.params.id);
  res.json({ code: 0, tasks: rows });
});

/* ============ 管理 API ============ */

app.get('/api/admin/stats', adminAuth, (req, res) => {
  const online = db.prepare("SELECT COUNT(*) c FROM devices WHERE status='online'").get().c;
  const totalDevices = db.prepare('SELECT COUNT(*) c FROM devices').get().c;
  const totalTasks = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;
  const activeTasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status IN ('downloading','queued','pending')").get().c;
  const completed = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='completed'").get().c;
  const failed = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='failed'").get().c;
  const downloadedBytes = db.prepare("SELECT COALESCE(SUM(downloaded),0) s FROM tasks WHERE status='completed'").get().s;
  res.json({ code: 0, stats: { online, totalDevices, totalTasks, activeTasks, completed, failed, downloadedBytes } });
});

app.get('/api/admin/devices', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC LIMIT 500').all();
  res.json({ code: 0, devices: rows });
});

app.post('/api/admin/device/:id', adminAuth, (req, res) => {
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.name !== undefined) { sets.push('name=?'); vals.push(String(b.name).slice(0,64)); }
  if (b.status !== undefined) { sets.push('status=?'); vals.push(String(b.status)); }
  if (sets.length === 0) return res.json({ code: 0, msg: 'no change' });
  vals.push(req.params.id);
  db.prepare('UPDATE devices SET ' + sets.join(',') + ' WHERE id=?').run(...vals);
  res.json({ code: 0 });
});

app.delete('/api/admin/device/:id', adminAuth, (req, res) => {
  const tx = db.transaction((id) => {
    db.prepare('DELETE FROM tasks WHERE device_id=?').run(id);
    db.prepare('DELETE FROM accounts WHERE device_id=?').run(id);
    db.prepare('DELETE FROM devices WHERE id=?').run(id);
  });
  tx(req.params.id);
  res.json({ code: 0 });
});

app.get('/api/admin/tasks', adminAuth, (req, res) => {
  const { device_id, status, page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT t.*, d.name AS device_name FROM tasks t LEFT JOIN devices d ON d.id=t.device_id WHERE 1=1';
  const params = {};
  if (device_id) { sql += ' AND t.device_id=@device_id'; params.device_id = device_id; }
  if (status) { sql += ' AND t.status=@status'; params.status = status; }
  sql += ' ORDER BY t.updated_at DESC LIMIT @limit OFFSET @offset';
  const limit = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
  const rows = db.prepare(sql).all({ ...params, limit, offset });
  const total = db.prepare('SELECT COUNT(*) c FROM tasks t WHERE 1=1' + (device_id ? ' AND t.device_id=@device_id' : '') + (status ? ' AND t.status=@status' : '')).get(params).c;
  res.json({ code: 0, tasks: rows, total, page: Number(page) || 1, pageSize: limit });
});

app.delete('/api/admin/task/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  res.json({ code: 0 });
});

app.get('/api/admin/accounts', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT a.*, d.name AS device_name FROM accounts a LEFT JOIN devices d ON d.id=a.device_id ORDER BY a.updated_at DESC LIMIT 500').all();
  res.json({ code: 0, accounts: rows });
});

app.get('/api/admin/settings', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ code: 0, settings });
});
app.post('/api/admin/settings', adminAuth, (req, res) => {
  const b = req.body || {};
  const set = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) set.run(String(k).slice(0,64), String(v));
  });
  tx(b);
  res.json({ code: 0 });
});

/* ============ 静态管理界面 ============ */
app.use(express.static(PUBLIC_DIR));

/* ============ 离线设备扫描（定时） ============ */
setInterval(() => {
  const threshold = Date.now() - 90 * 1000;
  db.prepare("UPDATE devices SET status='offline' WHERE last_seen_at < ? AND status='online'").run(threshold);
}, 30 * 1000);

/* ============ 启动 ============ */
app.listen(PORT, () => {
  console.log('YunGet 管理后台已启动: http://localhost:' + PORT);
  console.log('数据库: ' + db.DB_PATH);
  const token = getSetting('admin_token');
  console.log(token ? '管理鉴权令牌已启用' : '管理鉴权令牌未设置（公开访问）');
});

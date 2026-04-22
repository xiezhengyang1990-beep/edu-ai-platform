/**
 * 教培AI运营中台 - SaaS后端服务器
 * Express + SQLite + JWT
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 9527;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES = '7d';

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== 数据库初始化 =====
const db = new Database(path.join(__dirname, '../data/edu-ai-saas.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'owner' CHECK(role IN ('owner', 'admin', 'member')),
    org_id INTEGER,
    trial_start DATETIME DEFAULT CURRENT_TIMESTAMP,
    trial_end DATETIME,
    subscription_status TEXT DEFAULT 'trial' CHECK(subscription_status IN ('trial', 'active', 'expired', 'cancelled')),
    subscription_plan TEXT DEFAULT 'basic',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );

  CREATE TABLE IF NOT EXISTS orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT DEFAULT 'education',
    max_accounts INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS org_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id),
    UNIQUE(org_id, key)
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    age INTEGER,
    grade TEXT,
    source TEXT,
    status TEXT DEFAULT 'active',
    tags TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    subjects TEXT,
    schedule TEXT,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    subject TEXT,
    target_age TEXT,
    price REAL,
    capacity INTEGER,
    description TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );

  CREATE TABLE IF NOT EXISTS content_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    input_data TEXT,
    output_content TEXT,
    style TEXT DEFAULT 'professional',
    is_favorite INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS communications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    student_id INTEGER,
    parent_name TEXT,
    content TEXT,
    ai_suggestions TEXT,
    emotion_tag TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id),
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS finances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    category TEXT,
    amount REAL NOT NULL,
    student_id INTEGER,
    description TEXT,
    date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id),
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    source TEXT,
    status TEXT DEFAULT 'new',
    stage TEXT DEFAULT 'awareness',
    notes TEXT,
    estimated_value REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );

  CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    code TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );
`);

// ===== JWT认证中间件 =====
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// 订阅状态检查
function subscriptionCheck(req, res, next) {
  const user = req.user;
  if (user.subscription_status === 'expired' || user.subscription_status === 'cancelled') {
    return res.status(403).json({ error: '订阅已过期，AI功能不可用', code: 'SUBSCRIPTION_EXPIRED' });
  }
  next();
}

// ===== 认证路由 =====

// 注册
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, phone, orgName } = req.body;
    
    if (!email || !password || !name || !orgName) {
      return res.status(400).json({ error: '请填写所有必填项' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }

    // 检查邮箱是否已注册
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(400).json({ error: '该邮箱已注册' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30天试用

    const transaction = db.transaction(() => {
      // 创建机构
      const orgResult = db.prepare('INSERT INTO orgs (name, max_accounts) VALUES (?, 5)').run(orgName);
      const orgId = orgResult.lastInsertRowid;

      // 创建用户
      const userResult = db.prepare(
        'INSERT INTO users (email, password_hash, name, phone, role, org_id, trial_start, trial_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(email, passwordHash, name, phone || null, 'owner', orgId, new Date().toISOString(), trialEnd);

      return { userId: userResult.lastInsertRowid, orgId };
    });

    const { userId, orgId } = transaction();

    const token = jwt.sign(
      { id: userId, email, name, role: 'owner', orgId, subscription_status: 'trial' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: { id: userId, email, name, role: 'owner', orgId, subscription_status: 'trial', trial_end: trialEnd }
    });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' });
    }

    const user = db.prepare(`
      SELECT u.*, o.name as org_name, o.max_accounts 
      FROM users u JOIN orgs o ON u.org_id = o.id 
      WHERE u.email = ?
    `).get(email);

    if (!user) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    // 检查并更新订阅状态
    let subStatus = user.subscription_status;
    if (subStatus === 'trial' && new Date(user.trial_end) < new Date()) {
      subStatus = 'expired';
      db.prepare('UPDATE users SET subscription_status = ? WHERE id = ?').run('expired', user.id);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.org_id, subscription_status: subStatus },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        orgId: user.org_id, orgName: user.org_name, subscription_status: subStatus,
        trial_end: user.trial_end
      }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// 获取当前用户信息
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.org_id, u.subscription_status, u.trial_end,
           o.name as org_name, o.max_accounts
    FROM users u JOIN orgs o ON u.org_id = o.id
    WHERE u.id = ?
  `).get(req.user.id);

  if (!user) return res.status(404).json({ error: '用户不存在' });

  res.json({
    id: user.id, email: user.email, name: user.name, role: user.role,
    orgId: user.org_id, orgName: user.org_name, subscription_status: user.subscription_status,
    trial_end: user.trial_end, max_accounts: user.max_accounts
  });
});

// ===== 机构路由 =====

// 获取机构信息
app.get('/api/org', authMiddleware, (req, res) => {
  const org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(req.user.orgId);
  if (!org) return res.status(404).json({ error: '机构不存在' });

  const memberCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE org_id = ?').get(req.user.orgId);
  const config = db.prepare('SELECT key, value FROM org_config WHERE org_id = ?').all(req.user.orgId);
  
  const configMap = {};
  config.forEach(c => configMap[c.key] = c.value);

  res.json({ ...org, member_count: memberCount.count, config: configMap });
});

// 更新机构配置
app.put('/api/org/config', authMiddleware, (req, res) => {
  if (req.user.role !== 'owner' && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }

  const upsert = db.prepare(`
    INSERT INTO org_config (org_id, key, value, updated_at) 
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      upsert.run(req.user.orgId, key, value);
    }
  });

  transaction(req.body);
  res.json({ ok: true });
});

// 邀请成员
app.post('/api/org/invite', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: '仅机构所有者可邀请成员' });
  }

  const org = db.prepare('SELECT max_accounts FROM orgs WHERE id = ?').get(req.user.orgId);
  const memberCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE org_id = ?').get(req.user.orgId);

  if (memberCount.count >= org.max_accounts) {
    return res.status(400).json({ error: '已达到最大账号数，请升级套餐' });
  }

  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT INTO invite_codes (org_id, code, max_uses) VALUES (?, ?, 1)').run(req.user.orgId, code);

  res.json({ code });
});

// 通过邀请码加入机构
app.post('/api/org/join', authMiddleware, (req, res) => {
  const { code } = req.body;
  const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND used < max_uses').get(code);

  if (!invite) return res.status(400).json({ error: '邀请码无效或已使用' });

  db.prepare('UPDATE users SET org_id = ?, role = ? WHERE id = ?').run(invite.org_id, 'member', req.user.id);
  db.prepare('UPDATE invite_codes SET used = used + 1 WHERE id = ?').run(invite.id);

  res.json({ ok: true, orgId: invite.org_id });
});

// ===== 数据路由 (CRUD) =====

// 通用CRUD生成器
function createCrudRoutes(tableName, requiredFields = []) {
  // 列表
  app.get(`/api/data/${tableName}`, authMiddleware, (req, res) => {
    const rows = db.prepare(`SELECT * FROM ${tableName} WHERE org_id = ? ORDER BY created_at DESC`).all(req.user.orgId);
    res.json(rows);
  });

  // 创建
  app.post(`/api/data/${tableName}`, authMiddleware, (req, res) => {
    const data = { ...req.body, org_id: req.user.orgId };
    for (const f of requiredFields) {
      if (!data[f]) return res.status(400).json({ error: `缺少必填项: ${f}` });
    }
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = fields.map(() => '?').join(',');
    const result = db.prepare(`INSERT INTO ${tableName} (${fields.join(',')}) VALUES (${placeholders})`).run(...values);
    res.json({ id: result.lastInsertRowid, ...data });
  });

  // 更新
  app.put(`/api/data/${tableName}/:id`, authMiddleware, (req, res) => {
    const data = req.body;
    // 确保只能更新自己机构的数据
    const existing = db.prepare(`SELECT id FROM ${tableName} WHERE id = ? AND org_id = ?`).get(req.params.id, req.user.orgId);
    if (!existing) return res.status(404).json({ error: '记录不存在' });

    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map(f => `${f} = ?`).join(',');
    db.prepare(`UPDATE ${tableName} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND org_id = ?`).run(...values, req.params.id, req.user.orgId);
    res.json({ ok: true });
  });

  // 删除
  app.delete(`/api/data/${tableName}/:id`, authMiddleware, (req, res) => {
    const result = db.prepare(`DELETE FROM ${tableName} WHERE id = ? AND org_id = ?`).run(req.params.id, req.user.orgId);
    if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ ok: true });
  });
}

createCrudRoutes('students', ['name']);
createCrudRoutes('teachers', ['name']);
createCrudRoutes('courses', ['name']);
createCrudRoutes('content_history');
createCrudRoutes('communications');
createCrudRoutes('finances');
createCrudRoutes('leads', ['name']);

// ===== AI代理路由 =====
app.post('/api/ai/chat', authMiddleware, subscriptionCheck, async (req, res) => {
  const { messages, model, temperature, max_tokens } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: '请提供对话内容' });
  }

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY || ''}`
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages,
        temperature: temperature || 0.7,
        max_tokens: max_tokens || 4096,
        stream: true
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('DeepSeek API错误:', err);
      return res.status(502).json({ error: 'AI服务暂时不可用' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (streamErr) {
      console.error('Stream error:', streamErr);
    } finally {
      res.end();
    }
  } catch (err) {
    console.error('AI请求失败:', err);
    res.status(500).json({ error: 'AI请求失败' });
  }
});

// ===== 静态文件服务 =====
app.use(express.static(path.join(__dirname, '../public')));

// SPA回退 - 除API外所有路由返回index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API不存在' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   教培AI运营中台 - SaaS服务器已启动    ║
  ║   http://localhost:${PORT}              ║
  ╚══════════════════════════════════════╝
  `);
});

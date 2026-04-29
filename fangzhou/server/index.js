const express = require('express');
const path = require('path');
const db = require('./db');
const aiService = require('./services/ai');
const uploadRoutes = require('./routes/upload');
const dashboardRoutes = require('./routes/dashboard');

const PORT = 18898;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(PUBLIC_DIR));

// ── Initialize DB on startup ──
let ready = false;
(async () => {
  await db.getDb();
  console.log('📦 SQLite 数据库就绪');
  ready = true;
})();

// ── API Routes ──

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (
    (username || '').toLowerCase() === 'sam' && password === 'sam888'
  ) {
    return res.json({ success: true, role: '校长', user: 'Sam' });
  }
  res.status(401).json({ success: false, message: '用户名或密码错误' });
});

// Upload + Dashboard APIs (from route modules)
app.use('/api', uploadRoutes);
app.use('/api', dashboardRoutes);

// ⏳ Wait for DB before processing requests
app.use('/api', (req, res, next) => {
  if (ready) return next();
  res.status(503).json({ error: '数据库初始化中，请稍后重试' });
});

// ── AI 洞察 (legacy, now backed by AI service) ──
app.get('/api/ai/insight', async (req, res) => {
  try {
    const diag = await aiService.generateDiagnosis({
      revenue: db.query('SELECT COALESCE(SUM(revenue),0) as r FROM revenue_data WHERE month=(SELECT MAX(month) FROM revenue_data)')[0]?.r || 0
    });
    res.json({
      highlights: (diag.highlights || []).map(h => ({ icon: 'chart-up', text: h })),
      warnings: (diag.warnings || []).map(w => ({ icon: 'alert', text: w })),
      suggestions: (diag.suggestions || []).map(s => ({ icon: 'bulb', text: s }))
    });
  } catch(e) {
    res.json({
      highlights: [{ icon: 'chart-up', text: '本月营收数据已更新，可在驾驶舱查看详细趋势。' }],
      warnings: [{ icon: 'alert', text: '数据加载中，请稍后刷新。' }],
      suggestions: [{ icon: 'bulb', text: '建议上传最新月份的数据。' }]
    });
  }
});

// ── Alert resolve (legacy) ──
app.post('/api/alert/resolve', (req, res) => {
  res.json({ success: true });
});

// ── Fallback to index.html ──
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('┌─────────────────────────────────────┐');
  console.log('│   方舟智管 ArkInsight Server v3.0    │');
  console.log(`│    http://0.0.0.0:${PORT}           │`);
  console.log('│    Login: SAM / sam888               │');
  console.log('│    DB: SQLite + JSON fallback        │');
  console.log('└─────────────────────────────────────┘');
});

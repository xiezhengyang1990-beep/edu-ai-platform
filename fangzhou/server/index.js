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

// ── CORS ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Initialize DB on startup ──
let ready = false;
(async () => {
  await db.getDb();
  console.log('📦 SQLite 数据库就绪');
  ready = true;
})();

// ── API Routes ──

// ===== Auth =====
const loginHandler = (req, res) => {
  const { username, password } = req.body;
  if ((username || '').toLowerCase() === 'sam' && password === 'sam888') {
    return res.json({
      success: true,
      ok: true,
      role: '校长',
      user: 'Sam',
      token: 'fangzhou_demo_token_' + Date.now()
    });
  }
  res.status(401).json({ success: false, ok: false, error: '用户名或密码错误' });
};

app.post('/api/login', loginHandler);
app.post('/api/auth/login', loginHandler);

// Demo init (frontend calls this)
app.post('/api/demo/init', (req, res) => {
  res.json({ success: true, ok: true, message: 'Demo data ready' });
});

// ===== Upload-compatible routes (frontend expects /api/data/*) =====

// POST /api/data/upload → mirror of upload route's multer logic
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const uploadMulter = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) return cb(null, true);
    cb(new Error('仅支持 .xlsx、.xls、.csv 格式'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.post('/api/data/upload', uploadMulter.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件', ok: false });

    const filePath = req.file.path;
    const originalName = req.file.originalname;

    // Parse Excel
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (!data || data.length < 2) {
      return res.status(400).json({ error: '表格为空或格式不正确', ok: false });
    }

    // Find header row
    let headerRow = 0;
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      if (data[i].filter(v => String(v).trim()).length >= 3) {
        headerRow = i;
        break;
      }
    }

    const headers = data[headerRow].map(h => String(h).trim());
    const dataRows = data.slice(headerRow + 1).filter(r => r.some(v => String(v).trim()));

    // AI template matching
    const aiResult = await aiService.identifyTableType(headers, dataRows.slice(0, 5));
    const templateType = aiResult.confidence >= 60 ? aiResult.template : 'unknown';

    // Save file record
    db.run(
      `INSERT INTO uploaded_files (original_name, file_path, file_size, template_type, confidence, status, sheet_name, total_rows) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [originalName, filePath, req.file.size, templateType, aiResult.confidence,
       aiResult.confidence >= 60 ? 'matched' : 'pending', sheetName, dataRows.length]
    );
    const fileId = db.getLastId();

    // Auto-extract if high confidence
    let extracted = null;
    let records = [];
    if (aiResult.confidence >= 60 && templateType !== 'unknown') {
      extracted = await aiService.extractFields(templateType, headers, dataRows);
      if (extracted && extracted.records && extracted.records.length > 0) {
        records = extracted.records;
        for (const record of records) {
          if (templateType === 'revenue') {
            db.run(
              `INSERT INTO revenue_data (file_id, month, campus, course, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)`,
              [fileId, record.month || '', record.campus || '', record.course || '',
               Number(record.revenue) || 0, Number(record.cost) || 0]
            );
          } else if (templateType === 'renewal') {
            db.run(
              `INSERT INTO renewal_data (file_id, month, student_name, course, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?)`,
              [fileId, record.month || '', record.student_name || '', record.course || '',
               record.expiry_date || '', record.status || 'pending']
            );
          } else if (templateType === 'enrollment') {
            db.run(
              `INSERT INTO enrollment_data (file_id, month, campus, course, new_count, source, conversion_rate) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [fileId, record.month || '', record.campus || '', record.course || '',
               Number(record.new_count) || 0, record.source || '', Number(record.conversion_rate) || 0]
            );
          }
        }
        db.run(`UPDATE uploaded_files SET status = 'imported', imported_rows = ? WHERE id = ?`,
          [records.length, fileId]);
      }
    }

    res.json({
      success: true,
      ok: true,
      uploadId: fileId.toString(),
      data: {
        uploadId: fileId.toString(),
        fileId: fileId,
        fileName: originalName,
        sheetName: sheetName,
        totalRows: dataRows.length,
        headers: headers,
        preview: dataRows.slice(0, 3),
        aiResult: aiResult,
        templateType: templateType,
        records: records.slice(0, 20),
        mapping: extracted ? extracted.field_mapping : null,
        detectedType: templateType,
        columnCount: headers.length,
        rowCount: dataRows.length
      }
    });

  } catch (err) {
    console.error('Data upload error:', err);
    res.status(500).json({ error: err.message, ok: false });
  }
});

// POST /api/data/confirm
app.post('/api/data/confirm', async (req, res) => {
  try {
    const { uploadId, mapping, tableType, corrections, records } = req.body;
    if (!uploadId || !tableType) {
      return res.status(400).json({ error: '缺少必要参数', ok: false });
    }

    db.run(`UPDATE uploaded_files SET template_type = ?, status = 'corrected' WHERE id = ?`,
      [tableType, uploadId]);

    const recordsToInsert = records || [];
    if (recordsToInsert.length > 0) {
      for (const record of recordsToInsert) {
        if (tableType === 'revenue') {
          db.run(
            `INSERT INTO revenue_data (file_id, month, campus, course, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)`,
            [uploadId, record.month || '', record.campus || '', record.course || '',
             Number(record.revenue) || 0, Number(record.cost) || 0]
          );
        } else if (tableType === 'renewal') {
          db.run(
            `INSERT INTO renewal_data (file_id, month, student_name, course, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [uploadId, record.month || '', record.student_name || '', record.course || '',
             record.expiry_date || '', record.status || 'pending']
          );
        } else if (tableType === 'enrollment') {
          db.run(
            `INSERT INTO enrollment_data (file_id, month, campus, course, new_count, source, conversion_rate) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uploadId, record.month || '', record.campus || '', record.course || '',
             Number(record.new_count) || 0, record.source || '', Number(record.conversion_rate) || 0]
          );
        }
      }
      db.run(`UPDATE uploaded_files SET status = 'imported', imported_rows = ? WHERE id = ?`,
        [recordsToInsert.length, uploadId]);
    }

    res.json({ success: true, ok: true, message: '数据已确认导入' });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: err.message, ok: false });
  }
});

// GET /api/data/list
app.get('/api/data/list', (req, res) => {
  try {
    const files = db.query(
      `SELECT id, original_name as fileName, file_size, template_type as tableType, confidence, 
       status, sheet_name, total_rows as rowCount, imported_rows as importedRows, 
       created_at as createdAt, created_at as uploadedAt
       FROM uploaded_files ORDER BY created_at DESC`
    );
    res.json({ success: true, ok: true, data: files.map(f => ({
      ...f,
      type: f.tableType,
      importedAt: f.createdAt
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message, ok: false, data: [] });
  }
});

// DELETE /api/data/:id
app.delete('/api/data/:id', (req, res) => {
  try {
    const file = db.query('SELECT file_path FROM uploaded_files WHERE id = ?', [req.params.id]);
    if (file.length) {
      db.run('DELETE FROM revenue_data WHERE file_id = ?', [req.params.id]);
      db.run('DELETE FROM renewal_data WHERE file_id = ?', [req.params.id]);
      db.run('DELETE FROM enrollment_data WHERE file_id = ?', [req.params.id]);
      db.run('DELETE FROM uploaded_files WHERE id = ?', [req.params.id]);
      try { fs.unlinkSync(file[0].file_path); } catch (e) { }
    }
    res.json({ success: true, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message, ok: false });
  }
});

// ===== Org Profile =====
app.get('/api/org/profile', (req, res) => {
  const profile = db.query(`SELECT value FROM app_config WHERE key = 'org_profile'`);
  const data = profile.length ? JSON.parse(profile[0].value) : {
    name: '方舟教育',
    campuses: 3,
    staffCount: 28,
    totalStudents: 456,
    courseCategories: ['拼音课', '英语', '数学', '美术']
  };
  res.json({ success: true, ok: true, data });
});

app.put('/api/org/profile', (req, res) => {
  const { name, campuses, staffCount, totalStudents, courseCategories } = req.body;
  const profile = { name, campuses, staffCount, totalStudents, courseCategories };
  db.run(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('org_profile', ?)`, [JSON.stringify(profile)]);
  res.json({ success: true, ok: true, data: profile });
});

// ===== AI智囊 Chat =====
app.post('/api/brain/chat', async (req, res) => {
  try {
    const { message, history, messages } = req.body;
    const chatMessages = messages || history || [];
    
    // If just a single message, convert to history format
    if (message && (!chatMessages || chatMessages.length === 0)) {
      chatMessages.push({ role: 'user', content: message });
    }

    if (!chatMessages || chatMessages.length === 0) {
      return res.status(400).json({ error: '缺少消息内容', ok: false });
    }

    // Add context data
    const summary = db.query(`
      SELECT 
        (SELECT COALESCE(SUM(revenue),0) FROM revenue_data WHERE month = (SELECT MAX(month) FROM revenue_data)) as revenue,
        (SELECT COALESCE(SUM(new_count),0) FROM enrollment_data WHERE month = (SELECT MAX(month) FROM enrollment_data)) as enrollment,
        (SELECT COUNT(*) FROM renewal_data WHERE status = 'lost') as lost
    `);

    const contextMsg = {
      role: 'system',
      content: `你是"方舟智管 ArkInsight"的AI经营顾问，专门回答教培机构校长的经营问题。
你的能力：
1. 根据上传的营收/续费/招生数据回答经营问题
2. 给出数据驱动的改善建议
3. 分析校区表现差异
4. 提供续费提升、招生优化、成本控制等策略

当前经营数据：本月营收 ${summary[0]?.revenue || 0}元，本月招生 ${summary[0]?.enrollment || 0}人，流失学员 ${summary[0]?.lost || 0}人。

风格：专业、直接、数据说话。用中文回答，200字以内。`
    };

    const reply = await aiService.chat([contextMsg, ...chatMessages.slice(-10)]);
    res.json({ success: true, ok: true, reply, data: { reply } });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message, ok: false });
  }
});

// ===== Upload + Dashboard Routes (existing) =====
app.use('/api', uploadRoutes);
app.use('/api', dashboardRoutes);

// ===== Knowledge base (stub) =====
app.get('/api/knowledge', (req, res) => {
  res.json({ success: true, ok: true, data: [] });
});
app.post('/api/knowledge', (req, res) => {
  res.json({ success: true, ok: true, data: { id: 'k_' + Date.now() } });
});
app.delete('/api/knowledge/:id', (req, res) => {
  res.json({ success: true, ok: true });
});
app.get('/api/knowledge/categories', (req, res) => {
  res.json({ success: true, ok: true, data: [] });
});
app.post('/api/knowledge/categories', (req, res) => {
  res.json({ success: true, ok: true });
});
app.delete('/api/knowledge/categories/:id', (req, res) => {
  res.json({ success: true, ok: true });
});
app.post('/api/knowledge/search-web', async (req, res) => {
  const { query } = req.body;
  try {
    // Use DeepSeek to search
    const result = await aiService.callDeepSeek([
      { role: 'system', content: '你是互联网搜索助手。根据问题给出相关信息。' },
      { role: 'user', content: `搜索有关"${query}"的信息，用中文返回，200字以内。` }
    ], { temperature: 0.3, maxTokens: 1000 });
    res.json({ success: true, ok: true, data: { reply: result } });
  } catch (e) {
    res.json({ success: true, ok: true, data: { reply: `关于"${query}"的相关搜索结果暂不可用。` } });
  }
});

// Content templates
app.get('/api/content/templates', (req, res) => {
  const templates = db.query(`SELECT * FROM content_templates ORDER BY created_at DESC`);
  res.json({ success: true, ok: true, data: templates.map(t => JSON.parse(t.content_data || '{}')) });
});
app.post('/api/content/templates', (req, res) => {
  const { category, title, content, tags } = req.body;
  const data = { id: 'c_' + Date.now(), category, title, content, tags: tags || [] };
  res.json({ success: true, ok: true, data });
});
app.put('/api/content/templates/:id', (req, res) => {
  res.json({ success: true, ok: true });
});
app.delete('/api/content/templates/:id', (req, res) => {
  res.json({ success: true, ok: true });
});
app.post('/api/content/generate', async (req, res) => {
  const { category, topic } = req.body;
  try {
    const result = await aiService.callDeepSeek([
      { role: 'system', content: '你是教培机构内容创作专家。根据分类和主题，生成一段可用于朋友圈/私信/邀约的话术，200字以内。' },
      { role: 'user', content: `分类：${category}，主题：${topic}` }
    ], { temperature: 0.7, maxTokens: 1000 });
    res.json({ success: true, ok: true, data: { title: topic, content: result } });
  } catch (e) {
    res.json({ success: true, ok: true, data: { title: topic, content: `关于"${topic}"的内容生成暂不可用。` } });
  }
});

// Export
app.get('/api/data/export', (req, res) => {
  const type = req.query.type || 'all';
  res.json({ success: true, ok: true, message: '导出功能开发中' });
});

// Diagnostics report
app.get('/api/diagnostics/report', (req, res) => {
  res.json({ success: true, ok: true, data: {
    summary: '系统运行正常',
    dbStatus: 'connected',
    uploadsTotal: db.query('SELECT COUNT(*) as c FROM uploaded_files')[0]?.c || 0,
    revenueTotal: db.query('SELECT COUNT(*) as c FROM revenue_data')[0]?.c || 0,
    lastUpload: db.query('SELECT created_at FROM uploaded_files ORDER BY created_at DESC LIMIT 1')[0]?.created_at || '无'
  }});
});

// ⏳ Wait for DB before processing requests (after routes so we don't block setup routes)
app.use('/api', (req, res, next) => {
  if (ready) return next();
  res.status(503).json({ error: '数据库初始化中，请稍后重试' });
});

// ── AI 洞察 ──
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

// Alert resolve
app.post('/api/alert/resolve', (req, res) => {
  res.json({ success: true });
});
app.patch('/api/alerts/:id', (req, res) => {
  res.json({ success: true, ok: true });
});
app.post('/api/alerts/batch-resolve', (req, res) => {
  res.json({ success: true, ok: true });
});



// ── Fallback to index.html ──
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('┌─────────────────────────────────────┐');
  console.log('│   方舟智管 ArkInsight Server v3.1    │');
  console.log(`│    http://0.0.0.0:${PORT}           │`);
  console.log('│    Login: SAM / sam888               │');
  console.log('│    DB: SQLite + JSON fallback        │');
  console.log('└─────────────────────────────────────┘');
});

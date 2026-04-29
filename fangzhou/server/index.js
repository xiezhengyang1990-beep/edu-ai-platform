const express = require('express');
const path = require('path');
const fs = require('fs');

const PORT = 18898;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DB_FILE = path.join(__dirname, '..', 'public', 'db.json');

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ── Database ──
const defaultDB = () => ({
  loginUsers: [
    { username: 'sam', password: 'sam888', role: '校长' }
  ],
  dashboard: {
    revenue: 2395000,
    target: 3000000,
    renewalRate: 72.6,
    newStudents: 88,
    newStudentTarget: 100,
    revenueTrend: [
      { month: '2024-10', value: 1850000 },
      { month: '2024-11', value: 1920000 },
      { month: '2024-12', value: 2100000 },
      { month: '2025-01', value: 1780000 },
      { month: '2025-02', value: 1650000 },
      { month: '2025-03', value: 2395000 }
    ],
    studentStructure: [
      { label: '语数英', value: 156 },
      { label: '思维训练', value: 98 },
      { label: '其他', value: 88 }
    ],
    campusRanking: [
      { name: '浦东校区', revenue: 582000 },
      { name: '徐汇校区', revenue: 523000 },
      { name: '静安校区', revenue: 491000 },
      { name: '闵行校区', revenue: 412000 },
      { name: '虹口校区', revenue: 387000 }
    ],
    alerts: [
      { level: 'red', title: '虹口校区营收完成率仅65%，低于预警线', time: new Date().toISOString(), resolved: false },
      { level: 'orange', title: '静安校区续费率环比下降3.2%', time: new Date().toISOString(), resolved: false },
      { level: 'yellow', title: '4月有23名学员续费即将到期', time: new Date().toISOString(), resolved: false },
      { level: 'blue', title: '浦东校区连续3月排名第一', time: new Date().toISOString(), resolved: false }
    ]
  }
});

let db = defaultDB();

// Load or init DB
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) { db = defaultDB(); }
} else {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ── API Routes ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.loginUsers.find(
    u => u.username.toLowerCase() === (username || '').toLowerCase() && 
         u.password === password
  );
  if (user) {
    return res.json({ success: true, role: user.role });
  }
  res.status(401).json({ success: false, message: '用户名或密码错误' });
});

app.get('/api/dashboard', (req, res) => {
  res.json(db.dashboard);
});

app.post('/api/alert/resolve', (req, res) => {
  const { index } = req.body;
  if (typeof index === 'number' && db.dashboard.alerts[index]) {
    db.dashboard.alerts[index].resolved = true;
    saveDB();
    return res.json({ success: true });
  }
  // Resolve all
  if (index === undefined) {
    db.dashboard.alerts.forEach(a => a.resolved = true);
    saveDB();
    return res.json({ success: true });
  }
  res.status(400).json({ success: false });
});

app.get('/api/ai/insight', (req, res) => {
  res.json({
    highlights: [
      { icon: 'chart-up', text: '本月营收239.5万，目标完成率79.8%，续费率72.6%保持稳定。' },
      { icon: 'star', text: '浦东校区连续3月排名第一，营收58.2万。' }
    ],
    warnings: [
      { icon: 'alert', text: '虹口校区营收完成率仅65%，建议加强市场推广和销售跟进。' },
      { icon: 'alert', text: '续费率72.6%相比上月下降2.1%，需关注学员服务体验。' }
    ],
    suggestions: [
      { icon: 'bulb', text: '建议本周召开校区运营会议，重点分析虹口校区问题。' },
      { icon: 'bulb', text: '4月有23名学员即将到期，建议提前启动续费跟进。' }
    ]
  });
});

// ── Fallback to index.html ──
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('┌─────────────────────────────────────┐');
  console.log('│   方舟智管 ArkInsight Server v2.0    │');
  console.log(`│    http://0.0.0.0:${PORT}           │`);
  console.log('│    Login: SAM / sam888               │');
  console.log('└─────────────────────────────────────┘');
});

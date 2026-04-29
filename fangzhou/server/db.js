/**
 * 方舟智管 ArkInsight — SQLite 数据库模块
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'arkinsight.db');
let db = null;

async function getDb() {
  if (db) return db;
  
  const SQL = await initSqlJs();
  
  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  
  initSchema();
  return db;
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      file_path TEXT,
      file_size INTEGER DEFAULT 0,
      template_type TEXT,
      confidence REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      sheet_name TEXT,
      total_rows INTEGER DEFAULT 0,
      imported_rows INTEGER DEFAULT 0,
      error_msg TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS revenue_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER REFERENCES uploaded_files(id),
      month TEXT NOT NULL,
      campus TEXT DEFAULT '',
      course TEXT DEFAULT '',
      revenue REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS renewal_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER REFERENCES uploaded_files(id),
      month TEXT NOT NULL,
      student_name TEXT DEFAULT '',
      course TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS content_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_data TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS enrollment_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER REFERENCES uploaded_files(id),
      month TEXT NOT NULL,
      campus TEXT DEFAULT '',
      course TEXT DEFAULT '',
      new_count INTEGER DEFAULT 0,
      source TEXT DEFAULT '',
      conversion_rate REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  
  // Check if data exists, insert sample if not
  const count = db.exec("SELECT COUNT(*) as c FROM revenue_data");
  if (!count.length || count[0].values[0][0] === 0) {
    insertSampleData();
  }
}

function insertSampleData() {
  // Insert a system file record first
  db.run("INSERT INTO uploaded_files (original_name, template_type, status) VALUES (?,?,?)",
    ['system_sample', 'revenue', 'imported']);
  const sysId = getLastId();
  
  const months = ['2025-11','2025-12','2026-01','2026-02','2026-03','2026-04'];
  
  months.forEach((m, i) => {
    const revenue = [120000, 190000, 230000, 260000, 210000, 280000][i];
    const cost = [72000, 114000, 138000, 156000, 126000, 168000][i];
    db.run("INSERT INTO revenue_data (file_id, month, campus, course, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)",
      [sysId, m, '金桥校区', '综合', revenue, cost]);
    db.run("INSERT INTO revenue_data (file_id, month, campus, course, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)",
      [sysId, m, '森宏校区', '综合', Math.round(revenue * 0.6), Math.round(cost * 0.6)]);
  });
  
  // Renewal sample
  db.run("INSERT INTO renewal_data (file_id, month, student_name, course, expiry_date, status) VALUES (?,?,?,?,?,?)",
    [sysId, '2026-04', '张天佑', '拼音课', '2026-06-30', 'pending']);
  db.run("INSERT INTO renewal_data (file_id, month, student_name, course, expiry_date, status) VALUES (?,?,?,?,?,?)",
    [sysId, '2026-04', '赵祎恺', '拼音课', '2026-05-15', 'pending']);
  db.run("INSERT INTO renewal_data (file_id, month, student_name, course, expiry_date, status) VALUES (?,?,?,?,?,?)",
    [sysId, '2026-04', '陈逸锴', '英语', '2026-04-30', 'lost']);
  db.run("INSERT INTO renewal_data (file_id, month, student_name, course, expiry_date, status) VALUES (?,?,?,?,?,?)",
    [sysId, '2026-04', '孙先生', '多课程', '2026-05-20', 'renewed']);
  
  // Enrollment sample
  db.run("INSERT INTO enrollment_data (file_id, month, campus, course, new_count, source, conversion_rate) VALUES (?,?,?,?,?,?,?)",
    [sysId, '2026-04', '金桥校区', '拼音课', 12, '地推', 0.33]);
  db.run("INSERT INTO enrollment_data (file_id, month, campus, course, new_count, source, conversion_rate) VALUES (?,?,?,?,?,?,?)",
    [sysId, '2026-04', '森宏校区', '美术', 8, '点评', 0.28]);
  db.run("INSERT INTO enrollment_data (file_id, month, campus, course, new_count, source, conversion_rate) VALUES (?,?,?,?,?,?,?)",
    [sysId, '2026-04', '金桥校区', '英语', 6, '转介绍', 0.45]);
  db.run("INSERT INTO enrollment_data (file_id, month, campus, course, new_count, source, conversion_rate) VALUES (?,?,?,?,?,?,?)",
    [sysId, '2026-04', '周浦校区', '数学', 15, '地推', 0.30]);
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Query Helpers ──

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

function getLastId() {
  return db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
}

module.exports = { getDb, query, run, getLastId, save };

/**
 * 春续暑待跟进学员数据 → 续费数据导入
 * Uses dense mode + ref truncation to handle 1M-row Excel ranges
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'uploads');
const db = require('../db');

const files = fs.readdirSync(uploadDir).filter(f => f.includes('1777487262825'));
if (!files.length) { console.error('春续暑 file not found'); process.exit(1); }

const filePath = path.join(uploadDir, files[0]);
console.log('Reading:', files[0]);

// Read with dense:true to handle 1M-row ranges
const wb = XLSX.read(fs.readFileSync(filePath), {type: 'buffer', cellDates: false, dense: true});

// Truncate refs before reading data
['G1 2 3未转化明细', '可跟进学员明细及动作'].forEach(name => {
  const ws = wb.Sheets[name];
  if (ws && ws['!ref']) {
    const parts = ws['!ref'].split(':');
    const oldEnd = parts[1] || 'XFD1048576';
    // Keep column range, cap rows to 5000
    const colMatch = oldEnd.match(/^([A-Z]+)/);
    const col = colMatch ? colMatch[1] : 'XFD';
    ws['!ref'] = 'A1:' + col + '5000';
  }
});

// Read data
const data0 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: ''});
const data1 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]], {defval: ''});
const data2 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[2]], {defval: ''});

console.log(`Sheet0: ${data0.length} rows, Sheet1: ${data1.length} rows, Sheet2: ${data2.length} rows`);

// Show follow-up categories
console.log('\n=== 跟进分类汇总 ===');
data2.forEach(r => {
  console.log(`  ${r['沟通结果分类（G1G2G3）']}: 可跟进${r['可跟进总数']}人`);
  if (r['教师动作']) console.log(`    教师: ${r['教师动作'].slice(0,60)}`);
  if (r['运营动作']) console.log(`    运营: ${r['运营动作'].slice(0,60)}`);
});

// Import: students with 0 remaining hours
const allStudents = [...data0, ...data1];
const toImport = allStudents.filter(r => {
  const h = parseFloat(r['剩余总课时（0428）'] || r['剩余课时'] || 0);
  return h <= 0 || isNaN(h);
});

console.log(`\n=== 导入到数据库 ===`);
console.log(`待导入课时耗尽学员: ${toImport.length}人`);

const before = db.query('SELECT COUNT(*) as cnt FROM renewal_data');
console.log(`Before: ${before[0]?.cnt || 0} 行`);

let imported = 0, errors = 0;
toImport.slice(0, 500).forEach(r => {
  try {
    db.run(
      `INSERT INTO renewal_data (student_name, campus, course, remaining_hours, teacher, grade, status, month) VALUES (?,?,?,?,?,?,?,?)`,
      [
        (r['学员姓名'] || '').toString().trim(),
        (r['授课校区'] || '').toString().trim(),
        (r['消耗班级产品名称'] || '').toString().trim(),
        parseFloat(r['剩余总课时（0428）'] || r['剩余课时'] || 0),
        (r['教师'] || '').toString().trim(),
        (r['年级'] || '').toString().trim(),
        '待跟进-课时耗尽',
        '2026-04'
      ]
    );
    imported++;
  } catch(e) { errors++; }
});

const after = db.query('SELECT COUNT(*) as cnt FROM renewal_data');
console.log(`After: ${after[0]?.cnt} 行 (新增 ${imported}, 错误 ${errors})`);

// Summary
const summary = db.query(`
  SELECT campus, COUNT(*) as cnt 
  FROM renewal_data 
  WHERE status LIKE '待跟进%'
  GROUP BY campus ORDER BY cnt DESC LIMIT 20
`);
console.log('\n=== 各校区续费跟进名单（前20） ===');
summary.forEach(r => console.log(`  ${r.campus}: ${r.cnt}人`));

// Dashboard impact
const total = db.query(`SELECT COUNT(*) as cnt FROM renewal_data WHERE status LIKE '待跟进%'`);
const campusCount = db.query(`SELECT COUNT(DISTINCT campus) as cnt FROM renewal_data WHERE status LIKE '待跟进%'`);
console.log(`\n总计待跟进: ${total[0]?.cnt}人, ${campusCount[0]?.cnt}个校区`);
console.log('DONE');

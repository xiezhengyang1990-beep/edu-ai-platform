/**
 * 春续暑待跟进学员数据 → 续费数据导入
 * Step 1: Pre-process XML to fix 1M-row dimension
 * Step 2: Read fixed file with xlsx
 * Step 3: Import into DB
 */
const XLSX = require('xlsx');
const path = require('path');
const db = require('../db');

async function main() {
  // Initialize DB
  await db.getDb();
  console.log('DB ready');
  
  const wb = XLSX.readFile('/tmp/xlsx_fixed.xlsx', {type: 'buffer', cellDates: false});
  console.log('Sheets:', wb.SheetNames.length);
  
  const data0 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: ''});
  const data1 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]], {defval: ''});
  const data2 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[2]], {defval: ''});
  
  console.log(`Data: Sheet0=${data0.length}, Sheet1=${data1.length}, Sheet2=${data2.length}`);
  
  console.log('\n=== 跟进分类 ===');
  data2.forEach(r => {
    console.log(`  ${r['沟通结果分类（G1G2G3）']}: ${r['可跟进总数']}人`);
  });
  
  const all = [...data0, ...data1];
  const urgent = all.filter(r => {
    const h = parseFloat(r['剩余总课时（0428）'] || r['剩余课时'] || 0);
    return h <= 0 || isNaN(h);
  });
  
  console.log(`\n课时耗尽学员: ${urgent.length}人`);
  
  const before = db.query('SELECT COUNT(*) as cnt FROM renewal_data');
  console.log(`DB导入前: ${before[0]?.cnt || 0}行`);
  
  let imported = 0, errors = 0;
  urgent.slice(0, 500).forEach(r => {
    try {
      db.run(
        `INSERT INTO renewal_data (student_name, campus, course, remaining_hours, teacher, grade, status, month) VALUES (?,?,?,?,?,?,?,?)`,
        [
          (r['学员姓名']||'').toString().trim(),
          (r['授课校区']||'').toString().trim(),
          (r['消耗班级产品名称']||'').toString().trim(),
          parseFloat(r['剩余总课时（0428）'] || r['剩余课时'] || 0),
          (r['教师']||'').toString().trim(),
          (r['年级']||'').toString().trim(),
          '待跟进-课时耗尽',
          '2026-04'
        ]
      );
      imported++;
    } catch(e) { errors++; }
  });
  
  const after = db.query('SELECT COUNT(*) as cnt FROM renewal_data');
  const byStatus = db.query('SELECT status, COUNT(*) as cnt FROM renewal_data GROUP BY status');
  
  console.log(`\n导入结果: 新增${imported}, 错误${errors}`);
  console.log(`DB最终: ${after[0]?.cnt}行`);
  console.log('按状态:');
  byStatus.forEach(r => console.log(`  ${r.status}: ${r.cnt}`));
  
  // Also import all 7105 students as general renewal data
  console.log('\n=== 批量导入全部学员跟进数据 ===');
  let batchImport = 0;
  all.forEach(r => {
    const h = parseFloat(r['剩余总课时（0428）'] || r['剩余课时'] || 0);
    const status = (h <= 0 || isNaN(h)) ? '待跟进-课时耗尽' : '正常跟进';
    try {
      db.run(
        `INSERT INTO renewal_data (student_name, campus, course, remaining_hours, teacher, grade, status, month) VALUES (?,?,?,?,?,?,?,?)`,
        [
          (r['学员姓名']||'').toString().trim(),
          (r['授课校区']||'').toString().trim(),
          (r['消耗班级产品名称']||'').toString().trim(),
          h,
          (r['教师']||'').toString().trim(),
          (r['年级']||'').toString().trim(),
          status,
          '2026-04'
        ]
      );
      batchImport++;
    } catch(e) { /* skip duplicates */ }
  });
  
  const final = db.query('SELECT COUNT(*) as cnt FROM renewal_data');
  const campusSummary = db.query('SELECT campus, COUNT(*) as cnt, AVG(remaining_hours) as avg_hours FROM renewal_data WHERE month="2026-04" GROUP BY campus ORDER BY cnt DESC LIMIT 15');
  console.log(`全部导入完成: ${final[0]?.cnt}行 (新增${batchImport})`);
  console.log('\n按校区（前15）:');
  campusSummary.forEach(r => console.log(`  ${r.campus}: ${r.cnt}人, 平均${parseFloat(r.avg_hours||0).toFixed(1)}课时`));
}

main().catch(e => { console.error(e); process.exit(1); });

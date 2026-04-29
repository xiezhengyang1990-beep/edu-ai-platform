/**
 * 处理未归类数据：从剩余课时表和续费跟进表中提取价值
 */
const XLSX = require('xlsx');

// ── 1. 查看春续暑待跟进表的表头和数据样例 ──
const file15path = './uploads/1777480321863-【语言】春续暑待跟进学员明细及动作.xlsx';
console.log('=== 春续暑待跟进 (2000行) ===');
const wb15 = XLSX.readFile(file15path);
const ws15 = wb15.Sheets[wb15.SheetNames[0]];
const data15 = XLSX.utils.sheet_to_json(ws15, { header: 1, defval: '' });
console.log('Sheet names:', wb15.SheetNames);
console.log('Headers:', JSON.stringify(data15[0]));
console.log('Sample row 1:', JSON.stringify(data15[1]));
console.log('Sample row 2:', JSON.stringify(data15[2]));
console.log('Sample row 3:', JSON.stringify(data15[3]));
console.log('Total rows:', data15.length);

// ── 2. 查看周浦剩余课时表 ──
const file11path = './uploads/1777479790639-周浦中邦春季剩余课时.xlsx';
console.log('\n=== 周浦中邦春季剩余课时 (667行) ===');
const wb11 = XLSX.readFile(file11path);
const ws11 = wb11.Sheets[wb11.SheetNames[0]];
const data11 = XLSX.utils.sheet_to_json(ws11, { header: 1, defval: '' });
console.log('Headers:', JSON.stringify(data11[0]));
console.log('Sample row 1:', JSON.stringify(data11[1]));
console.log('Sample row 2:', JSON.stringify(data11[2]));
console.log('Sample row 3:', JSON.stringify(data11[3]));
console.log('Total rows:', data11.length);

// ── 3. 查看森宏剩余课时表 ──
const file14path = './uploads/1777480128015-森宏春季剩余课时.xlsx';
console.log('\n=== 森宏春季剩余课时 (566行) ===');
const wb14 = XLSX.readFile(file14path);
const ws14 = wb14.Sheets[wb14.SheetNames[0]];
const data14 = XLSX.utils.sheet_to_json(ws14, { header: 1, defval: '' });
console.log('Headers:', JSON.stringify(data14[0]));
console.log('Sample row 1:', JSON.stringify(data14[1]));
console.log('Sample row 2:', JSON.stringify(data14[2]));
console.log('Sample row 3:', JSON.stringify(data14[3]));
console.log('Total rows:', data14.length);

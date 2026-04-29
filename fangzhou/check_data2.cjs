const XLSX = require('xlsx');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync('./data/arkinsight.db');
  const db = new SQL.Database(buf);
  
  // Get file paths from DB
  const rows = db.exec('SELECT id, file_path FROM uploaded_files WHERE id IN (11,14,15)');
  const files = rows[0]?.values || [];
  
  for (const [id, fp] of files) {
    console.log(`\n=== File ID ${id}: ${path.basename(fp)} ===`);
    
    // Check if file exists at path
    if (!fs.existsSync(fp)) {
      // Try to find in uploads directory
      const dir = path.dirname(fp);
      if (fs.existsSync(dir)) {
        const allFiles = fs.readdirSync(dir);
        // Try timestamp prefix match
        const ts = path.basename(fp).split('-')[0];
        const match = allFiles.find(f => f.startsWith(ts));
        if (match) {
          const actualFp = path.join(dir, match);
          console.log(`Found: ${match}`);
          readFile(actualFp);
        } else {
          console.log(`No file found with timestamp ${ts}`);
          console.log(`Expected: ${path.basename(fp)}`);
          console.log(`Available: ${allFiles.slice(0,5).join(', ')}`);
        }
      } else {
        console.log(`Directory ${dir} not found`);
      }
    } else {
      readFile(fp);
    }
  }
}

function readFile(fp) {
  try {
    const wb = XLSX.readFile(fp);
    console.log('Sheets:', wb.SheetNames.join(', '));
    for (const sheet of wb.SheetNames) {
      const ws = wb.Sheets[sheet];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      console.log(`[${sheet}] Headers:`, JSON.stringify(data[0]));
      data.slice(1, 5).forEach((r,i) => console.log(`Row ${i+1}:`, JSON.stringify(r)));
      console.log(`Total: ${data.length} rows, ${data[0]?.length || 0} cols`);
    }
  } catch(e) {
    console.log(`Error: ${e.message}`);
  }
}

main().catch(console.error);

/**
 * 方舟智管 ArkInsight — 数据导入 API
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../db');
const ai = require('../services/ai');

// Multer config - save to uploads/
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx、.xls、.csv 格式'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// ── POST /api/upload — 上传并分析表格 ──
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    
    // Parse Excel
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    
    if (!data || data.length < 2) {
      return res.status(400).json({ error: '表格为空或格式不正确' });
    }

    // Find header row (first non-empty row with meaningful data)
    let headerRow = 0;
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      if (data[i].filter(v => String(v).trim()).length >= 3) {
        headerRow = i;
        break;
      }
    }
    
    const headers = data[headerRow].map(h => String(h).trim());
    const dataRows = data.slice(headerRow + 1).filter(r => r.some(v => String(v).trim()));
    
    // AI template matching (skip header rows before headerRow)
    const previewData = data.slice(Math.max(0, headerRow - 1), headerRow + 4);
    const previewHeaders = previewData[previewData.length - 1 - (headerRow > 0 ? 1 : 0)];
    const actualHeaders = previewData[previewData.length - 1];

    const aiResult = await ai.identifyTableType(headers, dataRows.slice(0, 5));
    
    // Save file record
    const templateType = aiResult.confidence >= 60 ? aiResult.template : 'unknown';
    db.run(
      `INSERT INTO uploaded_files (original_name, file_path, file_size, template_type, confidence, status, sheet_name, total_rows) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [originalName, filePath, req.file.size, templateType, aiResult.confidence, 
       aiResult.confidence >= 60 ? 'matched' : 'pending', sheetName, dataRows.length]
    );
    const fileId = db.getLastId();
    
    // If high confidence, auto-extract fields
    let extracted = null;
    if (aiResult.confidence >= 60 && templateType !== 'unknown') {
      extracted = await ai.extractFields(templateType, headers, dataRows);
      
      if (extracted && extracted.records && extracted.records.length > 0) {
        // Insert records to database
        for (const record of extracted.records) {
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
          [extracted.records.length, fileId]);
      }
    }

    res.json({
      success: true,
      file_id: fileId,
      file_name: originalName,
      sheet_name: sheetName,
      total_rows: dataRows.length,
      headers: headers,
      preview: dataRows.slice(0, 5),
      ai_result: aiResult,
      extracted: extracted ? {
        table: templateType,
        records_count: extracted.records ? extracted.records.length : 0,
        field_mapping: extracted.field_mapping || {}
      } : null
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/upload/confirm — 用户确认模板和字段映射 ──
router.post('/upload/confirm', async (req, res) => {
  try {
    const { file_id, template_type, corrections, records } = req.body;
    if (!file_id || !template_type) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // Update file record
    db.run(`UPDATE uploaded_files SET template_type = ?, status = 'corrected' WHERE id = ?`, 
      [template_type, file_id]);

    // If records are provided (user-corrected data), insert them
    if (records && records.length > 0) {
      for (const record of records) {
        if (template_type === 'revenue') {
          db.run(
            `INSERT INTO revenue_data (file_id, month, campus, course, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)`,
            [file_id, record.month || '', record.campus || '', record.course || '',
             Number(record.revenue) || 0, Number(record.cost) || 0]
          );
        } else if (template_type === 'renewal') {
          db.run(
            `INSERT INTO renewal_data (file_id, month, student_name, course, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [file_id, record.month || '', record.student_name || '', record.course || '',
             record.expiry_date || '', record.status || 'pending']
          );
        } else if (template_type === 'enrollment') {
          db.run(
            `INSERT INTO enrollment_data (file_id, month, campus, course, new_count, source, conversion_rate) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [file_id, record.month || '', record.campus || '', record.course || '',
             Number(record.new_count) || 0, record.source || '', Number(record.conversion_rate) || 0]
          );
        }
      }
      db.run(`UPDATE uploaded_files SET status = 'imported', imported_rows = ? WHERE id = ?`, 
        [records.length, file_id]);
    }

    res.json({ success: true, message: '数据已确认导入' });

  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/files — 获取上传记录列表 ──
router.get('/files', (req, res) => {
  try {
    const files = db.query(
      `SELECT id, original_name, file_size, template_type, confidence, status, sheet_name, total_rows, imported_rows, created_at
       FROM uploaded_files ORDER BY created_at DESC`
    );
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/files/:id — 删除上传记录 ──
router.delete('/files/:id', (req, res) => {
  try {
    const file = db.query('SELECT file_path FROM uploaded_files WHERE id = ?', [req.params.id]);
    if (file.length) {
      // Delete data records
      db.run('DELETE FROM revenue_data WHERE file_id = ?', [req.params.id]);
      db.run('DELETE FROM renewal_data WHERE file_id = ?', [req.params.id]);
      db.run('DELETE FROM enrollment_data WHERE file_id = ?', [req.params.id]);
      db.run('DELETE FROM uploaded_files WHERE id = ?', [req.params.id]);
      
      // Clean up file
      try { fs.unlinkSync(file[0].file_path); } catch(e) {}
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

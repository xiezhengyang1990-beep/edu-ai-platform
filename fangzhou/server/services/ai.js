/**
 * 方舟智管 ArkInsight — DeepSeek AI 服务
 */
const API_KEY = 'sk-0bdc794856cd43c389eb5e7ac476ed5d';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

const TEMPLATE_DEFS = {
  revenue: {
    name: '营收表',
    fields: [
      { key: 'month', label: '月份', type: 'text', required: true },
      { key: 'campus', label: '校区', type: 'text', required: false },
      { key: 'course', label: '课程', type: 'text', required: false },
      { key: 'revenue', label: '营收金额', type: 'number', required: true },
      { key: 'cost', label: '成本', type: 'number', required: false }
    ],
    description: '记录各校区/各课程的营收和成本数据，通常包含月份、金额、校区等列'
  },
  renewal: {
    name: '续费表',
    fields: [
      { key: 'month', label: '月份', type: 'text', required: true },
      { key: 'student_name', label: '学生姓名', type: 'text', required: true },
      { key: 'course', label: '课程', type: 'text', required: false },
      { key: 'expiry_date', label: '到期日', type: 'text', required: false },
      { key: 'status', label: '状态', type: 'text', required: false }
    ],
    description: '记录学员续费情况，包含学生姓名、到期日、续费状态等列'
  },
  enrollment: {
    name: '招生表',
    fields: [
      { key: 'month', label: '月份', type: 'text', required: true },
      { key: 'campus', label: '校区', type: 'text', required: false },
      { key: 'course', label: '课程', type: 'text', required: false },
      { key: 'new_count', label: '新增人数', type: 'number', required: true },
      { key: 'source', label: '来源渠道', type: 'text', required: false },
      { key: 'conversion_rate', label: '转化率', type: 'number', required: false }
    ],
    description: '记录各渠道招生人数和转化数据，包含新增人数、来源、转化率等列'
  }
};

/**
 * 呼叫 DeepSeek API
 */
async function callDeepSeek(messages, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: options.temperature || 0.3,
        max_tokens: options.maxTokens || 2000,
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 识别表格类型 (AI模板匹配)
 * 输入：Excel前几行的文本表示
 * 输出：{ template: 'revenue'|'renewal'|'enrollment', confidence: 0-1, reason: '...' }
 */
async function identifyTableType(headers, sampleRows) {
  const tablePreview = [
    '表头行: ' + headers.join(' | '),
    ...sampleRows.slice(0, 3).map(r => '数据行: ' + r.join(' | '))
  ].join('\n');

  const prompt = `你是一个教培行业表格分类专家。分析下面表格的表头和示例数据，判断它属于哪种类型。

可选类型：
1. 营收表（revenue）— 包含月份、校区、营收金额、成本等。关注收入/金额/收费相关列。
2. 续费表（renewal）— 包含学生姓名、到期日、续费状态等。关注学员/续费/到期相关列。
3. 招生表（enrollment）— 包含新增人数、来源渠道、转化率等。关注招生/新增/来源相关列。
4. 其他/无法识别（unknown）— 不属于以上三类。

请仔细分析表头和数据内容，返回JSON格式：
{
  "template": "revenue|renewal|enrollment|unknown",
  "confidence": 0-100,
  "reason": "简洁的分析理由"
}

表格数据：
${tablePreview}`;

  try {
    const result = await callDeepSeek([
      { role: 'system', content: '你是一个教培行业表格分类AI，只输出JSON。' },
      { role: 'user', content: prompt }
    ], { temperature: 0.2 });

    const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
    return {
      template: parsed.template || 'unknown',
      confidence: parsed.confidence || 0,
      reason: parsed.reason || ''
    };
  } catch (e) {
    console.error('Template identification failed:', e.message);
    return { template: 'unknown', confidence: 0, reason: e.message };
  }
}

/**
 * 从表格数据中提取字段
 * 策略：先让AI识别字段映射（只送前5行预览），再用映射规则自动处理所有行
 * 输入：识别的模板类型 + 表格数据
 * 输出：{ field_mapping, records: [...], total_rows }
 */
async function extractFields(templateType, headers, allRows) {
  const template = TEMPLATE_DEFS[templateType];
  if (!template) return { field_mapping: {}, records: [], total_rows: 0 };

  const preview = [
    '表头: ' + headers.join(' | '),
    ...allRows.slice(0, 5).map(r => '行: ' + r.join(' | '))
  ].join('\n');

  // Step 1: AI determines field mapping from preview
  const prompt = `你是一个教培数据提取专家。表格类型是"${template.name}"。
模板字段定义：${JSON.stringify(template.fields)}

表格数据（前5行预览）：
${preview}

请分析表头和数据，判断每个模板字段对应表格的哪一列（用列名匹配）。
注意：
- 列名可能是近义词（"金额"→"revenue"，"学员"→"student_name"）
- 日期标准化为YYYY-MM
- 金额去掉¥$,转为数字
- 某些字段可能不在表中（留空）

返回JSON：{
  "field_mapping": { "原始列名": "template字段key" },
  "notes": "映射说明"
}`;

  try {
    const result = await callDeepSeek([
      { role: 'system', content: '你是教培数据提取专家，只输出JSON。' },
      { role: 'user', content: prompt }
    ], { temperature: 0.2, maxTokens: 2000 });

    const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
    const fieldMapping = parsed.field_mapping || {};
    
    // Build reverse mapping: template field -> column index
    const colIndex = {};
    Object.keys(fieldMapping).forEach(header => {
      const idx = headers.indexOf(header);
      if (idx >= 0) {
        colIndex[fieldMapping[header]] = idx;
      }
    });

    // Step 2: Apply mapping to ALL rows programmatically
    const records = [];
    const fieldKeys = template.fields.map(f => f.key);
    
    for (const row of allRows) {
      const record = {};
      let hasData = false;
      
      fieldKeys.forEach(key => {
        const idx = colIndex[key];
        if (idx !== undefined && idx < row.length && String(row[idx]).trim()) {
          const val = String(row[idx]).trim();
          const fieldDef = template.fields.find(f => f.key === key);
          
          if (fieldDef && fieldDef.type === 'number') {
            // Parse number: remove currency symbols, commas
            const cleaned = val.replace(/[¥$￥,，\s]/g, '');
            const num = parseFloat(cleaned);
            record[key] = isNaN(num) ? 0 : num;
          } else if (key === 'month') {
            // Normalize date to YYYY-MM
            const dateMatch = val.match(/(\d{4})[年\/-](\d{1,2})[月]?/);
            if (dateMatch) {
              record[key] = dateMatch[1] + '-' + String(dateMatch[2]).padStart(2, '0');
            } else {
              record[key] = val;
            }
          } else if (key === 'expiry_date') {
            // Try to parse date
            const dateMatch = val.match(/(\d{4})[年\/-](\d{1,2})[月]?(?:[\/-](\d{1,2})[日]?)?/);
            if (dateMatch) {
              const d = dateMatch[3] ? String(dateMatch[3]).padStart(2, '0') : '01';
              record[key] = dateMatch[1] + '-' + String(dateMatch[2]).padStart(2, '0') + '-' + d;
            } else {
              record[key] = val;
            }
          } else if (key === 'conversion_rate') {
            // Handle percentage values
            const cleaned = String(val).replace(/[%\s]/g, '');
            const num = parseFloat(cleaned);
            record[key] = isNaN(num) ? 0 : (num > 1 ? num / 100 : num);
          } else {
            record[key] = val;
          }
          hasData = true;
        } else {
          record[key] = '';
        }
      });
      
      if (hasData) {
        records.push(record);
      }
    }

    return {
      field_mapping: fieldMapping,
      records: records,
      total_rows: records.length,
      notes: parsed.notes || `自动映射${records.length}行数据`
    };

  } catch (e) {
    console.error('Field extraction failed:', e.message);
    return { field_mapping: {}, records: [], total_rows: 0, notes: e.message };
  }
}

/**
 * AI 经营诊断 - 基于数据生成分析文本
 */
async function generateDiagnosis(data) {
  const prompt = `你是一个教培机构经营分析专家。根据以下数据，给出简洁的经营诊断和建议。

本月数据：
${JSON.stringify(data, null, 2)}

请返回JSON格式：
{
  "summary": "一句话总结（最多20字）",
  "highlights": ["亮点1", "亮点2"],
  "warnings": ["风险1", "风险2"],
  "suggestions": ["建议1", "建议2", "建议3"],
  "tone": "positive|neutral|warning"
}`;

  try {
    const result = await callDeepSeek([
      { role: 'system', content: '你是教培机构经营分析专家，简洁实用，只说真话。只输出JSON。' },
      { role: 'user', content: prompt }
    ], { temperature: 0.5, maxTokens: 1500 });

    return JSON.parse(result.replace(/```json|```/g, '').trim());
  } catch (e) {
    return {
      summary: '数据加载中',
      highlights: [],
      warnings: ['诊断分析暂不可用'],
      suggestions: ['请稍后重试'],
      tone: 'neutral'
    };
  }
}

/**
 * AI 智囊聊天 - 带上下文的经营问答
 */
async function chat(messages) {
  const systemPrompt = `你是"方舟智管 ArkInsight"的AI经营顾问，专门回答教培机构校长的经营问题。

你的能力：
1. 根据上传的营收/续费/招生数据回答经营问题
2. 给出数据驱动的改善建议
3. 分析校区表现差异
4. 提供续费提升、招生优化、成本控制等策略

风格：专业、直接、数据说话。用中文回答，200字以内。`;

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-10) // 保留最近10条
  ];

  try {
    return await callDeepSeek(apiMessages, {
      temperature: 0.7,
      maxTokens: 2000
    });
  } catch (e) {
    return `抱歉，AI服务暂时不可用（${e.message}）`;
  }
}

module.exports = {
  callDeepSeek,
  identifyTableType,
  extractFields,
  generateDiagnosis,
  chat,
  TEMPLATE_DEFS
};

// ===== 智能内容工厂逻辑 =====

// DeepSeek API配置（从设置中读取，这里先用占位）
let API_CONFIG = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat'
};

// 表单模式 - 一键生成
document.getElementById('btn-generate').addEventListener('click', async () => {
  const orgName = document.getElementById('org-name').value.trim();
  const courseType = document.getElementById('course-type').value;
  const targetAudience = document.getElementById('target-audience').value;
  const promoInfo = document.getElementById('promo-info').value.trim();

  const activeStyle = document.querySelector('.style-btn.active');
  const style = activeStyle ? activeStyle.dataset.style : 'professional';
  const customStyle = style === 'custom' ? document.getElementById('custom-style').value.trim() : '';

  // 验证
  if (!orgName || !courseType || !targetAudience) {
    alert('请填写机构名称、课程类型和目标人群');
    return;
  }

  const styleMap = {
    professional: '正式专业',
    warm: '亲切温暖',
    casual: '接地气',
    custom: customStyle || '自定义'
  };

  const input = {
    orgName,
    courseType,
    targetAudience,
    sellingPoints: tags,
    promoInfo,
    style: styleMap[style]
  };

  await generateAllContent(input);
});

// 对话模式 - 发送消息
document.getElementById('btn-chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  // 添加用户消息
  addChatMessage('user', message);
  input.value = '';

  // AI回复
  const prompt = buildChatPrompt(message);
  const response = await callDeepSeekAPI(prompt);
  addChatMessage('ai', response);
}

function addChatMessage(role, content) {
  const container = document.getElementById('chat-container');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}-msg`;
  msg.innerHTML = `
    <div class="msg-avatar">${role === 'ai' ? 'AI' : '我'}</div>
    <div class="msg-content">${content}</div>
  `;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// 核心生成逻辑
async function generateAllContent(input) {
  showLoading(true);

  const results = {};
  const types = [
    { key: 'xiaohongshu', name: '小红书笔记' },
    { key: 'moments', name: '朋友圈文案' },
    { key: 'parent-group', name: '家长群话术' },
    { key: 'douyin', name: '抖音口播脚本' }
  ];

  try {
    // 并行生成所有类型
    const promises = types.map(async (type) => {
      const prompt = buildContentPrompt(type.key, input);
      const content = await callDeepSeekAPI(prompt);
      results[type.key] = content;
    });

    await Promise.all(promises);

    // 渲染结果
    renderResults(results);
  } catch (error) {
    console.error('生成失败:', error);
    alert('生成失败，请检查API配置。错误: ' + error.message);
  } finally {
    showLoading(false);
  }
}

// 构建提示词
function buildContentPrompt(type, input) {
  const baseInfo = `机构：${input.orgName}\n课程：${input.courseType}\n目标人群：${input.targetAudience}\n卖点：${input.sellingPoints.join('、') || '无'}\n促销：${input.promoInfo || '无'}\n风格：${input.style}`;

  const prompts = {
    xiaohongshu: `你是一个教培行业的内容营销专家。请根据以下信息生成一篇小红书笔记。

${baseInfo}

要求：
1. 标题要有冲击力，用emoji，不超过20字
2. 正文500-800字，分段清晰，每段有emoji
3. 自然植入课程卖点，不要硬广感
4. 结尾有明确的行动号召（CTA）
5. 生成5-8个标签
6. 风格：${input.style}

输出格式：
【标题】
xxx

【正文】
xxx

【标签】
#xxx #xxx`,

    moments: `你是一个教培行业的私域运营专家。请根据以下信息生成朋友圈文案。

${baseInfo}

要求：
1. 短版：30字以内，适合配图发朋友圈
2. 长版：150-200字，有故事感，适合长文案
3. 自然真实，不像广告
4. 风格：${input.style}

输出格式：
【短版】
xxx

【长版】
xxx`,

    'parent-group': `你是一个教培行业的家长沟通专家。请根据以下信息生成家长群话术。

${baseInfo}

要求：
1. 活动邀约话术：吸引家长报名体验
2. 催续话术：温和提醒续费
3. 话术要站在家长角度，解决他们的顾虑
4. 风格：${input.style}

输出格式：
【活动邀约】
xxx

【催续话术】
xxx`,

    douyin: `你是一个教培行业的短视频脚本专家。请根据以下信息生成抖音口播脚本。

${baseInfo}

要求：
1. 开头3秒hook，必须抓住注意力
2. 正文节奏紧凑，30-60秒口播
3. 结尾CTA明确
4. 标注画面建议（用[]标注）
5. 风格：${input.style}

输出格式：
【Hook】
xxx

【正文】
xxx

【CTA】
xxx`
  };

  return prompts[type];
}

function buildChatPrompt(message) {
  return `你是一个教培行业的内容创作助手。用户会描述他们的需求，你帮助他们创作获客内容。
请根据用户的描述，给出专业的建议或直接生成内容片段。

用户说：${message}

请给出有帮助的回复。如果信息不足，可以追问关键信息（课程类型、目标人群、卖点等）。`;
}

// 调用DeepSeek API
async function callDeepSeekAPI(prompt) {
  if (!API_CONFIG.apiKey) {
    // Demo模式：返回示例内容
    return getDemoContent(prompt);
  }

  const response = await fetch(API_CONFIG.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_CONFIG.apiKey}`
    },
    body: JSON.stringify({
      model: API_CONFIG.model,
      messages: [
        { role: 'system', content: '你是教培行业的AI内容创作专家，擅长撰写获客文案、家长沟通话术和营销脚本。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Demo内容（无API Key时使用）
function getDemoContent(prompt) {
  if (prompt.includes('小红书')) {
    return `【标题】
🎯 小学数学竟然可以这样学！家长圈都炸了

【正文】
前两天和一位妈妈聊天，她说孩子数学一直不及格，报了3个班都没用 😢

直到来了${提取机构名(prompt)}，老师用"思维导图+游戏化"的方式教，孩子第一次主动说"妈妈我要做题"！

✨ 为什么孩子变化这么大？
👉 不死记硬背，先理解再练习
👉 每节课都有互动游戏，学得开心
👉 课后1对1答疑，不留疑问过夜

现在孩子数学从60分冲到85分，妈妈说"早该来了"！

🎁 限时福利：9.9元体验课，让孩子爱上数学👇

【标签】
#小学数学 #数学辅导 #教育机构 #孩子学习 #提分神器`;
  }

  if (prompt.includes('朋友圈')) {
    return `【短版】
孩子数学从60到85，只用了2个月 🎯 9.9元体验课限时开放👇

【长版】
昨天收到一位妈妈的消息："老师，孩子今天主动做题了！"这是我来这个行业最开心的时刻。不是每个孩子都适合刷题，找对方法，每个孩子都能发光。9.9元体验课，给自己一个改变的机会。`;
  }

  if (prompt.includes('家长群')) {
    return `【活动邀约】
各位家长好！新学期数学思维体验课开放啦 🎉 9.9元就能让孩子感受"不一样"的数学课，课上互动游戏+思维训练，课后还有1对1答疑。名额有限，先到先得哦～

【催续话术】
XX妈妈好！看到孩子最近进步很大，特别替他开心 😊 这学期的课程快结束了，下学期我们会有更多新内容，现在续费还能享受优惠价。想了解一下您的想法？`;
  }

  if (prompt.includes('抖音')) {
    return `【Hook】
你还在让孩子刷题刷到哭？停！这个方法3个月数学提25分 👆

【正文】
[画面：老师和孩子互动] 很多家长问，为什么刷了那么多题还是不会？因为方向错了！数学不是记忆，是思维。[画面：思维导图演示] 在${提取机构名(prompt)}，我们用思维导图+游戏化教学，让孩子先理解再练习。[画面：学生笑脸] 3个月，从60到85，不是奇迹，是方法对。

【CTA】
9.9元体验课，点击下方链接，给孩子一个改变的机会！👇`;
  }

  return '请配置DeepSeek API Key以启用AI生成功能。在系统设置中填写API Key即可。';
}

function 提取机构名(prompt) {
  const match = prompt.match(/机构：(.+)/);
  return match ? match[1] : '我们';
}

// 渲染结果
function renderResults(results) {
  document.getElementById('output-empty').style.display = 'none';
  document.getElementById('output-results').style.display = 'flex';

  Object.entries(results).forEach(([key, content]) => {
    const el = document.getElementById(`result-${key}`);
    if (el) {
      el.innerHTML = formatContent(content);
    }
  });
}

function formatContent(content) {
  // 简单格式化：加粗标题行
  return content
    .replace(/【(.+?)】/g, '<div class="title-line">$1</div>')
    .replace(/(#\S+)/g, '<span class="tag-line">$1</span>')
    .replace(/\n/g, '<br>');
}

// 加载状态
function showLoading(show) {
  const loading = document.getElementById('output-loading');
  const empty = document.getElementById('output-empty');
  const results = document.getElementById('output-results');

  if (show) {
    loading.style.display = 'flex';
    empty.style.display = 'none';
    results.style.display = 'none';
  } else {
    loading.style.display = 'none';
  }
}

// 复制功能
document.querySelectorAll('.btn-icon[title="复制"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.result-card');
    const body = card.querySelector('.result-body');
    const text = body.innerText;
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => btn.textContent = original, 1000);
    });
  });
});

// 全部复制
document.getElementById('btn-copy-all')?.addEventListener('click', () => {
  const results = document.getElementById('output-results');
  if (!results) return;
  const text = results.innerText;
  navigator.clipboard.writeText(text).then(() => {
    alert('已复制全部内容到剪贴板');
  });
});

// 收藏
document.getElementById('btn-save-fav')?.addEventListener('click', () => {
  alert('收藏功能开发中');
});

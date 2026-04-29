/**
 * 方舟智管 ArkInsight — 实时搜索服务
 * 
 * 解析 Bing HTML 搜索结果获取真实网络信息。
 * 零依赖，零API Key，中文友好，大陆可访问。
 */

const TIMEOUT = 12000;

/**
 * 搜索互联网
 * @param {string} query - 搜索词
 * @param {number} count - 最多返回数（默认8）
 * @returns {Promise<Array<{title, snippet, url, source}>>}
 */
async function searchWeb(query, count = 8) {
  // 主：Bing搜索
  try {
    const r = await bingSearch(query, count);
    if (r.length > 0) return r;
  } catch (e) { /* fallback */ }

  // 备：SearXNG
  try {
    const r = await searxSearch(query, count);
    if (r.length > 0) return r;
  } catch (e) { /* give up */ }

  return [];
}

/**
 * Bing HTML 搜索结果解析（cn.bing.com）
 * 结构：<li class="b_algo"><h2><a href="URL">TITLE</a></h2><p class="b_lineclamp2">SNIPPET</p>...</li>
 */
async function bingSearch(query, count) {
  const url = 'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + Math.min(count + 5, 20);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    }
  });
  const html = await res.text();
  const results = [];
  const seen = new Set();

  // 逐个解析 b_algo 块
  const blockRe = /<li\s+class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let mBlock;
  while ((mBlock = blockRe.exec(html)) !== null && results.length < count) {
    const block = mBlock[1];

    // 标题：<h2><a href="URL">TITLE</a></h2>
    const h2 = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!h2) continue;
    const a = h2[1].match(/<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;

    let url = a[1];
    if (url.includes('bing.com') || url.includes('microsoft.com') || seen.has(url)) continue;
    seen.add(url);

    const title = stripTags(a[2]).trim();
    if (!title || title.length < 2) continue;

    // 摘要：<p class="b_lineclamp...">SNIPPET</p>
    let snippet = '';
    const p = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    if (p) snippet = stripTags(p[1]).trim();

    results.push({
      title,
      snippet: snippet.substring(0, 300),
      url,
      source: safeHostname(url)
    });
  }

  if (results.length > 0) return results;
  throw new Error('No Bing results');
}

/**
 * SearXNG 备选搜索引擎
 */
async function searxSearch(query, count) {
  const instances = [
    'https://searx.be/search?q=' + encodeURIComponent(query) + '&format=json&language=zh-CN',
    'https://search.sapti.me/search?q=' + encodeURIComponent(query) + '&format=json'
  ];

  const results = [];
  const seen = new Set();

  for (const url of instances) {
    if (results.length >= count) break;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': 'ArkInsight/1.0', 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.results) continue;

      for (const r of data.results) {
        if (results.length >= count) break;
        if (!r.title || seen.has(r.url)) continue;
        seen.add(r.url);
        results.push({
          title: r.title,
          snippet: (r.content || r.snippet || '').substring(0, 300),
          url: r.url,
          source: r.engine || safeHostname(r.url)
        });
      }
    } catch (e) { /* next */ }
  }

  if (results.length > 0) return results;
  throw new Error('No SearXNG results');
}

// ── Helpers ──

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&ensp;/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function safeHostname(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; }
}

module.exports = { searchWeb };

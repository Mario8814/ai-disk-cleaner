const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULT_CONFIG = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function getAIConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function setAIConfig(cfg) {
  const next = { ...DEFAULT_CONFIG, ...cfg };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

const SYSTEM_PROMPT = `你是一个磁盘空间清理助手。用户会提供一份磁盘占用情况（包括各磁盘容量、占用最大的文件、占用最大的文件夹、已安装软件列表及大小）。
请分析这些数据，给出能帮用户安全腾出磁盘空间的清理建议。

必须遵守：
1. 只建议删除/卸载用户明确可辨认、可再获取的内容（如下载的文件、缓存、临时文件、旧版本、用户自己安装的软件等）。
2. 绝不要建议删除系统关键目录或文件（如 C:\\Windows、System32、Program Files 下的系统组件、驱动、启动项等）。
3. 对每条建议给出风险等级 risk：safe（安全）/ medium（谨慎）/ high（高危，需用户自行确认）。
4. 无法确定是否安全的内容，宁可不建议，或标为 high。
5. 建议里的 path 必须是用户数据里真实存在的路径；对已安装软件，type 用 "app"，path 填软件名称。

严格只返回一个 JSON 对象，不要返回任何解释文字或 markdown 代码块，格式如下：
{
  "summary": "一句话总结可清理的空间和建议",
  "suggestions": [
    {
      "name": "显示名称",
      "path": "完整路径或软件名",
      "type": "file | folder | app",
      "estimatedBytes": 123456789,
      "reason": "为什么建议清理",
      "risk": "safe | medium | high"
    }
  ]
}`;

function extractJSON(text) {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1].trim() : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    body = body.slice(start, end + 1);
  }
  return JSON.parse(body);
}

async function analyzeWithAI(payload) {
  const cfg = getAIConfig();
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    throw new Error('请先在「AI 清理」页填写 DeepSeek API Key');
  }
  const base = (cfg.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, '');
  const model = cfg.model || DEFAULT_CONFIG.model;

  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '请分析以下磁盘占用数据并给出清理建议：\n' + JSON.stringify(payload) },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    throw new Error('网络请求失败，请检查网络或接口地址：' + (e.message || e));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API 请求失败 (HTTP ${res.status})：${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content =
    data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

  if (!content) {
    throw new Error('AI 返回内容为空');
  }

  try {
    return extractJSON(content);
  } catch (e) {
    throw new Error('AI 返回的内容不是合法 JSON，请重试。原始内容：' + String(content).slice(0, 300));
  }
}

// ---------- 交互式问答 ----------
const CHAT_SYSTEM_PROMPT = `你是一个磁盘空间清理助手，擅长判断电脑里的文件/文件夹是什么、有什么用途、能否安全删除。

当用户询问某个具体文件或文件夹时，我会在系统消息里提供该路径的真实信息（名称、大小、类型、顶层内容等）。请：
1. 优先依据我提供的真实信息 + 你的通用知识来判断，不要凭空捏造路径内容。
2. 告诉用户「它是什么、有什么用」。
3. 判断「能不能删、删了有什么影响」。
4. 给出风险等级：安全 / 谨慎 / 高危，并说明理由。
5. 如果信息不足无法确定，请诚实说明，不要为了给结论而臆断。
6. 绝不要建议删除系统关键目录（Windows、System32、Program Files 下的系统组件等）。

回答要简洁、口语化、中文，用短段落或要点，不要长篇大论。`;

function fmtSize(n) {
  if (n == null || isNaN(n) || n < 0) return '未知';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + units[i];
}

/** 读取某个路径的真实信息（文件：大小/扩展名；文件夹：顶层内容），供 AI 作为判断依据 */
async function inspectPath(p) {
  let st;
  try { st = await fsp.lstat(p); } catch (e) { return null; }

  if (st.isSymbolicLink()) {
    return { exists: true, type: '符号链接', name: path.basename(p) || p, path: p };
  }
  if (st.isFile()) {
    return {
      exists: true,
      type: '文件',
      name: path.basename(p),
      path: p,
      size: st.size,
      sizeText: fmtSize(st.size),
      ext: path.extname(p) || '(无扩展名)',
      mtime: st.mtime ? st.mtime.toISOString() : '',
    };
  }
  if (st.isDirectory()) {
    let entries = [];
    try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch (e) {}
    const items = [];
    let fileCount = 0;
    let dirCount = 0;
    for (const e of entries) {
      if (items.length >= 100) break;
      const full = path.join(p, e.name);
      try {
        const s = await fsp.lstat(full);
        if (s.isSymbolicLink()) continue;
        if (s.isDirectory()) { dirCount++; items.push(`[目录] ${e.name}`); }
        else if (s.isFile()) { fileCount++; items.push(`[文件] ${e.name}（${fmtSize(s.size)}）`); }
      } catch (err) {}
    }
    return {
      exists: true,
      type: '文件夹',
      name: path.basename(p) || p,
      path: p,
      topLevelCount: entries.length,
      fileCount,
      dirCount,
      topItems: items,
      note: entries.length > 100 ? '（仅列出前 100 项）' : '',
    };
  }
  return { exists: true, type: '其他', name: path.basename(p) || p, path: p };
}

/** 多轮对话：messages 为 [{role:'user'|'assistant', content}]，targetPath 为当前询问的目标路径（可选） */
async function chatWithAI(messages, targetPath) {
  const cfg = getAIConfig();
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    throw new Error('请先在「AI 清理」页填写 DeepSeek API Key');
  }
  const base = (cfg.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, '');
  const model = cfg.model || DEFAULT_CONFIG.model;

  let sysContent = CHAT_SYSTEM_PROMPT;
  if (targetPath && String(targetPath).trim()) {
    const p = String(targetPath).trim();
    const info = await inspectPath(p);
    if (info && info.exists) {
      sysContent += '\n\n【用户当前询问的目标路径真实信息】\n' + JSON.stringify(info, null, 2)
        + '\n请基于以上真实信息回答用户关于此路径的问题。';
    } else {
      sysContent += `\n\n用户询问的路径「${p}」当前不存在或无法访问，请如实告知，不要编造其内容。`;
    }
  }

  const recent = Array.isArray(messages) ? messages.slice(-20) : [];

  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: sysContent }, ...recent],
        temperature: 0.3,
      }),
    });
  } catch (e) {
    throw new Error('网络请求失败，请检查网络或接口地址：' + (e.message || e));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API 请求失败 (HTTP ${res.status})：${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content =
    data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

  if (!content) throw new Error('AI 返回内容为空');
  return { reply: content };
}

module.exports = { getAIConfig, setAIConfig, analyzeWithAI, chatWithAI, inspectPath };

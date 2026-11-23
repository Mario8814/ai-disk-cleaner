const { app } = require('electron');
const fs = require('fs');
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

module.exports = { getAIConfig, setAIConfig, analyzeWithAI };

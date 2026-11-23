const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

/**
 * 以 -EncodedCommand (UTF-16LE base64) 方式运行 PowerShell，
 * 彻底避免引号/换行导致的转义问题。返回 stdout 字符串。
 */
async function runPowerShell(script, { json = false } = {}) {
  // 强制 stdout 使用 UTF-8，避免中文（应用名等）出现乱码
  const preamble = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n';
  const enc = Buffer.from(preamble + script, 'utf16le').toString('base64');
  const { stdout } = await execFileP(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    { maxBuffer: 128 * 1024 * 1024, windowsHide: true }
  );
  const out = (stdout || '').trim();
  if (!out) return json ? null : '';
  if (json) return JSON.parse(out);
  return out;
}

module.exports = { runPowerShell };

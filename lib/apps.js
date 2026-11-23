const { runPowerShell } = require('./powershell');

/**
 * 通过注册表读取已安装应用（HKLM / WOW6432Node / HKCU 的 Uninstall 分支）。
 * EstimatedSize 单位为 KB。
 */
async function listApps() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = foreach ($p in $paths) {
  Get-ItemProperty $p | Where-Object { $_.DisplayName } | ForEach-Object {
    [PSCustomObject]@{
      name        = [string]$_.DisplayName
      version     = [string]$_.DisplayVersion
      publisher   = [string]$_.Publisher
      sizeKB      = [int64]$_.EstimatedSize
      uninstall   = [string]$_.UninstallString
      quiet       = [string]$_.QuietUninstallString
      key         = [string]$_.PSChildName
    }
  }
}
$apps | ConvertTo-Json -Depth 4
`;
  const out = await runPowerShell(script, { json: true });
  if (!out) return [];

  const list = Array.isArray(out) ? out : [out];

  // 归一化 + 去重（同一软件在多个注册表位置会重复出现）
  const seen = new Set();
  const apps = [];
  for (const a of list) {
    if (!a || !a.name) continue;
    const name = a.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    apps.push({
      name,
      version: a.version || '',
      publisher: a.publisher || '',
      size: a.sizeKB > 0 ? a.sizeKB * 1024 : null, // KB -> 字节
      uninstallString: a.uninstall || '',
      quietUninstall: a.quiet || '',
      key: a.key || '',
    });
  }

  apps.sort((x, y) => (y.size || 0) - (x.size || 0));
  return apps;
}

module.exports = { listApps };

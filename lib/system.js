const { shell } = require('electron');
const fsp = require('fs').promises;
const path = require('path');
const { runPowerShell } = require('./powershell');

async function listDrives() {
  const script = `
$d = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2 OR DriveType=3" -ErrorAction SilentlyContinue
$r = foreach ($x in $d) {
  [PSCustomObject]@{
    id    = [string]$x.DeviceID
    name  = [string]$x.VolumeName
    total = [int64]$x.Size
    free  = [int64]$x.FreeSpace
  }
}
$r | ConvertTo-Json -Depth 3
`;
  const out = await runPowerShell(script, { json: true });
  if (!out) return [];
  const list = Array.isArray(out) ? out : [out];
  return list
    .filter((d) => d && d.id)
    .map((d) => ({
      id: d.id,
      name: d.name || '本地磁盘',
      total: d.total || 0,
      free: d.free || 0,
      used: Math.max(0, (d.total || 0) - (d.free || 0)),
    }));
}

/** 受保护的系统目录（不允许被 AI/误删直接移入回收站） */
function isProtectedPath(p) {
  const norm = p.toLowerCase().replace(/[\\/]+$/, '');
  const protectedDirs = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\programdata',
    'c:\\$recycle.bin',
    'c:\\system volume information',
    'c:\\recovery',
    'c:\\boot',
  ];
  return protectedDirs.some((d) => norm === d || norm.startsWith(d + '\\'));
}

/** 移入回收站（可恢复） */
async function trashItems(paths, opts = {}) {
  const allowProtected = !!opts.allowProtected;
  const results = [];
  for (const p of paths) {
    try {
      if (!allowProtected && isProtectedPath(p)) {
        results.push({ path: p, ok: false, error: '受保护的系统目录，已跳过' });
        continue;
      }
      await shell.trashItem(p);
      results.push({ path: p, ok: true });
    } catch (e) {
      results.push({ path: p, ok: false, error: e.message || String(e) });
    }
  }
  return results;
}

/** 永久删除（不可恢复） */
async function deletePermanently(paths) {
  const results = [];
  for (const p of paths) {
    try {
      await fsp.rm(p, { recursive: true, force: true });
      results.push({ path: p, ok: true });
    } catch (e) {
      results.push({ path: p, ok: false, error: e.message || String(e) });
    }
  }
  return results;
}

async function openPath(p) {
  const r = await shell.openPath(p);
  return { ok: !r, error: r || '' };
}

async function showInFolder(p) {
  // 打开所在文件夹（p 为文件或目录）
  const target = path.dirname(p);
  const r = await shell.openPath(target);
  return { ok: !r, error: r || '' };
}

module.exports = { listDrives, trashItems, deletePermanently, openPath, showInFolder, isProtectedPath };

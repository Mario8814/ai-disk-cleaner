const { spawn } = require('child_process');

function launchDetached(commandLine) {
  const child = spawn(commandLine, { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return child;
}

/**
 * 启动卸载程序：
 *  1. 优先使用注册表里的 UninstallString（对 MSI 的 /I 修正为 /X）
 *  2. 没有卸载命令时回退到 winget uninstall
 */
function uninstallApp(app) {
  let cmd = app.uninstallString || '';

  if (cmd) {
    // MSI 的卸载字符串常误写为 /I{GUID}，需改为 /X
    if (/msiexec\.exe/i.test(cmd) && /\s\/i\{/i.test(cmd)) {
      cmd = cmd.replace(/\/i\{/i, '/X{');
    }
    launchDetached(cmd);
    return { ok: true, method: 'uninstaller', message: `已启动卸载程序：${app.name}` };
  }

  if (app.name) {
    const child = spawn(
      'winget',
      ['uninstall', '--name', app.name, '--exact', '--silent', '--accept-source-agreements'],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    child.unref();
    return { ok: true, method: 'winget', message: `已通过 winget 启动卸载：${app.name}` };
  }

  return { ok: false, method: null, message: '没有可用的卸载命令，请在「设置 → 应用」中手动卸载。' };
}

module.exports = { uninstallApp };

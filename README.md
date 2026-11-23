# 🧹 AI 磁盘管家 (Disk Cleaner)

一个 Windows 桌面小工具：可视化磁盘占用、删除文件/卸载应用、接入 AI 给出清理建议。

## 功能

1. **空间视图** — 用「树状方块图 (Treemap)」直观展示磁盘/文件夹占用，点击方块逐层下钻，右侧列出最大的文件与文件夹。
2. **应用卸载** — 读取系统已安装应用（含大小），一键启动卸载程序（支持 MSI / 常规卸载器 / winget 回退）。
3. **AI 清理** — 接入 DeepSeek，把「最大的文件/文件夹/已装软件」发给 AI，返回带风险等级的清理建议，勾选后一键执行。

## 运行环境

- Windows 10/11
- 已安装 Node.js（本机已装 v26）

## 安装与运行

在项目目录执行：

```bash
npm install
npm start
```

> 若 Electron 二进制下载慢/失败（国内网络），已内置镜像，也可手动指定：
>
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

## 使用步骤

1. 左侧选择磁盘，点 **「扫描选中磁盘」**（或「扫描指定文件夹」只看某个目录）。
2. 方块图里**点击方块**进入子目录，顶部面包屑可返回；右侧勾选大文件/文件夹后点「删除选中」。
3. 顶部切到 **「应用卸载」**，可搜索并卸载软件。
4. 切到 **「AI 清理」**，填写 DeepSeek 的 **API Key**（`https://platform.deepseek.com` 获取），点「开始分析」，勾选建议后「执行选中清理」。

## 安全说明

- 删除文件/文件夹**默认移入回收站**（可恢复）；右侧可取消勾选「移入回收站」改为永久删除（会二次确认）。
- AI 建议的清理会**自动跳过系统关键目录**（`C:\Windows`、`Program Files`、`ProgramData` 等），只删用户内容。
- AI 分析会把你机器上「大文件/大文件夹路径和大小、已装软件列表」发送到 DeepSeek，请确认可接受。
- 卸载应用会调用应用自带的卸载程序，请按提示操作。

## 目录结构

```
ai-disk-cleaner/
├── main.js             Electron 主进程 + IPC
├── preload.js          安全桥接 (contextBridge)
├── lib/
│   ├── scanner.js      磁盘扫描（异步、进度、取消、跳过 junction）
│   ├── system.js       磁盘列表 / 删除 / 回收站 / 受保护目录
│   ├── apps.js         读取已安装应用（注册表）
│   ├── uninstall.js    卸载程序
│   ├── ai.js           DeepSeek 调用 + 配置存取
│   └── powershell.js   PowerShell -EncodedCommand 封装
└── src/
    ├── index.html
    ├── style.css
    ├── treemap.js       Squarified Treemap 布局算法
    └── renderer.js      前端交互
```

## 打包成 exe（可选）

```bash
npm install --save-dev electron-builder
npx electron-builder --win
```

生成的可执行文件在 `dist/` 目录。

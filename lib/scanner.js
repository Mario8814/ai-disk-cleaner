const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * 递归扫描目录，返回：
 *   tree        目录树（仅包含目录节点，含累计 size / fileCount）
 *   largestFiles 最大的若干文件 [{ name, path, size }]
 * 支持进度回调和取消。跳过符号链接/目录联接(junction)以避免死循环。
 */
async function scanDirectory(root, { onProgress, shouldCancel } = {}) {
  root = path.resolve(root);

  let fileCount = 0;
  let dirCount = 0;
  let visited = 0;
  const largestFiles = [];
  const MAX_FILES = 4000;
  const KEEP = 2000;

  function noteFile(name, p, size) {
    if (!size || size <= 0) return;
    if (largestFiles.length < MAX_FILES) {
      largestFiles.push({ name, path: p, size });
    } else {
      // 每积累到上限，排序并截断一次，控制内存
      largestFiles.sort((a, b) => b.size - a.size);
      largestFiles.length = KEEP;
      const last = largestFiles[largestFiles.length - 1];
      if (size > last.size) {
        largestFiles[largestFiles.length - 1] = { name, path: p, size };
      }
    }
  }

  async function walk(dirPath) {
    if (shouldCancel && shouldCancel()) return null;

    const node = {
      name: path.basename(dirPath) || dirPath,
      path: dirPath,
      size: 0,
      fileCount: 0,
      isDir: true,
      children: [],
    };

    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch (e) {
      return node; // 无权限或不可访问
    }
    dirCount++;

    for (const entry of entries) {
      if (shouldCancel && shouldCancel()) break;
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const st = await fsp.lstat(full);
          if (st.isSymbolicLink()) continue; // 跳过 junction / symlink
          const child = await walk(full);
          if (child) {
            node.size += child.size;
            node.fileCount += child.fileCount;
            if (child.children.length > 0 || child.size > 0) {
              node.children.push(child);
            }
          }
        } else if (entry.isFile()) {
          const st = await fsp.stat(full);
          node.size += st.size;
          node.fileCount++;
          fileCount++;
          noteFile(entry.name, full, st.size);
        }
      } catch (e) {
        // 单个条目不可访问，跳过
      }
      visited++;
      if (onProgress && visited % 256 === 0) {
        onProgress({ visited, fileCount, dirCount, currentPath: full });
      }
    }

    return node;
  }

  const tree = await walk(root);
  const cancelled = !!(shouldCancel && shouldCancel());

  if (!tree) {
    return {
      tree: {
        name: path.basename(root) || root,
        path: root,
        size: 0,
        fileCount: 0,
        isDir: true,
        children: [],
      },
      largestFiles: [],
      fileCount: 0,
      dirCount: 0,
      cancelled: true,
    };
  }

  largestFiles.sort((a, b) => b.size - a.size);
  return {
    tree,
    largestFiles: largestFiles.slice(0, 300),
    fileCount,
    dirCount,
    cancelled,
  };
}

module.exports = { scanDirectory };

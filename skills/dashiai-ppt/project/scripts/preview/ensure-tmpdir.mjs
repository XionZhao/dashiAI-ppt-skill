// tmpdir 保险丝:沙箱型 Agent App(如豆包)在自己的沙箱环境里启动常驻预览服务时,
// 进程会继承一个指向宿主沙箱临时目录的 TMPDIR;宿主会话结束后该目录被清理,而
// daemonize 的服务还活着——之后任何 os.tmpdir() 消费方都会 ENOENT,最典型的是导出
// 时 Playwright launch 内部的 mkdtemp(报错形如
// `browserType.launch: ENOENT ... mkdtemp '<local-path>'`)。
// 处理方式:检测到 os.tmpdir() 指向不存在的目录时,把 TMPDIR/TMP/TEMP 从进程环境里
// 摘掉,让 Node 回退到系统默认位置(macOS/Linux 为 /tmp)。不尝试重建原目录——那是
// 宿主的沙箱,随时会再次被清理。
import fs from 'node:fs';
import os from 'node:os';

export function ensureUsableTmpdir(log = () => {}) {
  const current = os.tmpdir();
  if (fs.existsSync(current)) return current;
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) delete process.env[key];
  const fallback = os.tmpdir();
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {
    // 系统默认临时目录建不出来的话,后续消费方会用原始错误暴露问题,这里不吞。
  }
  log(`[tmpdir] ${current} 不存在(宿主沙箱已清理),已回退到 ${fallback}`);
  return fallback;
}

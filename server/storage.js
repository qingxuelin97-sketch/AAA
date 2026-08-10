import path from 'path';
import fs from 'node:fs';
import { DB_FILE } from './db.js';

// —— 用户上传文件的落盘位置 ——
//
// 此前写死在 server/uploads。自建 VPS 上没问题（.gitignore 有 server/uploads/*，
// update.sh 的 git reset --hard 不动未跟踪文件，文件是持久的），但托管平台上不是：
// render.yaml 把 DB_PATH 指向持久盘 /data/data.sqlite，而上传文件仍写进容器内的
// server/uploads —— 每次部署容器重建，**数据库活下来、文件全没**。
// 于是 user_uploads 表里的行指向不存在的文件：配额被幽灵占用，而 upload.js 提示
// 用户「请删除旧资源」时，删除端点根本不存在。
//
// 默认值改为跟随 DB_PATH 所在目录：
//   · 自建 VPS：DB_PATH 缺省 → server/data.sqlite → server/uploads，与原行为逐字节一致
//   · Render：DB_PATH=/data/data.sqlite → /data/uploads，自动落到持久盘
// 也就是说这个默认值对既有部署零影响，同时把托管场景默认修好。
// 需要分离时用 UPLOAD_DIR 显式覆盖。
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(path.dirname(DB_FILE), 'uploads');

export function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

// 上传文件名由 crypto.randomBytes 生成（12 字节 hex + 扩展名），不含路径分隔符。
// 删除端点收到的是用户可控输入，这里做一次强校验，杜绝 ../ 逃逸到上传目录之外。
export const SAFE_FILENAME = /^[a-f0-9]{24}\.[a-z0-9]{2,5}$/;

export function uploadPathFor(filename) {
  if (!SAFE_FILENAME.test(filename)) return null;
  const abs = path.join(UPLOAD_DIR, filename);
  // 双保险：即便正则将来被放宽，也不允许解析结果跑出上传目录。
  if (path.dirname(path.resolve(abs)) !== path.resolve(UPLOAD_DIR)) return null;
  return abs;
}

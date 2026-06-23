// 自动滚存：把整站数据快照（JSON）周期性写入外部持久存储，并在启动时回灌，
// 让数据在容器重新部署（临时磁盘被清空）后依然存活。
//
// 启用方式（任选其一，未设置则不启用、零影响）：
//   1) 微信云托管 MySQL：在控制台「关联 MySQL」后，平台会注入 MYSQL_* 环境变量，
//      本模块自动识别并自动建库建表，无需手填 URL；也可手动设 BACKUP_MYSQL_URL。
//   2) 持久磁盘 / NFS：设置 BACKUP_FILE=/data/huanyu-snapshot.json
// 可选 BACKUP_INTERVAL_MS（默认 120000，即每 2 分钟滚存一次）。
import fs from 'node:fs';
import { exportAll, importAll, rowCount } from './snapshot.js';

const env = process.env;
const FILE = env.BACKUP_FILE || '';
const INTERVAL = Math.max(15000, parseInt(env.BACKUP_INTERVAL_MS, 10) || 120000);
const KEY = 'huanyu_snapshot';

// Resolve a MySQL config from an explicit URL or from common injected env vars
// (微信云托管 / 腾讯云 / 通用命名都尽量兼容)。返回 null 表示未配置 MySQL。
function mysqlCfg() {
  if (env.BACKUP_MYSQL_URL) return { uri: env.BACKUP_MYSQL_URL };
  const addr = env.MYSQL_ADDRESS || env.MYSQL_ADDR || '';
  const host = env.MYSQL_HOST || env.DB_HOST || env.MYSQL_IP || (addr ? addr.split(':')[0] : '');
  if (!host) return null;
  const port = parseInt(env.MYSQL_PORT || env.DB_PORT || (addr.includes(':') ? addr.split(':')[1] : '') || '3306', 10);
  const user = env.MYSQL_USERNAME || env.MYSQL_USER || env.DB_USER || 'root';
  const password = env.MYSQL_PASSWORD || env.MYSQL_PWD || env.DB_PASSWORD || '';
  const database = (env.MYSQL_DATABASE || env.MYSQL_DB || env.DB_NAME || 'huanyu').replace(/[^A-Za-z0-9_]/g, '') || 'huanyu';
  return { host, port, user, password, database };
}
const MYSQL = mysqlCfg();

export const persistenceEnabled = () => !!(MYSQL || FILE);
export const persistenceKind = () => (MYSQL ? 'mysql' : FILE ? 'file' : 'none');

let pool = null;
async function mysql() {
  if (pool) return pool;
  const { createPool, createConnection } = await import('mysql2/promise');
  if (MYSQL.uri) {
    pool = createPool(MYSQL.uri + (MYSQL.uri.includes('?') ? '&' : '?') + 'connectionLimit=2');
  } else {
    // 自动建库：先不带库名连接，确保数据库存在，再连到该库。
    const boot = await createConnection({ host: MYSQL.host, port: MYSQL.port, user: MYSQL.user, password: MYSQL.password });
    await boot.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL.database}\` CHARACTER SET utf8mb4`);
    await boot.end();
    pool = createPool({ host: MYSQL.host, port: MYSQL.port, user: MYSQL.user, password: MYSQL.password, database: MYSQL.database, connectionLimit: 2 });
  }
  await pool.query('CREATE TABLE IF NOT EXISTS app_snapshot (k VARCHAR(64) PRIMARY KEY, v LONGTEXT, updated_at BIGINT)');
  return pool;
}

let lastHash = '';
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; };

// Read a snapshot JSON string from the backend (or null if none yet).
async function pull() {
  if (MYSQL) { const p = await mysql(); const [rows] = await p.query('SELECT v FROM app_snapshot WHERE k = ?', [KEY]); return rows?.[0]?.v || null; }
  if (FILE) { try { return fs.readFileSync(FILE, 'utf8'); } catch { return null; } }
  return null;
}
async function put(json) {
  if (MYSQL) { const p = await mysql(); await p.query('INSERT INTO app_snapshot (k,v,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE v=VALUES(v), updated_at=VALUES(updated_at)', [KEY, json, Date.now()]); return; }
  if (FILE) { fs.mkdirSync(FILE.replace(/\/[^/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(FILE + '.tmp', json); fs.renameSync(FILE + '.tmp', FILE); }
}

// Save current DB → backend (skips when nothing changed).
export async function flush(force = false) {
  if (!persistenceEnabled()) return;
  try {
    const json = JSON.stringify({ v: 1, at: Date.now(), tables: exportAll() });
    const h = hash(json);
    if (!force && h === lastHash) return;
    await put(json); lastHash = h;
  } catch (e) { console.error('[persist] 滚存失败：', e.message); }
}

// On boot: if the backend holds a snapshot, load it into the (fresh) DB.
export async function restoreOnBoot() {
  if (!persistenceEnabled()) { console.log('[persist] 未配置外部存储，数据仅存于本地（重新部署会重置）。'); return; }
  console.log(`[persist] 持久化后端：${persistenceKind()}`);
  try {
    const raw = await pull();
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.tables) { importAll(data.tables); lastHash = hash(raw); console.log(`[persist] 已从快照恢复（用户 ${rowCount('users')} 名）。`); return; }
    }
    // No snapshot yet — this is the first run; seed/local data becomes the baseline.
    await flush(true);
    console.log('[persist] 暂无远端快照，已用当前数据建立首个快照。');
  } catch (e) { console.error('[persist] 启动恢复失败：', e.message); }
}

// Start the rolling timer + flush on shutdown.
export function startRolling() {
  if (!persistenceEnabled()) return;
  const timer = setInterval(() => { flush(); }, INTERVAL);
  if (timer.unref) timer.unref();
  let bye = false;
  const onExit = async (sig) => { if (bye) return; bye = true; try { await flush(true); } finally { process.exit(sig === 'SIGINT' ? 130 : 0); } };
  process.on('SIGTERM', () => onExit('SIGTERM'));
  process.on('SIGINT', () => onExit('SIGINT'));
}

import db from './db.js';

export const USERS_PER_SEAT = 100; // 平均每 100 名注册用户对应一个议会席位
export const MIN_SEATS = 5;

const DEFAULT = { seats_override: null, term: 1, term_started_at: new Date().toISOString(), locked: false, locked_at: null };

export function councilCfg() {
  const row = db.prepare("SELECT value FROM app_config WHERE key='council'").get();
  if (!row) { saveCouncil(DEFAULT); return { ...DEFAULT }; }
  try { return { ...DEFAULT, ...JSON.parse(row.value) }; } catch { return { ...DEFAULT }; }
}
export function saveCouncil(cfg) {
  db.prepare("INSERT INTO app_config (key, value) VALUES ('council', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(cfg));
}
export const totalUsers = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;
export const baseSeats = () => Math.floor(totalUsers() / USERS_PER_SEAT);
export function councilSeats() { const c = councilCfg(); return c.seats_override != null ? c.seats_override : Math.max(MIN_SEATS, baseSeats()); }
export const councilSize = () => db.prepare('SELECT COUNT(*) n FROM users WHERE is_councilor=1').get().n;
export const parliamentLocked = () => !!councilCfg().locked;

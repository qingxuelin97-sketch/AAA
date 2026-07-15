import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB_PATH lets hosted deploys point at a persistent volume (e.g. a mounted disk).
const dbFile = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// 并发写等待：第二个连接（CLI 脚本 / 迁移 / 未来多进程）遇写锁时最多等 5s 再报
// SQLITE_BUSY，而非立即 500。单连接同步访问下无副作用。
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar TEXT,
  banner TEXT,
  bio TEXT DEFAULT '',
  gold INTEGER DEFAULT 300,
  diamond INTEGER DEFAULT 0,
  diamond_debt INTEGER DEFAULT 0,
  economic_hold INTEGER DEFAULT 0,
  economic_hold_reason TEXT DEFAULT '',
  economic_hold_at INTEGER,
  vip_until TEXT,
  last_checkin TEXT,
  checkin_streak INTEGER DEFAULT 0,
  is_gm INTEGER DEFAULT 0,
  is_banned INTEGER DEFAULT 0,
  ban_reason TEXT DEFAULT '',
  svip INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0,
  verified_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  llm_provider TEXT DEFAULT 'openai',
  llm_base_url TEXT DEFAULT 'https://api.openai.com/v1',
  llm_api_key TEXT DEFAULT '',
  llm_model TEXT DEFAULT 'gpt-4o-mini',
  llm_temperature REAL DEFAULT 0.8,
  llm_max_tokens INTEGER DEFAULT 1024,
  voice_provider TEXT DEFAULT 'openai',
  voice_base_url TEXT DEFAULT 'https://api.openai.com/v1',
  voice_api_key TEXT DEFAULT '',
  voice_model TEXT DEFAULT 'tts-1',
  voice_name TEXT DEFAULT 'alloy',
  theme TEXT DEFAULT 'dark',
  nsfw INTEGER DEFAULT 0,
  notify_email INTEGER DEFAULT 0
);

-- Site-wide announcements (posted by GM users)
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Registration invite keys (also usable as gift codes)
CREATE TABLE IF NOT EXISTS invite_keys (
  code TEXT PRIMARY KEY,
  max_uses INTEGER DEFAULT 1,
  used INTEGER DEFAULT 0,
  grant_gold INTEGER DEFAULT 0,
  grant_diamond INTEGER DEFAULT 0,
  grant_vip_days INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Wallet ledger
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,          -- recharge|exchange|vip|buy_script|sell_script|refund|checkin|invite|reward
  gold INTEGER DEFAULT 0,      -- signed delta
  diamond INTEGER DEFAULT 0,   -- signed delta
  gross_diamond INTEGER,
  diamond_debt_delta INTEGER DEFAULT 0,
  diamond_debt_after INTEGER DEFAULT 0,
  gold_balance_after INTEGER,
  diamond_balance_after INTEGER,
  memo TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, slug TEXT, icon TEXT, kind TEXT DEFAULT 'all'
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar TEXT, background TEXT, background_type TEXT DEFAULT 'image',
  tagline TEXT DEFAULT '', intro TEXT DEFAULT '', greeting TEXT DEFAULT '',
  persona TEXT DEFAULT '', voice_name TEXT DEFAULT '', voice_speed REAL DEFAULT 1, voice_pitch REAL DEFAULT 1,
  category TEXT DEFAULT '', tags TEXT DEFAULT '',
  is_public INTEGER DEFAULT 0, nsfw INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0, uses INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0, featured INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  keys TEXT DEFAULT '', content TEXT DEFAULT '', enabled INTEGER DEFAULT 1, position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  title TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);

-- Scripts (剧本): may be free or gold-priced
CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, summary TEXT DEFAULT '', cover TEXT,
  content TEXT DEFAULT '',          -- scenario / opening / rules
  category TEXT DEFAULT '', tags TEXT DEFAULT '',
  price_gold INTEGER DEFAULT 0,     -- 0 = free
  nsfw INTEGER DEFAULT 0,
  plays INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0, featured INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Reviews / ratings on characters & scripts
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,   -- character | script
  target_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER DEFAULT 5,
  text TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Content reports queued for GM review
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,   -- character | script | moment | user
  target_id INTEGER NOT NULL,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'open',  -- open | resolved
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS script_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER REFERENCES scripts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  price INTEGER DEFAULT 0,
  refunded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Marketplace character cards (kept for one-click import flow)
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'card', title TEXT NOT NULL, body TEXT DEFAULT '',
  cover TEXT, character_id INTEGER, payload TEXT DEFAULT '', tags TEXT DEFAULT '',
  likes INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);

-- Community social moments
CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  text TEXT DEFAULT '', image TEXT,
  likes INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS moment_likes (
  moment_id INTEGER REFERENCES moments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (moment_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER REFERENCES moments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, following_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, link TEXT DEFAULT '', read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- "Push to other players" inbox
CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER, from_user INTEGER, to_user INTEGER,
  note TEXT DEFAULT '', seen INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);

-- User group chat
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  avatar TEXT, description TEXT DEFAULT '', is_public INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member', joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);

-- Theater: multiple humans + multiple AI characters in one room
CREATE TABLE IF NOT EXISTS theaters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  scene TEXT DEFAULT '', cover TEXT, script_id INTEGER,
  is_public INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS theater_members (
  theater_id INTEGER REFERENCES theaters(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (theater_id, user_id)
);
CREATE TABLE IF NOT EXISTS theater_cast (
  theater_id INTEGER REFERENCES theaters(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (theater_id, character_id)
);
CREATE TABLE IF NOT EXISTS theater_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theater_id INTEGER REFERENCES theaters(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,        -- user | ai | narrator
  sender_id INTEGER,                -- user id or character id
  name TEXT, avatar TEXT, content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Key-value store for group-wide config (platform AI services) + AI image gallery.
db.exec(`
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL, size TEXT DEFAULT '1024x1024', url TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date TEXT, counts TEXT DEFAULT '{}', claimed TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS event_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT DEFAULT '', status TEXT DEFAULT 'pending',
  adopted_at TEXT, decided_at TEXT, tally TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS proposal_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  choice TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS proposal_endorse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS proposal_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  b_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS post_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Lightweight column migrations (add new columns to existing DBs; ignore if present).
for (const sql of [
  "ALTER TABLE users ADD COLUMN ach_claimed TEXT DEFAULT '[]'",
  'ALTER TABLE users ADD COLUMN gacha_pulls INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN is_councilor INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN last_active INTEGER',
  'ALTER TABLE users ADD COLUMN rev_claim_month TEXT',
  'ALTER TABLE users ADD COLUMN rev_claimed_total INTEGER DEFAULT 0',
  // 反批量注册：记录注册来源 IP（按 IP 限日配额）与邮箱规范形
  //（去 +tag / gmail 去点，封别名邮箱无限注册）。
  'ALTER TABLE users ADD COLUMN reg_ip TEXT',
  'ALTER TABLE users ADD COLUMN email_canon TEXT',
  // 反单设备多注册：原生壳注册时记录设备标识（Android ANDROID_ID / iOS
  // identifierForVendor，经 X-Device-Id 头上报），按设备限 30 天注册配额。
  'ALTER TABLE users ADD COLUMN reg_device TEXT',
  "ALTER TABLE users ADD COLUMN reg_trust TEXT DEFAULT 'legacy'",
  'ALTER TABLE users ADD COLUMN integrity_checked_at INTEGER',
  'ALTER TABLE users ADD COLUMN diamond_debt INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN economic_hold INTEGER DEFAULT 0',
  "ALTER TABLE users ADD COLUMN economic_hold_reason TEXT DEFAULT ''",
  'ALTER TABLE users ADD COLUMN economic_hold_at INTEGER',
  'ALTER TABLE transactions ADD COLUMN ref_owner INTEGER',
  'ALTER TABLE transactions ADD COLUMN payment_order_id TEXT',
  // Ledger correlation/idempotency. share_eligible keeps a reserved upstream
  // fee out of creator revenue until the result is actually delivered (or the
  // fee and its reversal are made visible atomically).
  'ALTER TABLE transactions ADD COLUMN operation_id TEXT',
  'ALTER TABLE transactions ADD COLUMN idempotency_key TEXT',
  'ALTER TABLE transactions ADD COLUMN reversal_of INTEGER',
  'ALTER TABLE transactions ADD COLUMN share_eligible INTEGER DEFAULT 1',
  'ALTER TABLE transactions ADD COLUMN gross_diamond INTEGER',
  'ALTER TABLE transactions ADD COLUMN diamond_debt_delta INTEGER DEFAULT 0',
  'ALTER TABLE transactions ADD COLUMN diamond_debt_after INTEGER DEFAULT 0',
  'ALTER TABLE transactions ADD COLUMN gold_balance_after INTEGER',
  'ALTER TABLE transactions ADD COLUMN diamond_balance_after INTEGER',
  'ALTER TABLE script_purchases ADD COLUMN settlement_due_at INTEGER',
  'ALTER TABLE script_purchases ADD COLUMN settled_at INTEGER',
  // Scripts are unpublished rather than destroyed. Purchase snapshots remain
  // immutable evidence and keep paid content available after unpublishing.
  'ALTER TABLE scripts ADD COLUMN deleted_at INTEGER',
  'ALTER TABLE script_purchases ADD COLUMN snapshot_author_id INTEGER',
  "ALTER TABLE script_purchases ADD COLUMN snapshot_title TEXT DEFAULT ''",
  "ALTER TABLE script_purchases ADD COLUMN snapshot_summary TEXT DEFAULT ''",
  'ALTER TABLE script_purchases ADD COLUMN snapshot_cover TEXT',
  "ALTER TABLE script_purchases ADD COLUMN snapshot_content TEXT DEFAULT ''",
  "ALTER TABLE script_purchases ADD COLUMN snapshot_category TEXT DEFAULT ''",
  "ALTER TABLE script_purchases ADD COLUMN snapshot_tags TEXT DEFAULT ''",
  'ALTER TABLE conversations ADD COLUMN affinity INTEGER DEFAULT 0',
  "ALTER TABLE conversations ADD COLUMN memories TEXT DEFAULT '[]'",
  'ALTER TABLE messages ADD COLUMN reaction TEXT',
  "ALTER TABLE settings ADD COLUMN llm_protocol TEXT DEFAULT 'openai'",
  "ALTER TABLE settings ADD COLUMN voice_protocol TEXT DEFAULT 'openai'",
  "ALTER TABLE settings ADD COLUMN privacy_profile TEXT DEFAULT 'public'",
  "ALTER TABLE settings ADD COLUMN allow_dm TEXT DEFAULT 'all'",
  'ALTER TABLE settings ADD COLUMN show_online INTEGER DEFAULT 1',
  'ALTER TABLE settings ADD COLUMN discoverable INTEGER DEFAULT 1',
  'ALTER TABLE settings ADD COLUMN activity_visible INTEGER DEFAULT 1',
  'ALTER TABLE settings ADD COLUMN leaderboard_visible INTEGER DEFAULT 1',
  'ALTER TABLE settings ADD COLUMN read_receipts INTEGER DEFAULT 1',
  'ALTER TABLE settings ADD COLUMN personalize INTEGER DEFAULT 1',
  "ALTER TABLE characters ADD COLUMN bgm TEXT DEFAULT ''",
  'ALTER TABLE characters ADD COLUMN voice_speed REAL DEFAULT 1',
  'ALTER TABLE characters ADD COLUMN voice_pitch REAL DEFAULT 1',
  // 前端显示正则（酒馆 regex_scripts）：find/replace 于消息「显示」层，支持注入 HTML 面板等专家前端
  "ALTER TABLE characters ADD COLUMN front_regex TEXT DEFAULT '[]'",
  // 备用开场白（酒馆 alternate_greetings）：JSON 数组，聊天页可切换开场
  "ALTER TABLE characters ADD COLUMN alt_greetings TEXT DEFAULT '[]'",
  // 内嵌世界书常驻标记（酒馆 constant）：1 = 无视关键词恒注入。
  // 修复：酒馆卡大量「constant=true 且带关键词」的规则条目此前被降级为关键词触发，
  // 导致驱动卡片游戏引擎的常驻规则永不注入。
  'ALTER TABLE world_entries ADD COLUMN constant INTEGER DEFAULT 0',
  // 安全相关：token 版本号（改密后旧 token 失效）
  'ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0',
  // 安全相关：账号锁定（登录失败计数 + 锁定截止时间）
  'ALTER TABLE users ADD COLUMN failed_logins INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN locked_until INTEGER DEFAULT 0',
  // 互动小说舞台设定：角色发言自动切背景 / 角色背景覆盖 / 场景关键词触发背景（创作者自定义）
  "ALTER TABLE theaters ADD COLUMN stage_config TEXT DEFAULT '{}'",
  // 互动小说专属世界书：叠加在所有登场角色之上的额外设定（关键词触发 / 常驻）
  "ALTER TABLE theaters ADD COLUMN worldbook TEXT DEFAULT '[]'",
  // 互动小说 · 导演台：文风 / 导演密令（仅作者可见，暗中影响旁白）/ 连载状态 / 背景音乐
  "ALTER TABLE theaters ADD COLUMN style TEXT DEFAULT ''",
  "ALTER TABLE theaters ADD COLUMN directive TEXT DEFAULT ''",
  "ALTER TABLE theaters ADD COLUMN status TEXT DEFAULT 'ongoing'",
  "ALTER TABLE theaters ADD COLUMN bgm TEXT DEFAULT ''",
  // 段落读者反应：JSON { emoji: [userId,…] }
  "ALTER TABLE theater_messages ADD COLUMN reactions TEXT DEFAULT ''",
]) { try { db.exec(sql); } catch { /* column already exists */ } }

// 安全相关：剧本点赞去重表，PRIMARY KEY(script_id,user_id) 防重复点赞刷数。
db.exec(`CREATE TABLE IF NOT EXISTS script_likes (
  script_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (script_id, user_id)
)`);

// 安全相关：event_claims 加 (user_id, event_id) 唯一索引，原子防并发重复领取。
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_event_claims_uniq ON event_claims (user_id, event_id)'); } catch { /* */ }

// Failed-login buckets are stored in SQLite rather than process memory, so
// multiple server workers share the same rolling window. Only keyed HMACs are
// persisted; raw usernames and IP addresses are intentionally omitted.
db.exec(`
CREATE TABLE IF NOT EXISTS auth_login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_ip_key TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_login_failures_account
  ON auth_login_failures (account_ip_key, failed_at);
CREATE INDEX IF NOT EXISTS idx_auth_login_failures_ip
  ON auth_login_failures (ip_key, failed_at);
`);

// 注册白名单 + 邮箱验证码：
//   email_whitelist —— 仅白名单内的邮箱允许注册（白名单政策）。
//     kind: 'exact' 精确邮箱 / 'domain' 整域放行（如 @example.com）。
//   email_codes    —— 注册时下发的验证码，过期/已用即作废。
db.exec(`
CREATE TABLE IF NOT EXISTS email_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,        -- 精确邮箱或 @domain（小写）
  kind TEXT DEFAULT 'exact',         -- exact | domain
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,       -- 毫秒时间戳
  consumed INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,        -- 校验尝试次数（防爆破）
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes (email);
`);

for (const sql of [
  "ALTER TABLE email_codes ADD COLUMN purpose TEXT DEFAULT 'register'",
  'ALTER TABLE email_codes ADD COLUMN user_id INTEGER',
]) { try { db.exec(sql); } catch { /* column already exists */ } }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_email_codes_lookup ON email_codes (email, purpose, user_id, consumed, id)'); } catch { /* */ }

// Payment orders are immutable price snapshots. Only a verified provider
// callback may move an order to credited and attach it to one ledger row.
db.exec(`
CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  package_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  diamond INTEGER NOT NULL CHECK (diamond > 0),
  bonus INTEGER NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','credited','refunded','chargeback','failed','expired','review_required')),
  provider_tx_id TEXT,
  client_request_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  credited_at INTEGER,
  refunded_at INTEGER,
  chargeback_at INTEGER,
  credited_diamond INTEGER NOT NULL DEFAULT 0,
  refund_amount_cents INTEGER NOT NULL DEFAULT 0,
  last_event_id TEXT,
  review_reason TEXT DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_tx
  ON payment_orders (provider, provider_tx_id) WHERE provider_tx_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_client_request
  ON payment_orders (user_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS payment_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  -- Deliberately no foreign key: every verified callback must be retained even
  -- when it references an unknown or already-pruned order. The reducer records
  -- that condition in processing_status/error_code instead of losing evidence.
  order_id TEXT NOT NULL,
  provider_tx_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  refund_amount_cents INTEGER NOT NULL DEFAULT 0,
  key_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  processed_at INTEGER,
  error_code TEXT DEFAULT '',
  received_at INTEGER NOT NULL,
  PRIMARY KEY (provider, event_id)
);
CREATE TABLE IF NOT EXISTS code_redemptions (
  code TEXT NOT NULL REFERENCES invite_keys(code) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS user_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_uploads_owner_time ON user_uploads (user_id, created_at);
`);

// SQLite cannot widen a CHECK constraint in place. Rebuild the two payment
// tables once when upgrading from the original paid/failed-only state model.
// All historical rows and event hashes are preserved; payment processing stays
// disabled unless the post-migration health check in payment.js passes.
const paymentOrderSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_orders'").get()?.sql || '';
if (paymentOrderSql && !paymentOrderSql.includes('review_required')) {
  let backupReady = dbFile === ':memory:';
  if (!backupReady) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbFile}.pre-payment-v2-${stamp}.bak`;
    try {
      // VACUUM INTO produces a transactionally consistent snapshot even with
      // WAL enabled. If backup creation fails, do not touch the legacy tables.
      db.prepare('VACUUM INTO ?').run(backupPath);
      backupReady = true;
      console.info(`[payment] 支付表升级前备份已写入 ${backupPath}`);
    } catch (error) {
      console.error('[payment] 无法创建升级前备份，支付表保持原状并安全关闭：', error.message);
    }
  }
  if (backupReady) db.pragma('foreign_keys = OFF');
  try {
    if (!backupReady) throw new Error('payment migration backup unavailable');
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE payment_events RENAME TO payment_events_legacy;
      ALTER TABLE payment_orders RENAME TO payment_orders_legacy;
      CREATE TABLE payment_orders (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        provider TEXT NOT NULL,
        package_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        currency TEXT NOT NULL DEFAULT 'CNY',
        diamond INTEGER NOT NULL CHECK (diamond > 0),
        bonus INTEGER NOT NULL DEFAULT 0 CHECK (bonus >= 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','credited','refunded','chargeback','failed','expired','review_required')),
        provider_tx_id TEXT,
        client_request_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        paid_at INTEGER,
        credited_at INTEGER,
        refunded_at INTEGER,
        chargeback_at INTEGER,
        credited_diamond INTEGER NOT NULL DEFAULT 0,
        refund_amount_cents INTEGER NOT NULL DEFAULT 0,
        last_event_id TEXT,
        review_reason TEXT DEFAULT ''
      );
      INSERT INTO payment_orders
        (id,user_id,provider,package_id,amount_cents,currency,diamond,bonus,status,provider_tx_id,client_request_id,
         created_at,updated_at,expires_at,paid_at,credited_at,credited_diamond)
      SELECT id,user_id,provider,package_id,amount_cents,currency,diamond,bonus,status,provider_tx_id,client_request_id,
         created_at,updated_at,created_at + 1800000,paid_at,
         CASE WHEN status='credited' THEN updated_at ELSE NULL END,
         CASE WHEN status='credited' THEN diamond + bonus ELSE 0 END
      FROM payment_orders_legacy;
      CREATE TABLE payment_events (
        provider TEXT NOT NULL,
        event_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        provider_tx_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        refund_amount_cents INTEGER NOT NULL DEFAULT 0,
        key_version TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        processing_status TEXT NOT NULL DEFAULT 'received',
        processed_at INTEGER,
        error_code TEXT DEFAULT '',
        received_at INTEGER NOT NULL,
        PRIMARY KEY (provider, event_id)
      );
      INSERT INTO payment_events
        (provider,event_id,order_id,provider_tx_id,event_type,amount_cents,currency,refund_amount_cents,key_version,
         payload_hash,payload_json,processing_status,processed_at,received_at)
      SELECT e.provider,e.event_id,e.order_id,COALESCE(o.provider_tx_id,'legacy'),
         CASE WHEN o.status='failed' THEN 'failed' ELSE 'paid' END,o.amount_cents,o.currency,0,'legacy',
         e.payload_hash,'{}','applied',e.received_at,e.received_at
      FROM payment_events_legacy e JOIN payment_orders_legacy o ON o.id=e.order_id;
      DROP TABLE payment_events_legacy;
      DROP TABLE payment_orders_legacy;
      COMMIT;
    `);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no active migration */ }
    console.error('[payment] 支付表升级失败，支付功能将保持关闭：', error.message);
  } finally {
    if (backupReady) db.pragma('foreign_keys = ON');
  }
}

for (const sql of [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_tx
    ON payment_orders (provider, provider_tx_id) WHERE provider_tx_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_client_request
    ON payment_orders (user_id, client_request_id) WHERE client_request_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created
    ON payment_orders (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_orders_user_open
    ON payment_orders (user_id, status, expires_at)`,
]) { try { db.exec(sql); } catch { /* health check will fail closed */ } }

try {
  // A payment has one credit but may also have one linked refund/chargeback.
  // The original broad index prevented recording the reversal beside its credit.
  db.exec('DROP INDEX IF EXISTS idx_transactions_payment_order');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment_credit
    ON transactions (payment_order_id) WHERE payment_order_id IS NOT NULL AND kind = 'recharge'`);
} catch { /* duplicate legacy data must be repaired before enabling payments */ }
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_operation
    ON transactions (operation_id) WHERE operation_id IS NOT NULL`);
} catch { /* duplicate legacy data must be repaired before enabling correlated ledger writes */ }
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency
    ON transactions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
} catch { /* duplicate legacy data */ }
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reversal
    ON transactions (reversal_of) WHERE reversal_of IS NOT NULL`);
} catch { /* duplicate legacy data */ }

try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL AND email != ''"); } catch { /* legacy duplicates */ }
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_canon ON users (email_canon) WHERE email_canon IS NOT NULL AND email_canon != ''"); } catch { /* legacy duplicates */ }
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_script_purchase_active ON script_purchases (script_id, user_id) WHERE refunded = 0'); } catch { /* legacy duplicates */ }
// Purchases created before escrow existed already paid their authors. Mark them
// settled so the new settlement worker never pays them a second time.
try { db.exec("UPDATE script_purchases SET settled_at = COALESCE(settled_at, CAST(strftime('%s', created_at) AS INTEGER) * 1000) WHERE refunded = 0 AND settlement_due_at IS NULL"); } catch { /* */ }
// Backfill immutable purchase metadata for pre-migration rows while their
// source script still exists. Future purchases write snapshots at creation.
try {
  db.exec(`UPDATE script_purchases SET
    snapshot_author_id = COALESCE(snapshot_author_id, (SELECT author_id FROM scripts WHERE scripts.id = script_purchases.script_id)),
    snapshot_title = CASE WHEN COALESCE(snapshot_title,'') = '' THEN COALESCE((SELECT title FROM scripts WHERE scripts.id = script_purchases.script_id),'') ELSE snapshot_title END,
    snapshot_summary = CASE WHEN COALESCE(snapshot_summary,'') = '' THEN COALESCE((SELECT summary FROM scripts WHERE scripts.id = script_purchases.script_id),'') ELSE snapshot_summary END,
    snapshot_cover = COALESCE(snapshot_cover, (SELECT cover FROM scripts WHERE scripts.id = script_purchases.script_id)),
    snapshot_content = CASE WHEN COALESCE(snapshot_content,'') = '' THEN COALESCE((SELECT content FROM scripts WHERE scripts.id = script_purchases.script_id),'') ELSE snapshot_content END,
    snapshot_category = CASE WHEN COALESCE(snapshot_category,'') = '' THEN COALESCE((SELECT category FROM scripts WHERE scripts.id = script_purchases.script_id),'') ELSE snapshot_category END,
    snapshot_tags = CASE WHEN COALESCE(snapshot_tags,'') = '' THEN COALESCE((SELECT tags FROM scripts WHERE scripts.id = script_purchases.script_id),'') ELSE snapshot_tags END`);
} catch { /* best-effort legacy backfill */ }

// 独立世界书：可脱离角色单独编辑，并跨角色复用（多对多关联）。
// 三类能力（通常/高级/专家）可在同一本世界书里共存，不再单选档位：
//   通常能力：关键词触发（keys/content/enabled）
//   高级能力：触发模式 mode、注入位置 inject_pos、优先级 priority、互斥分组 group_name、
//            大小写敏感 case_sensitive、作者备注 comment、排除关键词 exclude_keys、
//            触发概率 probability、最少轮数 min_turns、最多触发轮数 max_turns、冷却 cooldown、
//            AND关键词 required_keys、粘性 sticky、注入深度 depth
//   专家能力：预注入图片 image_urls / image_keys / image_position、自构前端 front_schema、
//            提示词叠加 prompt_overlay、前端槽位 front_slot、变量写入 variable_write、
//            分支 branch、语义检索 vectorize、语气标签 tone
//   世界书级：扫描深度 scan_depth、Token 预算 token_budget、递归触发 recursion、
//            最大激活条目数 max_active、世界变量声明 variable_schema、系统注入位置 system_pos、
//            递归最大轮数 recursion_depth
// 字段说明：
//   scan_depth：触发判定时回看最近多少条消息（默认 4）
//   token_budget：本轮注入世界书设定的最大 Token 数（0 = 不限）
//   recursion：是否递归触发（被激活条目的 content 中的关键词可继续激活其他条目）
//   probability：命中后的触发概率（0-100），100 = 必触发
//   min_turns：对话轮数达到此值后才允许触发（0 = 立即可触发）
//   max_turns：触发累计达到此轮数后自动停用（0 = 不限）
//   cooldown：触发后冷却 N 轮内不再触发（0 = 无冷却）
//   required_keys：必须同时命中全部关键词才触发（AND 逻辑，逗号分隔）
//   sticky：粘性轮数，一旦触发后持续 N 轮保持激活（0 = 不粘性）
//   depth：注入到历史第几条消息之后（0 = 当前轮）
//   variable_write：触发时写入的世界变量（如 met_queen=true，逗号分隔）
//   branch：分支条件 JSON，按变量值选不同 content
//   vectorize：是否启用语义检索触发（1=按 embedding 相似度匹配）
//   tone：语气标签，注入提示词影响叙述风格
//   max_active：每轮最大激活条目数（防 Token 爆炸，默认 6）
//   variable_schema：世界变量声明 JSON（变量名/默认值/类型）
//   system_pos：系统提示词注入位置（before/after/front）
//   recursion_depth：递归最大轮数（默认 2）
//   exclude_keys：出现任一关键词时，该条目本轮不触发（黑名单）
//   folder：条目所属文件夹（用于编辑器分组折叠）
db.exec(`
CREATE TABLE IF NOT EXISTS worldbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  tier TEXT DEFAULT 'expert',
  is_public INTEGER DEFAULT 0,
  uses INTEGER DEFAULT 0,
  front_schema TEXT DEFAULT '',
  prompt_overlay TEXT DEFAULT '',
  scan_depth INTEGER DEFAULT 4,
  token_budget INTEGER DEFAULT 0,
  recursion INTEGER DEFAULT 0,
  max_active INTEGER DEFAULT 6,
  variable_schema TEXT DEFAULT '',
  system_pos TEXT DEFAULT 'after',
  recursion_depth INTEGER DEFAULT 2,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS worldbook_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worldbook_id INTEGER REFERENCES worldbooks(id) ON DELETE CASCADE,
  keys TEXT DEFAULT '', content TEXT DEFAULT '', enabled INTEGER DEFAULT 1, position INTEGER DEFAULT 0,
  mode TEXT DEFAULT 'keyword',
  inject_pos TEXT DEFAULT 'after',
  priority INTEGER DEFAULT 50,
  case_sensitive INTEGER DEFAULT 0,
  group_name TEXT DEFAULT '',
  comment TEXT DEFAULT '',
  image_urls TEXT DEFAULT '',
  image_keys TEXT DEFAULT '',
  image_position TEXT DEFAULT 'inline',
  front_slot TEXT DEFAULT '',
  probability INTEGER DEFAULT 100,
  min_turns INTEGER DEFAULT 0,
  exclude_keys TEXT DEFAULT '',
  max_turns INTEGER DEFAULT 0,
  cooldown INTEGER DEFAULT 0,
  required_keys TEXT DEFAULT '',
  sticky INTEGER DEFAULT 0,
  depth INTEGER DEFAULT 0,
  variable_write TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  vectorize INTEGER DEFAULT 0,
  tone TEXT DEFAULT '',
  folder TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS character_worldbooks (
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  worldbook_id INTEGER REFERENCES worldbooks(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, worldbook_id)
);
`);
// 迁移：已有数据库补齐列。image_prompt 旧字段保留兼容，新逻辑使用 image_urls。
for (const sql of [
  "ALTER TABLE worldbook_entries ADD COLUMN mode TEXT DEFAULT 'keyword'",
  "ALTER TABLE worldbook_entries ADD COLUMN inject_pos TEXT DEFAULT 'after'",
  'ALTER TABLE worldbook_entries ADD COLUMN priority INTEGER DEFAULT 50',
  'ALTER TABLE worldbook_entries ADD COLUMN case_sensitive INTEGER DEFAULT 0',
  "ALTER TABLE worldbook_entries ADD COLUMN group_name TEXT DEFAULT ''",
  "ALTER TABLE worldbook_entries ADD COLUMN comment TEXT DEFAULT ''",
  "ALTER TABLE worldbook_entries ADD COLUMN image_prompt TEXT DEFAULT ''",
  "ALTER TABLE worldbook_entries ADD COLUMN image_keys TEXT DEFAULT ''",
  "ALTER TABLE worldbook_entries ADD COLUMN image_position TEXT DEFAULT 'inline'",
  "ALTER TABLE worldbook_entries ADD COLUMN front_slot TEXT DEFAULT ''",
  "ALTER TABLE worldbook_entries ADD COLUMN image_urls TEXT DEFAULT ''",
  'ALTER TABLE worldbook_entries ADD COLUMN probability INTEGER DEFAULT 100',
  'ALTER TABLE worldbook_entries ADD COLUMN min_turns INTEGER DEFAULT 0',
  "ALTER TABLE worldbook_entries ADD COLUMN exclude_keys TEXT DEFAULT ''",
  "ALTER TABLE worldbooks ADD COLUMN tier TEXT DEFAULT 'expert'",
  "ALTER TABLE worldbooks ADD COLUMN front_schema TEXT DEFAULT ''",
  "ALTER TABLE worldbooks ADD COLUMN prompt_overlay TEXT DEFAULT ''",
  'ALTER TABLE worldbooks ADD COLUMN scan_depth INTEGER DEFAULT 4',
  'ALTER TABLE worldbooks ADD COLUMN token_budget INTEGER DEFAULT 0',
  'ALTER TABLE worldbooks ADD COLUMN recursion INTEGER DEFAULT 0',
  'ALTER TABLE worldbooks ADD COLUMN max_active INTEGER DEFAULT 6',
  "ALTER TABLE worldbooks ADD COLUMN variable_schema TEXT DEFAULT ''",
  "ALTER TABLE worldbooks ADD COLUMN system_pos TEXT DEFAULT 'after'",
  'ALTER TABLE worldbooks ADD COLUMN recursion_depth INTEGER DEFAULT 2',
  'ALTER TABLE worldbook_entries ADD COLUMN max_turns INTEGER DEFAULT 0',
  'ALTER TABLE worldbook_entries ADD COLUMN cooldown INTEGER DEFAULT 0',
  "ALTER TABLE worldbook_entries ADD COLUMN required_keys TEXT DEFAULT ''",
  'ALTER TABLE worldbook_entries ADD COLUMN sticky INTEGER DEFAULT 0',
  'ALTER TABLE worldbook_entries ADD COLUMN depth INTEGER DEFAULT 0',
  "ALTER TABLE worldbook_entries ADD COLUMN variable_write TEXT DEFAULT ''",
  "ALTER TABLE worldbook_entries ADD COLUMN branch TEXT DEFAULT ''",
  'ALTER TABLE worldbook_entries ADD COLUMN vectorize INTEGER DEFAULT 0',
  "ALTER TABLE worldbook_entries ADD COLUMN tone TEXT DEFAULT ''",
  "ALTER TABLE worldbook_entries ADD COLUMN folder TEXT DEFAULT ''",
]) { try { db.exec(sql); } catch { /* column already exists */ } }

// ─────────────────────────────────────────────────────────────────────────────
// 纯小说创作板块（AI Atelier）— 与角色扮演/剧场完全独立的「人写提示词 · AI 写正文」模块。
// 设计要点（与传统大纲式写作彻底区分）：
//   · 一部小说（novels）持有：整体文风设定 style、以及「局外设定」codex。
//   · 「局外设定」codex 是永不被剧情改动的母版模板（immutable template）。
//   · 开一条「剧情线」（novel_runs）时，会把 codex「复刻」进该线的「局内设定」canon。
//   · 「局内设定」canon 是唯一真正生效、并随剧情推进被 AI 自动增补/更新的设定。
//   · 设定条目的触发方式分：always 随时常驻 / keyword 关键提示词触发 / scene 关键场合触发。
//   · 一条剧情线由若干「节拍」（novel_beats）组成：每个节拍 = 用户提示词 directive + AI 正文 content。
// 这些 JSON 字段（style/codex/canon/vars/meta）在服务端按字符串存取，读取时再 JSON.parse。
db.exec(`
CREATE TABLE IF NOT EXISTS novels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  logline TEXT DEFAULT '',          -- 一句话故事内核
  synopsis TEXT DEFAULT '',         -- 故事梗概 / 起点
  cover TEXT,
  genre TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  style TEXT DEFAULT '{}',          -- 整体文风设定（JSON）
  codex TEXT DEFAULT '[]',          -- 局外设定 · 永不可更改的母版（JSON 数组）
  pinned INTEGER DEFAULT 0,
  published INTEGER DEFAULT 0,       -- 是否发布到「书架精选」供他人阅读
  published_run_id INTEGER,         -- 发布时选定对外展示的剧情线
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS novel_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER REFERENCES novels(id) ON DELETE CASCADE,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT DEFAULT '主线',
  canon TEXT DEFAULT '[]',          -- 局内设定 · 唯一生效、随剧情自动更新（JSON 数组）
  vars TEXT DEFAULT '{}',           -- 故事世界变量（JSON）
  summary TEXT DEFAULT '',          -- 滚动剧情摘要（长篇记忆）
  words INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS novel_beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES novel_runs(id) ON DELETE CASCADE,
  seq INTEGER DEFAULT 0,
  directive TEXT DEFAULT '',        -- 用户给的提示词 / 指令
  content TEXT DEFAULT '',          -- AI 写出的正文
  meta TEXT DEFAULT '{}',           -- 本节拍命中的设定 / 标签（JSON）
  image TEXT DEFAULT '',            -- 本段配图（AI 生图，可选）
  history TEXT DEFAULT '[]',        -- 改写 / 编辑前的历史版本（JSON 数组，用于回退）
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_novel_runs_novel ON novel_runs (novel_id);
CREATE INDEX IF NOT EXISTS idx_novel_beats_run ON novel_beats (run_id, seq);

-- —— 统一日志系统 ——
-- 三端（服务端 / 桌面网页 / 移动网页 / APP）所有日志都落这一张表。
-- 设计要点：
--  1) level + source + category + event 四维分类，覆盖访问日志 / 业务审计 / 客户端崩溃 / 系统异常。
--  2) fingerprint：事件指纹（source+category+event+message 哈希），用于聚合相同错误、按指纹去重计数。
--  3) request_id：链路追踪 ID，一次 HTTP 请求内产生的所有日志共享同一个 id，便于复盘。
--  4) extra：JSON 扩展字段（堆栈 / 组件树 / 上下文），避免主表列膨胀。
--  5) 级别分级保留：debug 3d / info 7d / warn 30d / error+fatal 90d，由 logger.purgeOldLogs 定时清理。
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  level TEXT NOT NULL,                        -- debug|info|warn|error|fatal
  source TEXT NOT NULL,                       -- server | client | app
  category TEXT NOT NULL,                     -- auth|api|admin|economy|chat|character|social|dm|parliament|upload|system|client|app
  event TEXT NOT NULL,                        -- login|register|ban|crash|request|ai_call|...
  message TEXT DEFAULT '',
  user_id INTEGER,
  ip TEXT DEFAULT '',
  ua TEXT DEFAULT '',
  endpoint TEXT DEFAULT '',
  method TEXT DEFAULT '',
  status INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  extra TEXT DEFAULT '',                      -- JSON 扩展字段
  session_id TEXT DEFAULT '',                 -- 客户端会话 ID（跨页面/跨刷新保持）
  request_id TEXT DEFAULT '',                 -- 链路追踪 ID（单次 HTTP 请求内共享）
  fingerprint TEXT DEFAULT '',                -- 事件指纹（聚合去重用）
  count INTEGER DEFAULT 1                     -- 相同指纹聚合计数（同一指纹短期内合并）
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, id);
CREATE INDEX IF NOT EXISTS idx_logs_category ON logs (category, id);
CREATE INDEX IF NOT EXISTS idx_logs_source ON logs (source, id);
CREATE INDEX IF NOT EXISTS idx_logs_user ON logs (user_id, id);
CREATE INDEX IF NOT EXISTS idx_logs_fingerprint ON logs (fingerprint, id);
CREATE INDEX IF NOT EXISTS idx_logs_event ON logs (event, id);
CREATE INDEX IF NOT EXISTS idx_logs_request ON logs (request_id);
`);
// 迁移：为已有数据库补齐新列（忽略已存在）。
for (const sql of [
  'ALTER TABLE novels ADD COLUMN published INTEGER DEFAULT 0',
  'ALTER TABLE novels ADD COLUMN published_run_id INTEGER',
  "ALTER TABLE novel_beats ADD COLUMN image TEXT DEFAULT ''",
  "ALTER TABLE novel_beats ADD COLUMN history TEXT DEFAULT '[]'",
]) { try { db.exec(sql); } catch { /* column exists */ } }

// —— 性能索引：热点外键/查找列（缺失会随数据量退化为全表扫描）。逐条 try：
//    个别表/列在旧库可能尚不存在，跳过而非中断启动。——
for (const sql of [
  'CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters (owner_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_char ON conversations (character_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_favorites_char ON favorites (character_id)',
  'CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id)',
  'CREATE INDEX IF NOT EXISTS idx_dm_from ON dm_messages (from_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_dm_to ON dm_messages (to_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes (post_id)',
  'CREATE INDEX IF NOT EXISTS idx_comments_moment ON comments (moment_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews (target_type, target_id)',
  'CREATE INDEX IF NOT EXISTS idx_script_purchases_user ON script_purchases (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_script_purchases_script ON script_purchases (script_id)',
]) { try { db.exec(sql); } catch { /* 表/列可能尚不存在，忽略 */ } }

// —— post_likes 去重 + 唯一约束（与 moment_likes/favorites/script_likes 对齐，
//    DB 级防重复点赞与计数漂移）。先删历史重复行，再建唯一索引。——
try {
  db.exec('DELETE FROM post_likes WHERE id NOT IN (SELECT MIN(id) FROM post_likes GROUP BY post_id, user_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_post_likes_uniq ON post_likes (post_id, user_id)');
} catch { /* */ }

// 进程退出时把 WAL 落盘并截断，抑制 WAL 文件长期膨胀（同步操作，安全）。
process.on('exit', () => { try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* */ } });

export default db;

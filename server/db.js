import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB_PATH lets hosted deploys point at a persistent volume (e.g. a mounted disk).
const dbFile = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
  'ALTER TABLE transactions ADD COLUMN ref_owner INTEGER',
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
  // 安全相关：token 版本号（改密后旧 token 失效）
  'ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0',
]) { try { db.exec(sql); } catch { /* column already exists */ } }

// 安全相关：event_claims 加 (user_id, event_id) 唯一索引，原子防并发重复领取。
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_event_claims_uniq ON event_claims (user_id, event_id)'); } catch { /* */ }

export default db;

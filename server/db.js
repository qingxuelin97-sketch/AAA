import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'data.sqlite'));
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
  gold INTEGER DEFAULT 1000,
  diamond INTEGER DEFAULT 0,
  vip_until TEXT,
  last_checkin TEXT,
  checkin_streak INTEGER DEFAULT 0,
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
  persona TEXT DEFAULT '', voice_name TEXT DEFAULT '',
  category TEXT DEFAULT '', tags TEXT DEFAULT '',
  is_public INTEGER DEFAULT 0, nsfw INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0, uses INTEGER DEFAULT 0,
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

export default db;

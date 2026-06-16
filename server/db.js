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
  bio TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-user model / voice provider settings
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
  theme TEXT DEFAULT 'dark'
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar TEXT,
  background TEXT,          -- chat background, may be image/gif/video (dynamic)
  background_type TEXT DEFAULT 'image',
  tagline TEXT DEFAULT '', -- short intro shown on cards
  intro TEXT DEFAULT '',   -- full character bio / 简介
  greeting TEXT DEFAULT '',
  persona TEXT DEFAULT '', -- system persona / definition
  voice_name TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  is_public INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  uses INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- World book entries belong to a character
CREATE TABLE IF NOT EXISTS world_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  keys TEXT DEFAULT '',     -- comma separated trigger keywords
  content TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,       -- user | assistant | system
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Community posts: shared scripts / character cards on homepage
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'card',  -- card | script
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  cover TEXT,
  character_id INTEGER,      -- optional linked character (for cards)
  payload TEXT DEFAULT '',   -- JSON snapshot of the card/script for import
  tags TEXT DEFAULT '',
  likes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

-- "Push to other players" — directed shares that land in a user's inbox
CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  from_user INTEGER REFERENCES users(id) ON DELETE CASCADE,
  to_user INTEGER REFERENCES users(id) ON DELETE CASCADE,
  note TEXT DEFAULT '',
  seen INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

export default db;

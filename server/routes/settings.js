import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

const PUBLIC_FIELDS = [
  'llm_provider', 'llm_base_url', 'llm_model', 'llm_temperature', 'llm_max_tokens',
  'voice_provider', 'voice_base_url', 'voice_model', 'voice_name', 'theme'
];

function publicSettings(row) {
  const out = {};
  for (const f of PUBLIC_FIELDS) out[f] = row[f];
  // never expose raw keys — only whether they are set
  out.llm_api_key_set = !!row.llm_api_key;
  out.voice_api_key_set = !!row.voice_api_key;
  return out;
}

router.get('/', authRequired, (req, res) => {
  let row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  if (!row) {
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(req.user.id);
    row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  }
  res.json({ settings: publicSettings(row) });
});

router.put('/', authRequired, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
  const next = {
    user_id: req.user.id,
    llm_provider: b.llm_provider ?? cur.llm_provider,
    llm_base_url: b.llm_base_url ?? cur.llm_base_url,
    // empty string means "leave unchanged" so we never wipe a saved key by accident
    llm_api_key: (b.llm_api_key === undefined || b.llm_api_key === '') ? cur.llm_api_key : b.llm_api_key,
    llm_model: b.llm_model ?? cur.llm_model,
    llm_temperature: b.llm_temperature ?? cur.llm_temperature,
    llm_max_tokens: b.llm_max_tokens ?? cur.llm_max_tokens,
    voice_provider: b.voice_provider ?? cur.voice_provider,
    voice_base_url: b.voice_base_url ?? cur.voice_base_url,
    voice_api_key: (b.voice_api_key === undefined || b.voice_api_key === '') ? cur.voice_api_key : b.voice_api_key,
    voice_model: b.voice_model ?? cur.voice_model,
    voice_name: b.voice_name ?? cur.voice_name,
    theme: b.theme ?? cur.theme
  };
  db.prepare(`UPDATE settings SET
    llm_provider=@llm_provider, llm_base_url=@llm_base_url, llm_api_key=@llm_api_key, llm_model=@llm_model,
    llm_temperature=@llm_temperature, llm_max_tokens=@llm_max_tokens,
    voice_provider=@voice_provider, voice_base_url=@voice_base_url, voice_api_key=@voice_api_key,
    voice_model=@voice_model, voice_name=@voice_name, theme=@theme WHERE user_id=@user_id`).run(next);
  res.json({ settings: publicSettings(next) });
});

export default router;

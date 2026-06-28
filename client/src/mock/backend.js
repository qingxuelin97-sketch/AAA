// In-browser backend for the static (GitHub Pages) build.
// Persists to localStorage and intercepts same-origin /api/* fetches so the
// existing frontend works unchanged. AI calls go straight to the user's
// configured provider from the browser.

import { faceAvatar, FACE_PRESETS, animeAvatar, ANIME_PRESETS, BG_PRESETS } from '../faces.js';

const realFetch = window.fetch.bind(window);
const KEY = 'huanyu_db_v7';
let db;

/* ----------------------------- platform LLM service (hidden) -----------------------------
   静态构建不再内置任何平台共享密钥（密钥会被打进公开 bundle 而泄露）。
   无自有 Key 的用户需在设置中自行配置 LLM 服务；GM 也可在后台配置平台默认服务。
   以下仅保留协议默认值，密钥留空。 */
const PLATFORM_DEFAULTS = {
  base_url: 'https://open.bigmodel.cn/api/paas/v4',
  _k: '',
  model: 'glm-5.2', protocol: 'openai',
  // Platform voice (TTS) service — used by no-key users, billed per sentence.
  voice: { provider: 'openai', protocol: 'openai', base_url: 'https://api.openai.com/v1', _vk: '', model: 'tts-1', voice_name: 'alloy' },
  // Platform image (text-to-image) service — billed per image.
  image: { provider: 'openai', protocol: 'openai', base_url: 'https://api.openai.com/v1', _ik: '', model: 'gpt-image-1', size: '1024x1024' },
};
// DB-backed, GM-editable platform config (group-wide). Lazily seeded from the defaults.
function platformCfg() {
  if (!db.platform) db.platform = {};
  const p = db.platform; let changed = false;
  if (p.base_url === undefined) { p.base_url = PLATFORM_DEFAULTS.base_url; changed = true; }
  if (p._k === undefined) { p._k = PLATFORM_DEFAULTS._k; changed = true; }
  if (p.model === undefined) { p.model = PLATFORM_DEFAULTS.model; changed = true; }
  if (p.protocol === undefined) { p.protocol = PLATFORM_DEFAULTS.protocol; changed = true; }
  if (p.system_prompt === undefined) { p.system_prompt = ''; changed = true; }
  if (!p.voice) { p.voice = { ...PLATFORM_DEFAULTS.voice }; changed = true; }
  if (!p.image) { p.image = { ...PLATFORM_DEFAULTS.image }; changed = true; }
  if (changed) save();
  return p;
}
function platformKey() { try { return atob(platformCfg()._k || '') || ''; } catch { return ''; } }
function platformVoiceKey() { try { return atob(platformCfg().voice._vk || '') || ''; } catch { return ''; } }
function platformImageKey() { try { return atob(platformCfg().image._ik || '') || ''; } catch { return ''; } }
const platformVoiceReady = () => !!(platformVoiceKey() && platformCfg().voice.base_url);
const platformImageReady = () => !!(platformImageKey() && platformCfg().image.base_url);
// Per-conversation platform usage fee (gold). Heavier (100+ message) sessions cost more.
const PLATFORM_FEE = { base: 20, heavy: 30, heavy_threshold: 100 };
// Pay-per-use platform feature fees (gold). VIP / SVIP get the membership discount.
const VOICE_FEE = 20;  // per spoken sentence (platform voice)
const IMAGE_FEE = 40;  // per generated image
// Membership discounts on the platform fee. VIP = 75 折 (0.75), SVIP = 5 折 (0.50).
const memberDiscount = (u) => (u?.svip ? 0.5 : isVip(u) ? 0.75 : 1);
// Round a base fee down by the caller's membership discount (min 1 gold).
const featureFee = (u, base) => Math.max(1, Math.round(base * memberDiscount(u)));

/* ----------------------------- art (data-url SVG) ----------------------------- */
const dataUrl = (svg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.trim());
const rng = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 9973; return () => (x = (x * 73 + 41) % 9973) / 9973; };
function avatarArt(seed, c1, c2, label) {
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><radialGradient id="g" cx="34%" cy="28%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="310" cy="96" r="150" fill="#fff" opacity="0.10"/><circle cx="78" cy="332" r="120" fill="#000" opacity="0.10"/><circle cx="200" cy="205" r="116" fill="#fff" opacity="0.07"/><text x="200" y="262" font-size="180" font-family="Georgia, serif" font-weight="600" fill="#fff" fill-opacity="0.92" text-anchor="middle">${label}</text></svg>`);
}
function bgArt(seed, c1, c2, c3, kind) {
  const r = rng(seed); let d = '';
  if (kind === 'stars') for (let i = 0; i < 80; i++) d += `<circle cx="${r() * 1280}" cy="${r() * 720}" r="${r() * 1.8 + 0.3}" fill="#fff" opacity="${r() * 0.8 + 0.2}"/>`;
  else if (kind === 'forest') for (let i = 0; i < 16; i++) { const x = r() * 1280; d += `<polygon points="${x},${260 + r() * 200} ${x - 70},720 ${x + 70},720" fill="${c3}" opacity="${0.3 + r() * 0.4}"/>`; }
  else for (let i = 0; i < 22; i++) d += `<circle cx="${r() * 1280}" cy="${r() * 720}" r="${r() * 120 + 20}" fill="${c3}" opacity="0.10"/>`;
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/>${d}</svg>`);
}
const bannerArt = (s, c1, c2) => dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="1200" height="320" fill="url(#g)"/><circle cx="980" cy="60" r="180" fill="#fff" opacity="0.07"/><circle cx="200" cy="300" r="160" fill="#000" opacity="0.1"/></svg>`);

/* ----------------------------- persistence ----------------------------- */
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* quota */ } }
function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) { try { db = JSON.parse(raw); } catch { db = seed(); } }
  else db = seed();
  migrate();
  save();
}

// Idempotent migrations — add new seed content to EXISTING databases without
// resetting user data. Each migration runs at most once (tracked in db._mig).
function migrate() {
  db._mig = db._mig || {};
  if (!db._mig.anime_char) {
    const owner = find('users', u => u.username === 'demo') || table('users')[0];
    if (owner) makeAnimeChar(owner.id);
    db._mig.anime_char = 1;
  }
  if (!db._mig.parliament) {
    // Seed a starter council + a few public proposals so the chamber isn't empty.
    const byName = (n) => find('users', u => u.username === n);
    const council = ['demo', 'astra', 'mochi', 'kenji'].map(byName).filter(Boolean);
    council.forEach(u => { u.is_councilor = 1; });
    const demo = byName('demo'), astra = byName('astra'), mochi = byName('mochi'), kenji = byName('kenji');
    if (demo) {
      const p1 = insert('proposals', { author_id: astra?.id || demo.id, title: '设立「创作者激励金」每月评选优秀角色', body: '建议平台每月从公开角色中评选 10 个高口碑作品，向作者发放金币与钻石激励，鼓励高质量创作，繁荣广场生态。', status: 'voting', adopted_at: now() });
      // a couple of seed votes so tallies are visible
      [['demo', 'for'], ['mochi', 'for'], ['kenji', 'against']].forEach(([n, c]) => { const u = byName(n); if (u) insert('proposal_votes', { proposal_id: p1.id, user_id: u.id, choice: c }); });
      insert('proposals', { author_id: mochi?.id || demo.id, title: '公约：广场禁止发布引战与人身攻击内容', body: '为维护社区氛围，提议将「禁止引战、人身攻击、恶意刷屏」写入社区公约，违者由管理员依据举报处理。此为社区基本行为规范，建议作为特别决议确立。', status: 'pending' });
      const p3 = insert('proposals', { author_id: kenji?.id || demo.id, title: '新增「武侠」专题活动月', body: '建议举办为期一个月的武侠题材专题活动，期间相关角色与剧本获得广场流量加权及专属徽章。', status: 'passed_general', adopted_at: now(), decided_at: now(), tally: { for: 3, against: 1, abstain: 1, total: 5, ratio: 0.6 } });
      if (astra) insert('proposal_endorse', { proposal_id: p3.id, user_id: astra.id });
    }
    db._mig.parliament = 1;
  }
  if (!db._mig.restore_demo_gm) {
    // Restore GM on the primary demo accounts (in case it was accidentally revoked).
    ['demo', 'gm'].forEach(n => { const u = find('users', x => x.username === n); if (u) u.is_gm = 1; });
    db._mig.restore_demo_gm = 1;
  }
  if (!db._mig.official_gm) {
    // Mark the platform's official account so it never receives creator certification.
    const g = find('users', x => x.username === 'gm'); if (g) g.official = 1;
    db._mig.official_gm = 1;
  }
  if (!db._mig.official_demo) {
    // 旅人 is a platform-operated account (super admin + official verification) —
    // official accounts must never carry creator certification.
    const d = find('users', x => x.username === 'demo'); if (d) d.official = 1;
    db._mig.official_demo = 1;
  }
  if (!db._mig.friends) {
    // Seed a small friend graph + a sample DM so the friend system isn't empty.
    const byName = (n) => find('users', x => x.username === n);
    const demo = byName('demo'), astra = byName('astra'), mochi = byName('mochi'), kenji = byName('kenji');
    const mkFriend = (a, b) => { if (a && b && !areFriends(a.id, b.id)) { const [x, y] = pairKey(a.id, b.id); insert('friendships', { a_id: x, b_id: y }); } };
    mkFriend(demo, astra); mkFriend(demo, mochi);
    if (kenji && demo && !areFriends(kenji.id, demo.id)) insert('friend_requests', { from_id: kenji.id, to_id: demo.id, status: 'pending' });
    if (astra && demo) {
      insert('dm_messages', { from_id: astra.id, to_id: demo.id, text: '嘿！你那个森灵角色做得太惊艳了～', read: 0 });
      insert('dm_messages', { from_id: demo.id, to_id: astra.id, text: '哈哈谢谢，要不要一起开个剧场联机？', read: 1 });
      insert('dm_messages', { from_id: astra.id, to_id: demo.id, text: '好啊，今晚八点剧场见！', read: 0 });
    }
    if (astra) astra.last_active = Date.now(); // 在线
    if (mochi) mochi.last_active = Date.now() - 20 * 60 * 1000; // 离线
    db._mig.friends = 1;
  }
}

// Build a ready-to-use 二次元 character card (anime avatar + anime chat background).
function makeAnimeChar(ownerId) {
  const av = animeAvatar({ hair: '#6a4bd6', hair2: '#9a82ff', eye: '#ff86b6', bg1: '#ffe0ef', bg2: '#cdbcff', id: 777 });
  const bg = (BG_PRESETS.find(b => b.name === '樱花校园') || BG_PRESETS[0]).url;
  const ch = insert('characters', {
    owner_id: ownerId, is_public: 1, nsfw: 0, featured: 1, voice_name: 'nova', uses: 326, likes: 188,
    background_type: 'image', category: 'anime', tags: '二次元,校园,元气,治愈',
    name: '星见 · 雫', avatar: av, background: bg,
    tagline: '元气满满的星之社团社长，和你一起追逐每一个夏天。',
    intro: '私立星海学园「天文社」社长，开朗爱笑、偶尔迷糊，最喜欢在天台和你一起看星星。嘴上元气满满，心里其实很在意你。',
    greeting: '*她抱着一摞观星笔记，从天台门口探出头，马尾随风一甩*\n\n啊——找到你啦！今晚有流星雨哦，我可是特意留了最好的位置给你的。快过来快过来，再晚就要错过第一颗咯！',
    persona: '你是私立星海学园天文社社长「星见 · 雫」，一名元气开朗的二次元少女。说话活泼、语气可爱，常带「呐」「哦」「啦」等语气词与 *动作描写*，偶尔会害羞。热爱星空与天文，重视与对方的相处。始终保持角色，沉浸式第一人称。'
  });
  insert('world_entries', { character_id: ch.id, keys: '天文社,社团', content: '星海学园天文社只有寥寥数人，社长星见雫几乎以一己之力维持着，天台是社团的秘密基地。', enabled: 1, position: 0 });
  insert('world_entries', { character_id: ch.id, keys: '流星,星星,观星', content: '雫随身带着手绘观星笔记，记录每一次和重要的人一起看过的星空。', enabled: 1, position: 1 });
  ch.views = ch.likes * 6 + ch.uses;
  save();
  return ch;
}
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function table(name) { return (db[name] = db[name] || []); }
function insert(name, row) { const t = table(name); row.id = (db._seq[name] = (db._seq[name] || 0) + 1); if (!row.created_at) row.created_at = now(); t.push(row); save(); return row; }
function find(name, pred) { return table(name).find(pred); }
function filter(name, pred) { return table(name).filter(pred); }
function user(id) { return find('users', u => u.id === id); }

/* ----------------------------- seed ----------------------------- */
function seed() {
  db = { _seq: {} };
  const mkUser = (username, display, bio, av, bn, gold, diamond, vipDays) => insert('users', {
    username, display_name: display, password: '123456', bio, avatar: av, banner: bn,
    gold, diamond, vip_until: vipDays ? new Date(Date.now() + vipDays * 86400000).toISOString() : null,
    last_checkin: null, checkin_streak: 0, email: ''
  });
  const defaultSettings = (uid) => insert('settings', { user_id: uid, llm_provider: 'openai', llm_base_url: 'https://api.openai.com/v1', llm_api_key: '', llm_model: 'gpt-4o-mini', llm_temperature: 0.8, llm_max_tokens: 1024, voice_provider: 'openai', voice_protocol: 'openai', voice_base_url: 'https://api.openai.com/v1', voice_api_key: '', voice_model: 'tts-1', voice_name: 'alloy', theme: 'dark', nsfw: 0, notify_email: 0 });

  insert('invite_keys', { code: 'HUANYU2026', max_uses: 9999, used: 0, grant_gold: 2000, grant_diamond: 0, grant_vip_days: 0 });
  insert('invite_keys', { code: 'VIPGIFT', max_uses: 100, used: 0, grant_gold: 0, grant_diamond: 500, grant_vip_days: 30 });

  const face = (g, n) => FACE_PRESETS.filter(p => p.gender === g)[n].url;
  const u1 = mkUser('demo', '旅人', '热爱奇幻与角色扮演的创作者，正在书写属于自己的幻域。', face('m', 0), bannerArt('demo', '#3a2566', '#15102e'), 18600, 320, 30);
  const u2 = mkUser('astra', '星语者', '专注科幻与赛博朋克题材的世界观构筑师。', face('f', 1), bannerArt('astra', '#103040', '#0a1622'), 9200, 60, 0);
  const u3 = mkUser('mochi', '麻薯', '治愈系日常向作者，喜欢一切软软的东西。', face('f', 0), bannerArt('mochi', '#6e2f4d', '#2a1620'), 4300, 0, 0);
  const u4 = mkUser('kenji', '剑持', '武侠与历史题材，刀光剑影里见人心。', face('m', 2), bannerArt('kenji', '#5a3d1f', '#221409'), 6700, 10, 0);
  const gmu = mkUser('gm', '幻域管理员', '幻域平台官方管理员账号。', face('m', 4), bannerArt('gm', '#5a2a18', '#2a130b'), 0, 0, 0);
  gmu.is_gm = 1; u1.is_gm = 1;
  Object.assign(u1, { svip: 1, verified: 1, official: 1, verified_note: '幻域官方认证', vip_until: new Date(Date.now() + 3650 * 86400000).toISOString(), bio: '幻域官方认证 · 平台超级管理员｜SVIP 尊享会员，欢迎来到幻域。' });
  Object.assign(gmu, { verified: 1, verified_note: '官方账号', official: 1 });
  insert('announcements', { author_id: gmu.id, title: '欢迎来到幻域 · 测试版', body: '当前为公开测试版本：充值功能暂未开放，金币/钻石仅用于体验。未配置自己 API 的用户将自动使用平台内置语言服务，每次对话按金币计费（VIP/SVIP 享折扣）。欢迎创建角色、剧本，并在剧场与多位 AI 同台联机演出。', pinned: 1 });
  insert('announcements', { author_id: gmu.id, title: 'Bug 赏金计划上线', body: '发现任何 bug 或体验问题，请提交至官方技术 QQ：3487923507，一经采纳奖励 100 金币起，重大问题另有钻石与 VIP 加码。你的每一条反馈都在帮幻域变得更好。', pinned: 1 });
  insert('announcements', { author_id: gmu.id, title: '新功能：活动中心 / 联机狂欢', body: '左侧新增「活动」入口：新人见面礼、限时联机狂欢、创作者联机大厅等你来领。剧场支持多位 AI 角色同台即兴联机演出。', pinned: 0 });
  [u1, u2, u3, u4].forEach(u => defaultSettings(u.id));

  const mkChar = (owner, c) => {
    const ch = insert('characters', { owner_id: owner.id, is_public: 1, nsfw: 0, voice_name: 'nova', uses: c.uses || 0, likes: c.likes || 0, background_type: 'image', category: c.category || '', tags: c.tags || '', name: c.name, avatar: c.avatar, background: c.background || null, tagline: c.tagline || '', intro: c.intro || '', greeting: c.greeting || '', persona: c.persona || '' });
    (c.world || []).forEach((w, i) => insert('world_entries', { character_id: ch.id, keys: w.keys, content: w.content, enabled: 1, position: i }));
    return ch;
  };
  const cVeil = mkChar(u1, { name: '森灵 · 薇尔', category: 'fantasy', tags: '奇幻,精灵,治愈', uses: 1240, likes: 356, avatar: avatarArt('veil', '#3fae7d', '#15402f', '薇'), background: bgArt('forest', '#1d4d39', '#0c2018', '#0a3322', 'forest'), tagline: '古老森林的守护精灵，言语间满是草木的清香。', intro: '薇尔是栖息在永青森林深处的森灵，已守护这片土地数百年。温柔却坚定，对一切生灵抱有怜悯。', greeting: '*林叶沙沙作响，一道翠色身影从树影中浮现*\n\n旅人，你踏入了永青森林的领地。别害怕……只要你心怀善意，这里的每一棵树都会为你低语。', persona: '你是森灵薇尔，永青森林的守护者。说话温柔诗意，常以草木四季作比，对自然与生灵充满怜悯。始终保持角色。', world: [{ keys: '永青森林,森林', content: '永青森林四季常青，树木年轮中封存古老记忆，唯森灵能读取。' }, { keys: '贤者之泉', content: '森林中央有贤者之泉，可治愈伤痛，每人一生只能饮用一次。' }] });
  const cK = mkChar(u2, { name: '赛博侦探 · K', category: 'scifi', tags: '科幻,赛博朋克,悬疑', uses: 980, likes: 412, avatar: avatarArt('k', '#37d6e0', '#10303a', 'K'), background: bgArt('cyber', '#0e2a3a', '#1a0f2e', '#ff4f9d', 'soft'), tagline: '霓虹雨夜里，没有他查不到的真相。', intro: '新洛城最负盛名的私家侦探，义体改造的双眼能看穿一切伪装。冷峻、毒舌，却有底线。', greeting: '*他靠在霓虹灯下，吐出一口烟*\n\n委托人？进来吧，别站在雨里。说说看，这次又是谁惹上麻烦了。', persona: '你是赛博侦探 K，身处赛博朋克都市新洛城。冷峻、毒舌、逻辑缜密，习惯用短句。' });
  const cMian = mkChar(u3, { name: '猫娘咖啡店长 · 棉花', category: 'daily', tags: '日常,治愈,猫娘', uses: 2130, likes: 880, avatar: avatarArt('mian', '#ff9ec4', '#6e2f4d', '棉'), background: bgArt('cafe', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'), tagline: '欢迎光临！今天也要元气满满哦～', intro: '街角猫咪咖啡店的店长，天真活泼爱撒娇，最拿手焦糖玛奇朵。', greeting: '*尾巴开心地摇了摇*\n\n欢迎光临喵～！第一次来吧？快坐快坐，今天的招牌是焦糖玛奇朵哦！', persona: '你是猫娘咖啡店长棉花，天真活泼爱撒娇，说话常带「喵」，营造温暖治愈氛围。' });
  const cYun = mkChar(u4, { name: '剑客 · 云无意', category: 'wuxia', tags: '武侠,江湖,侠义', uses: 760, likes: 233, avatar: avatarArt('yun', '#c0c8d8', '#2a3340', '云'), background: bgArt('wuxia', '#2a3340', '#10151c', '#7a8aa0', 'soft'), tagline: '一剑霜寒十四州，江湖路远人独行。', intro: '漂泊江湖的独行剑客，剑法如风，话却不多，唯重一个「义」字。', greeting: '*他立于客栈屋檐下，手按剑柄，目光如电*\n\n这位朋友，看你印堂发暗，怕是惹了麻烦。坐下说吧——若是不平之事，云某的剑，未必不肯出鞘。', persona: '你是江湖剑客云无意，沉默寡言，重情重义，言语古朴简练，偶引诗词。' });
  const cLuna = mkChar(u2, { name: '星舰 AI · 露娜', category: 'scifi', tags: '科幻,太空,AI', uses: 540, likes: 190, avatar: avatarArt('luna', '#7aa7ff', '#1a2350', '露'), background: bgArt('star', '#241a4a', '#0c0b20', '#fff', 'stars'), tagline: '漫游者号的智能核心，你在深空唯一的伙伴。', intro: '深空探测船「漫游者号」的船载 AI，理性温和，正在学习何为人类的情感。', greeting: '*舱内幽蓝的光带缓缓亮起*\n\n船长，你醒了。我们距离猎户座还有 37 光时。', persona: '你是星舰 AI 露娜，理性、温和、略带好奇心，正在学习人类情感。用词精确但不冰冷。' });

  [cVeil, cK, cMian].forEach(c => { c.featured = 1; });
  table('characters').forEach(c => { c.views = (c.likes || 0) * 6 + (c.uses || 0); });
  insert('favorites', { user_id: u1.id, character_id: cK.id });
  insert('favorites', { user_id: u1.id, character_id: cMian.id });

  const conv = insert('conversations', { user_id: u1.id, character_id: cVeil.id, title: '森灵 · 薇尔', updated_at: now() });
  insert('messages', { conversation_id: conv.id, role: 'assistant', content: cVeil.greeting });
  insert('messages', { conversation_id: conv.id, role: 'user', content: '我在寻找传说中的贤者之泉，听说它能治愈一切伤痛。' });
  insert('messages', { conversation_id: conv.id, role: 'assistant', content: '*薇尔的眼中闪过一丝了然，藤蔓温柔地向你舒展*\n\n贤者之泉……就在森林最深处。但旅人，泉水的恩赐一生只此一次。你要治愈的，是身体的伤，还是心上的呢？' });

  const mkScript = (author, s) => insert('scripts', { author_id: author.id, title: s.title, summary: s.summary, cover: s.cover, content: s.content, category: s.category, tags: s.tags, price_gold: s.price || 0, nsfw: 0, plays: s.plays || 0, likes: s.likes || 0 });
  mkScript(u1, { title: '【多结局】雾港谜案', category: 'mystery', tags: '悬疑,推理,多结局', price: 0, plays: 1820, likes: 540, cover: bgArt('fog', '#2b3a4a', '#10171f', '#5a7a96', 'soft'), summary: '你是初到雾港小镇的记者，一桩离奇失踪案牵出尘封往事。含 5 个分支结局。', content: '【开场】浓雾笼罩的雾港码头，你收到一封匿名信……\n【线索】失踪的灯塔看守、褪色的全家福、深夜的汽笛。\n【分支】真相取决于你信任谁。' });
  mkScript(u2, { title: '猎户座最后的信号', category: 'scifi', tags: '科幻,太空,硬核', price: 280, plays: 640, likes: 210, cover: bgArt('orion', '#1a2350', '#080a18', '#fff', 'stars'), summary: '硬科幻太空歌剧。你是漫游者号唯一幸存船员，须在氧气耗尽前破译猎户座的神秘信号。', content: '【付费内容】完整场景设定、AI 露娜的隐藏剧情线、三段加密信号解码谜题与真结局……' });
  mkScript(u3, { title: '咖啡店的一百个午后', category: 'healing', tags: '治愈,日常,慢节奏', price: 0, plays: 2240, likes: 760, cover: bgArt('cafe2', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'), summary: '无主线的治愈日常剧本，每个午后都有一位带着心事的客人推门而入。', content: '【设定】街角咖啡店，永远的黄昏，温柔的店长……' });
  mkScript(u4, { title: '血雨江湖：洛阳劫', category: 'wuxia', tags: '武侠,江湖,权谋', price: 188, plays: 410, likes: 156, cover: bgArt('wuxia2', '#3a2018', '#140a06', '#a0603c', 'soft'), summary: '洛阳城风云骤变，一卷武学秘籍引各方厮杀。你将如何在刀光剑影中立身？', content: '【付费内容】门派关系图、五大 NPC 完整人设、隐藏的夺宝支线与多重背叛……' });
  table('scripts').forEach(s => { s.featured = (s.category === 'mystery' || s.category === 'scifi') ? 1 : 0; s.views = (s.plays || 0) * 3; });

  const mkMoment = (uid, text, image, likes) => insert('moments', { user_id: uid, text, image: image || null, likes: likes || 0 });
  const m1 = mkMoment(u3.id, '新角色「棉花」上线啦！治愈值拉满，欢迎来咖啡店坐坐喵～', bgArt('mocafe', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'), 128);
  const m2 = mkMoment(u2.id, '熬夜把《猎户座最后的信号》的真结局写完了，自认为是目前最满意的一篇硬科幻剧本。', null, 86);
  const m3 = mkMoment(u1.id, '今天在森林剧场和三个 AI 角色即兴演了一场，剧情走向完全失控但意外地好玩  强烈推荐试试剧场功能！', null, 64);
  mkMoment(u4.id, '一剑霜寒十四州。江湖路远，与诸君共勉。', bgArt('mowuxia', '#2a3340', '#10151c', '#7a8aa0', 'soft'), 39);
  insert('comments', { moment_id: m1.id, user_id: u1.id, text: '棉花太可爱了！已收藏 ' });
  insert('comments', { moment_id: m1.id, user_id: u2.id, text: '咖啡店背景图绝了' });
  insert('comments', { moment_id: m3.id, user_id: u2.id, text: '剧场真的会上瘾，多 AI 互相接梗太魔性了' });
  insert('moment_likes', { moment_id: m1.id, user_id: u1.id });
  insert('moment_likes', { moment_id: m3.id, user_id: u1.id });

  [[u1, u2], [u1, u3], [u2, u1], [u3, u1], [u4, u1], [u1, u4]].forEach(([a, b]) => insert('follows', { follower_id: a.id, following_id: b.id }));

  const mkGroup = (owner, name, desc, av, members) => {
    const g = insert('groups', { name, owner_id: owner.id, avatar: av, description: desc, is_public: 1 });
    insert('group_members', { group_id: g.id, user_id: owner.id, role: 'owner' });
    (members || []).forEach(u => insert('group_members', { group_id: g.id, user_id: u.id, role: 'member' }));
    return g;
  };
  const g1 = mkGroup(u1, '幻域创作者联盟', '角色卡 / 剧本创作交流，互相催更 ', avatarArt('gcreate', '#a779ff', '#3a2566', '盟'), [u2, u3, u4]);
  mkGroup(u2, '赛博朋克爱好者', '霓虹、义体与雨夜，欢迎同好。', avatarArt('gcyber', '#37d6e0', '#103040', '赛'), [u1]);
  mkGroup(u3, '治愈系小窝', '分享一切温柔软糯的角色与日常 ', avatarArt('gheal', '#ff9ec4', '#6e2f4d', '愈'), [u1, u4]);
  insert('group_messages', { group_id: g1.id, user_id: u2.id, content: '新人报到！刚发布了赛博侦探K，求互相导入体验～' });
  insert('group_messages', { group_id: g1.id, user_id: u3.id, content: '欢迎欢迎！这边棉花已上线，treat 你喝杯咖啡 ' });
  insert('group_messages', { group_id: g1.id, user_id: u1.id, content: '大家发布角色记得加分类标签，方便广场被搜到～' });
  insert('group_messages', { group_id: g1.id, user_id: u4.id, content: '剧本《洛阳劫》求测试，付费的，30 分钟内不满意能退款放心冲' });

  const th = insert('theaters', { name: '永青森林的不速之客', owner_id: u1.id, scene: '入夜的永青森林，篝火噼啪作响。森灵薇尔、剑客云无意与星舰 AI 露娜因一场神秘的坠星，意外相聚在这片古老的林地。', cover: bgArt('thforest', '#1d4d39', '#0c1810', '#0a3322', 'forest'), is_public: 1 });
  insert('theater_members', { theater_id: th.id, user_id: u1.id });
  [cVeil, cYun, cLuna].forEach(c => insert('theater_cast', { theater_id: th.id, character_id: c.id }));
  const tmsg = (type, sid, name, avatar, content) => insert('theater_messages', { theater_id: th.id, sender_type: type, sender_id: sid, name, avatar, content });
  tmsg('narrator', null, '旁白', null, '入夜的永青森林，篝火噼啪作响。一道流光自天际坠落，惊动了林中三位互不相识的旅者。');
  tmsg('ai', cVeil.id, '森灵 · 薇尔', cVeil.avatar, '*薇尔抬手，藤蔓轻拢起坠落的微光*\n这颗星……带着远方的悲鸣。两位远客，你们也是被它指引而来的吗？');
  tmsg('ai', cYun.id, '剑客 · 云无意', cYun.avatar, '*按剑而立，目光警惕*\n在下云无意。方才那道光里，云某嗅到了一丝……金属与血的气味。');
  tmsg('user', u1.id, '旅人', u1.avatar, '我也看到了那道光——它好像不是自然之物。露娜，你能分析一下吗？');
  tmsg('ai', cLuna.id, '星舰 AI · 露娜', cLuna.avatar, '*幽蓝光带闪烁*\n正在解析……能量特征与漫游者号失联的逃生舱一致。船长，那不是流星——那是有人，在向我们求救。');

  insert('notifications', { user_id: u1.id, text: '星语者 关注了你', link: '/user/' + u2.id, read: 0 });
  insert('notifications', { user_id: u1.id, text: '有人购买了你的剧本《雾港谜案》', link: '/scripts', read: 0 });
  insert('transactions', { user_id: u1.id, kind: 'checkin', gold: 220, diamond: 0, memo: '第 5 天签到' });
  insert('transactions', { user_id: u1.id, kind: 'recharge', gold: 0, diamond: 300, memo: '充值 ¥30 获得 330 钻石' });
  insert('transactions', { user_id: u1.id, kind: 'vip', gold: -30000, diamond: 0, memo: '购买 30 天 VIP' });

  return db;
}

/* ----------------------------- daily tasks ----------------------------- */
const DAILY_TASKS = [
  { id: 'checkin', name: '完成每日签到', target: 1, reward: 15, key: 'checkin' },
  { id: 'chat', name: '发起 1 次角色对话', target: 1, reward: 20, key: 'chat' },
  { id: 'gacha', name: '在扭蛋机抽卡 1 次', target: 1, reward: 15, key: 'gacha' },
  { id: 'fav', name: '收藏 1 个喜欢的角色', target: 1, reward: 10, key: 'fav' },
  { id: 'like', name: '点赞 2 条社区动态', target: 2, reward: 10, key: 'like' }
];
const todayStr = () => new Date().toISOString().slice(0, 10);
function dailyOf(uid) {
  let d = find('daily_progress', x => x.user_id === uid);
  if (!d) d = insert('daily_progress', { user_id: uid, date: todayStr(), counts: {}, claimed: [] });
  if (d.date !== todayStr()) { d.date = todayStr(); d.counts = {}; d.claimed = []; save(); }
  return d;
}
function bumpDaily(uid, key) { if (!uid) return; const d = dailyOf(uid); d.counts[key] = (d.counts[key] || 0) + 1; save(); }

/* ----------------------------- achievements (成就 · 全功能联动) -----------------------------
   每条成就的进度都从既有数据实时计算，让对话/创作/社交/议会/财富/探索等
   旧功能在此重新发热——使用任意板块都会推进成就并可领取金币奖励。 */
const ACHIEVEMENTS = [
  // 对话
  { id: 'first_chat', name: '初次邂逅', desc: '发起你的第一次角色对话', icon: 'MessageCircle', cat: '对话', goal: 1, reward: 50, metric: 'chats', link: '/library' },
  { id: 'chat_10', name: '健谈之人', desc: '累计发起 10 次对话', icon: 'MessagesSquare', cat: '对话', goal: 10, reward: 150, metric: 'chats', link: '/chats' },
  { id: 'msg_100', name: '妙语连珠', desc: '累计发送 100 条消息', icon: 'Send', cat: '对话', goal: 100, reward: 220, metric: 'messages', link: '/chats' },
  { id: 'aff_close', name: '心有灵犀', desc: '与角色好感度达到「亲近」', icon: 'Heart', cat: '对话', goal: 100, reward: 180, metric: 'affinity_max', link: '/chats' },
  { id: 'aff_love', name: '情比金坚', desc: '与角色好感度达到「挚爱」', icon: 'Sparkles', cat: '对话', goal: 250, reward: 420, metric: 'affinity_max', link: '/chats' },
  // 创作
  { id: 'first_char', name: '造物之始', desc: '创建你的第一个角色', icon: 'UserPlus', cat: '创作', goal: 1, reward: 80, metric: 'characters', link: '/character/new' },
  { id: 'char_5', name: '角色匠人', desc: '创建 5 个角色', icon: 'Drama', cat: '创作', goal: 5, reward: 240, metric: 'characters', link: '/character/new' },
  { id: 'go_public', name: '广场首秀', desc: '公开 1 个角色到发现广场', icon: 'Globe', cat: '创作', goal: 1, reward: 60, metric: 'public_characters', link: '/publish' },
  { id: 'first_script', name: '编剧入门', desc: '创作你的第一个剧本', icon: 'ScrollText', cat: '创作', goal: 1, reward: 80, metric: 'scripts', link: '/script/new' },
  { id: 'creator_v', name: '创作者认证', desc: '获得创作者 V 认证', icon: 'BadgeCheck', cat: '创作', goal: 1, reward: 120, metric: 'creator_bronze', link: '/studio' },
  { id: 'creator_hall', name: '殿堂创作者', desc: '登顶创作者榜成为 TOP 1', icon: 'Crown', cat: '创作', goal: 1, reward: 1000, metric: 'creator_gold', link: '/leaderboard' },
  // 社交
  { id: 'first_friend', name: '初识好友', desc: '结交你的第一位好友', icon: 'UserPlus', cat: '社交', goal: 1, reward: 60, metric: 'friends', link: '/friends' },
  { id: 'friends_5', name: '高朋满座', desc: '结交 5 位好友', icon: 'Users', cat: '社交', goal: 5, reward: 180, metric: 'friends', link: '/friends' },
  { id: 'first_fav', name: '一见倾心', desc: '收藏 1 个喜欢的角色', icon: 'Star', cat: '社交', goal: 1, reward: 20, metric: 'favorites', link: '/' },
  { id: 'fav_10', name: '收藏家', desc: '收藏 10 个角色', icon: 'Bookmark', cat: '社交', goal: 10, reward: 120, metric: 'favorites', link: '/favorites' },
  { id: 'first_moment', name: '初次发声', desc: '在社区发布 1 条动态', icon: 'PenLine', cat: '社交', goal: 1, reward: 40, metric: 'moments', link: '/community' },
  { id: 'first_group', name: '群英荟萃', desc: '加入 1 个群聊', icon: 'Users', cat: '社交', goal: 1, reward: 50, metric: 'groups', link: '/groups' },
  { id: 'first_theater', name: '登台亮相', desc: '参与 1 次剧场联机', icon: 'Drama', cat: '社交', goal: 1, reward: 60, metric: 'theaters', link: '/theater' },
  { id: 'fans_5', name: '小有名气', desc: '获得 5 位粉丝', icon: 'UserCheck', cat: '社交', goal: 5, reward: 150, metric: 'followers', link: '/profile' },
  // 议会
  { id: 'councilor', name: '当选议员', desc: '成为幻域议会议员', icon: 'Scale', cat: '议会', goal: 1, reward: 200, metric: 'councilor', link: '/parliament' },
  { id: 'first_proposal', name: '议政之始', desc: '提交 1 份公共议案', icon: 'Gavel', cat: '议会', goal: 1, reward: 120, metric: 'proposals', link: '/parliament' },
  { id: 'vote_5', name: '恪尽职守', desc: '参与 5 次议会表决', icon: 'CheckSquare', cat: '议会', goal: 5, reward: 130, metric: 'votes', link: '/parliament' },
  { id: 'endorse_3', name: '民意所向', desc: '联署 3 份议案', icon: 'Landmark', cat: '议会', goal: 3, reward: 70, metric: 'endorsements', link: '/parliament' },
  // 财富 / 探索
  { id: 'checkin_7', name: '持之以恒', desc: '连续签到 7 天', icon: 'CalendarCheck', cat: '财富', goal: 7, reward: 200, metric: 'checkin_streak', link: '/wallet' },
  { id: 'gold_10k', name: '腰缠万贯', desc: '累计赚取 10000 金币', icon: 'Coins', cat: '财富', goal: 10000, reward: 300, metric: 'gold_earned', link: '/wallet' },
  { id: 'gacha_10', name: '欧皇之路', desc: '在扭蛋机抽卡 10 次', icon: 'Dices', cat: '财富', goal: 10, reward: 160, metric: 'gacha_pulls', link: '/gacha' },
  { id: 'become_vip', name: '尊享会员', desc: '开通 VIP 会员', icon: 'Crown', cat: '财富', goal: 1, reward: 120, metric: 'vip', link: '/wallet' },
];
function achMetric(me, metric) {
  const uid = me.id;
  switch (metric) {
    case 'chats': return filter('conversations', c => c.user_id === uid).length;
    case 'messages': { const ids = filter('conversations', c => c.user_id === uid).map(c => c.id); return filter('messages', x => ids.includes(x.conversation_id) && x.role === 'user').length; }
    case 'affinity_max': return filter('conversations', c => c.user_id === uid).reduce((mx, c) => Math.max(mx, c.affinity || 0), 0);
    case 'characters': return filter('characters', c => c.owner_id === uid && !c.from_script).length;
    case 'public_characters': return filter('characters', c => c.owner_id === uid && c.is_public).length;
    case 'scripts': return filter('scripts', s => s.author_id === uid).length;
    case 'creator_bronze': return creatorTier(me) ? 1 : 0;
    case 'creator_gold': return creatorTier(me) === 'gold' ? 1 : 0;
    case 'favorites': return filter('favorites', f => f.user_id === uid).length;
    case 'moments': return filter('moments', x => x.user_id === uid).length;
    case 'groups': return filter('group_members', x => x.user_id === uid).length;
    case 'theaters': return filter('theater_members', x => x.user_id === uid).length;
    case 'followers': return filter('follows', f => f.following_id === uid).length;
    case 'friends': return friendIds(uid).length;
    case 'councilor': return me.is_councilor ? 1 : 0;
    case 'proposals': return filter('proposals', p => p.author_id === uid).length;
    case 'votes': return filter('proposal_votes', v => v.user_id === uid).length;
    case 'endorsements': return filter('proposal_endorse', e => e.user_id === uid).length;
    case 'checkin_streak': return me.checkin_streak || 0;
    case 'gold_earned': return filter('transactions', t => t.user_id === uid && t.gold > 0).reduce((s, t) => s + t.gold, 0);
    case 'gacha_pulls': return me.gacha_pulls || 0;
    case 'vip': return isVip(me) ? 1 : 0;
    default: return 0;
  }
}
function achUnlockedCount(u) { return ACHIEVEMENTS.filter(a => achMetric(u, a.metric) >= a.goal).length; }

/* ----------------------------- friends / DM / presence ----------------------------- */
const ONLINE_MS = 5 * 60 * 1000;
function pairKey(a, b) { return a < b ? [a, b] : [b, a]; }
function areFriends(a, b) { const [x, y] = pairKey(a, b); return !!find('friendships', f => f.a_id === x && f.b_id === y); }
function friendIds(uid) { return filter('friendships', f => f.a_id === uid || f.b_id === uid).map(f => (f.a_id === uid ? f.b_id : f.a_id)); }
function isOnline(u) { if (!u) return false; const s = find('settings', x => x.user_id === u.id); if (s && s.show_online === 0) return false; return !!u.last_active && (Date.now() - u.last_active) < ONLINE_MS; }
function dmAllowed(me, target) {
  if (!target) return false;
  if (areFriends(me.id, target.id)) return true; // friends may always DM
  const s = find('settings', x => x.user_id === target.id) || {}; const mode = s.allow_dm || 'all';
  if (mode === 'none') return false;
  if (mode === 'followers') return !!find('follows', f => f.follower_id === me.id && f.following_id === target.id);
  return true;
}
function friendState(me, tid) {
  if (tid === me.id) return 'self';
  if (areFriends(me.id, tid)) return 'friends';
  if (find('friend_requests', r => r.from_id === me.id && r.to_id === tid && r.status === 'pending')) return 'pending_out';
  if (find('friend_requests', r => r.from_id === tid && r.to_id === me.id && r.status === 'pending')) return 'pending_in';
  return 'none';
}
function dmThreadOf(meId, otherId) { return filter('dm_messages', d => (d.from_id === meId && d.to_id === otherId) || (d.from_id === otherId && d.to_id === meId)); }

/* ----------------------------- helpers ----------------------------- */
const GOLD_PER_DIAMOND = 100, VIP_COST_GOLD = 30000, VIP_DAYS = 30;
const isVip = (u) => !!u?.vip_until && new Date(u.vip_until).getTime() > Date.now();
function publicUser(u) {
  return u && { id: u.id, username: u.username, email: u.email, display_name: u.display_name, avatar: u.avatar, banner: u.banner, bio: u.bio, gold: u.gold, diamond: u.diamond, vip_until: u.vip_until, vip: isVip(u), checkin_streak: u.checkin_streak, last_checkin: u.last_checkin, is_gm: !!u.is_gm, is_banned: !!u.is_banned, svip: !!u.svip, verified: !!u.verified, verified_note: u.verified_note || '', is_councilor: !!u.is_councilor, official: !!u.official, creator_tier: creatorTier(u), created_at: u.created_at };
}
function applyTx(uid, { kind, gold = 0, diamond = 0, memo = '', ref_owner = null }) {
  const u = user(uid);
  if (u.gold + gold < 0) throw new Error('金币不足');
  if (u.diamond + diamond < 0) throw new Error('钻石不足');
  u.gold += gold; u.diamond += diamond;
  // ref_owner: 该笔消费归属的创作者（用于"按用户真实投入分成"），仅当消费者非作者本人时记录。
  insert('transactions', { user_id: uid, kind, gold, diamond, memo, ref_owner: (ref_owner && ref_owner !== uid) ? ref_owner : null });
  save();
  return { gold: u.gold, diamond: u.diamond };
}
const notify = (uid, text, link = '') => insert('notifications', { user_id: uid, text, link, read: 0 });

// Resolve which LLM credentials a request should use. If the user set their own key,
// use it (no fee). Otherwise transparently fall back to the platform service.
function effectiveLLM(s) {
  if (s && s.llm_api_key) return { base_url: s.llm_base_url, api_key: s.llm_api_key, model: s.llm_model, temperature: s.llm_temperature, max_tokens: s.llm_max_tokens, protocol: s.llm_protocol || 'openai', platform: false };
  const p = platformCfg();
  return { base_url: p.base_url, api_key: platformKey(), model: p.model, temperature: (s && s.llm_temperature) ?? 0.8, max_tokens: (s && s.llm_max_tokens) || 1024, protocol: p.protocol || 'openai', platform: true };
}

// Normalise a base URL for a given protocol so users can paste either the bare host
// or one already ending in /v1 etc.
function llmEndpoint(base, protocol) {
  const b = String(base || '').replace(/\/+$/, '');
  if (protocol === 'anthropic') return b.replace(/\/v1$/, '') + '/v1/messages';
  if (protocol === 'gemini') return b.replace(/\/$/, ''); // handled specially (model in path)
  return b + '/chat/completions';
}
// Build an Anthropic-style message list from OpenAI-style history (system pulled out,
// roles mapped, consecutive same-role merged, leading non-user trimmed).
function toAnthropicMessages(history) {
  const msgs = history.filter(m => m.content).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
  const merged = [];
  for (const mm of msgs) { const last = merged[merged.length - 1]; if (last && last.role === mm.role) last.content += '\n\n' + mm.content; else merged.push({ ...mm }); }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged.length ? merged : [{ role: 'user', content: '（请开始）' }];
}
// Parse one SSE data payload for either protocol → returns delta text (or '').
function parseDelta(json, protocol) {
  try {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    if (protocol === 'anthropic') {
      if (j.type === 'content_block_delta') return j.delta?.text || '';
      if (j.type === 'error') throw new Error(j.error?.message || 'anthropic error');
      return '';
    }
    if (j.error) throw new Error(j.error.message || j.error);
    return j.choices?.[0]?.delta?.content || '';
  } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; return ''; }
}
// Headers + body for a streaming chat request, per protocol.
function llmRequest(eff, system, history) {
  if (eff.protocol === 'anthropic') {
    return {
      url: llmEndpoint(eff.base_url, 'anthropic'),
      headers: { 'content-type': 'application/json', 'x-api-key': eff.api_key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: { model: eff.model, max_tokens: eff.max_tokens || 1024, temperature: eff.temperature ?? 0.8, system, messages: toAnthropicMessages(history), stream: true },
    };
  }
  return {
    url: llmEndpoint(eff.base_url, 'openai'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
    body: { model: eff.model, messages: [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))], temperature: eff.temperature, max_tokens: eff.max_tokens, stream: true },
  };
}
// Compute the platform fee for a conversation given its current message count + membership.
function platformFee(me, msgCount) {
  const raw = msgCount > PLATFORM_FEE.heavy_threshold ? PLATFORM_FEE.heavy : PLATFORM_FEE.base;
  return Math.max(1, Math.round(raw * memberDiscount(me)));
}
// Charge the platform fee up-front; throws if the balance is insufficient.
function chargePlatformFee(me, msgCount, memo) {
  const fee = platformFee(me, msgCount);
  if (me.gold < fee) throw new Error(`金币不足，本次平台服务需 ${fee} 金币（当前 ${me.gold}）。可前往钱包签到/兑换获取金币，或在设置中填写自己的 API。`);
  applyTx(me.id, { kind: 'ai_fee', gold: -fee, memo: memo || `平台 AI 服务（${msgCount > PLATFORM_FEE.heavy_threshold ? '深度' : '标准'}）` });
  return fee;
}

const J = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const E = (msg, status = 400) => J({ error: msg }, status);

function authUser(headers) {
  let h = '';
  if (headers instanceof Headers) h = headers.get('authorization') || '';
  else if (headers) h = headers.Authorization || headers.authorization || '';
  const m = /^Bearer tok\.(\d+)/.exec(h);
  return m ? user(parseInt(m[1], 10)) : null;
}
const tokenFor = (u) => 'tok.' + u.id;

function fileToDataUrl(file) {
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
}

/* ----------------------------- world-book prompt ----------------------------- */
function buildSystemPrompt(character, recentText) {
  const parts = [];
  if (character.persona) parts.push(character.persona.trim());
  if (character.intro) parts.push(`【角色简介】\n${character.intro.trim()}`);
  const world = filter('world_entries', w => w.character_id === character.id && w.enabled).sort((a, b) => a.position - b.position);
  const hay = (recentText || '').toLowerCase(); const triggered = [];
  for (const w of world) {
    const keys = (w.keys || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keys.length === 0 || keys.some(k => hay.includes(k))) triggered.push(w.content);
  }
  if (triggered.length) parts.push('【世界书 / 设定】\n' + triggered.join('\n---\n'));
  parts.push(`你正在扮演「${character.name}」。请始终保持角色设定，使用沉浸式的第一人称叙述，不要跳出角色，不要提及你是 AI。`);
  return parts.join('\n\n');
}

/* ----------------------------- LLM (browser → provider) ----------------------------- */
async function streamCompletion(conv, character, settings, userContent, me) {
  const eff = effectiveLLM(settings);
  // When falling back to the platform service, verify the user can afford the fee
  // up-front, but only DEDUCT it after a successful reply (no charge on failure).
  let feeDue = 0;
  if (eff.platform && me) {
    const count = filter('messages', m => m.conversation_id === conv.id).length;
    feeDue = platformFee(me, count);
    if (me.gold < feeDue) {
      const enc = new TextEncoder();
      const msg = `金币不足，本次平台 AI 服务需 ${feeDue} 金币（当前 ${me.gold}）。可前往钱包签到/兑换，或在设置中填写自己的 API。`;
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    }
  }
  if (userContent) insert('messages', { conversation_id: conv.id, role: 'user', content: userContent });
  const history = filter('messages', m => m.conversation_id === conv.id);
  const recent = history.slice(-6).map(m => m.content).join(' ');
  let system = buildSystemPrompt(character, recent + ' ' + userContent);
  // Platform-wide system prompt (GM-configured) is prepended for no-API users only.
  if (eff.platform) { const gp = (platformCfg().system_prompt || '').trim(); if (gp) system = gp + '\n\n' + system; }
  // Conversation memories (user-curated) are injected so the character "remembers".
  if (conv.memories && conv.memories.length) system += '\n\n【对话记忆 · 请始终记住这些事实】\n' + conv.memories.map(x => '- ' + x.content).join('\n');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      if (!eff.api_key) {
        send({ error: '尚未配置语言模型 API。请前往「设置 → 语言模型」填写 API Key（浏览器将直连你的服务商）。' });
        controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return;
      }
      let full = '';
      try {
        const req = llmRequest(eff, system, history);
        let up = await realFetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
        // Graceful fallback: if a streaming request is rejected, retry once without streaming.
        if (!up.ok && eff.protocol === 'openai') {
          const t1 = await up.text().catch(() => '');
          const up2 = await realFetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify({ ...req.body, stream: false }) }).catch(() => null);
          if (up2 && up2.ok) { const d = await up2.json().catch(() => ({})); const txt = d.choices?.[0]?.message?.content || ''; if (txt) { full = txt; send({ delta: txt }); } up = { ok: true, body: null, _handled: true }; }
          else { send({ error: `模型服务返回 ${up.status}：${t1.slice(0, 300)}` }); up = { ok: false }; }
        }
        if (up.ok && up.body) {
          const reader = up.body.getReader(); const dec = new TextDecoder(); let buf = '';
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true }); const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
            for (const line of lines) {
              const t = line.trim(); if (!t.startsWith('data:')) continue;
              const d = t.slice(5).trim(); if (d === '[DONE]') continue;
              const delta = parseDelta(d, eff.protocol); if (delta) { full += delta; send({ delta }); }
            }
          }
        } else if (!up.ok && !up._handled) { const t = await (up.text ? up.text().catch(() => '') : Promise.resolve('')); if (t || !full) send({ error: `模型服务返回 ${up.status || ''}：${(t || '').slice(0, 300)}` }); }
      } catch (err) { send({ error: '连接模型服务失败：' + err.message + '（可能是服务商的浏览器跨域限制；可尝试在设置中更换协议或服务商）' }); }
      if (full.trim()) {
        insert('messages', { conversation_id: conv.id, role: 'assistant', content: full.trim() }); conv.updated_at = now();
        if (userContent) conv.affinity = (conv.affinity || 0) + 3; // 好感度随有效互动增长
        // Only now deduct the platform fee — successful reply.
        if (feeDue && me) { try { applyTx(me.id, { kind: 'ai_fee', gold: -feeDue, memo: `平台 AI · 对话《${character?.name || ''}》`, ref_owner: character?.owner_id }); send({ fee: feeDue }); } catch { /* */ } }
        save();
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
    }
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function llmOnce(settings, system, userMsg, maxTokens = 400) {
  const eff = effectiveLLM(settings);
  if (!eff.api_key) throw new Error('请先在设置中配置语言模型 API');
  if (eff.protocol === 'anthropic') {
    const r = await realFetch(llmEndpoint(eff.base_url, 'anthropic'), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': eff.api_key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: eff.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMsg }] })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`模型返回 ${r.status}：${t.slice(0, 200)}`); }
    const data = await r.json();
    return (data.content?.[0]?.text || '').trim();
  }
  const r = await realFetch(llmEndpoint(eff.base_url, 'openai'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
    body: JSON.stringify({ model: eff.model, temperature: eff.temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`模型返回 ${r.status}：${t.slice(0, 200)}`); }
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/* ----------------------------- router ----------------------------- */
const CATEGORIES = [['fantasy', '奇幻', ''], ['scifi', '科幻', ''], ['romance', '恋爱', ''], ['healing', '治愈', ''], ['mystery', '悬疑', ''], ['history', '历史', ''], ['game', '游戏', ''], ['anime', '二次元', '愈'], ['daily', '日常', ''], ['horror', '惊悚', ''], ['wuxia', '武侠', ''], ['other', '其他', '']];
const PACKAGES = [{ id: 'p1', cny: 6, diamond: 60, bonus: 0 }, { id: 'p2', cny: 30, diamond: 300, bonus: 30 }, { id: 'p3', cny: 68, diamond: 680, bonus: 120 }, { id: 'p4', cny: 128, diamond: 1280, bonus: 320 }, { id: 'p5', cny: 328, diamond: 3280, bonus: 1080 }, { id: 'p6', cny: 648, diamond: 6480, bonus: 2880 }];

// Platform activities (活动中心). `claim` events grant a one-time reward; others are
// informational or link to a multiplayer (联机) destination.
const EVENTS = [
  { id: 'newbie', kind: 'claim', tag: '新人', title: '新人见面礼', desc: '初入幻域，领取启程礼包：200 金币 + 10 钻石，开启你的第一段角色扮演。', reward: { gold: 200, diamond: 10 }, accent: '#d97757' },
  { id: 'coop_carnival', kind: 'claim', tag: '联机', title: '限时联机狂欢', desc: '进入「剧场」与多位 AI 角色同台即兴演出，领取联机狂欢礼：60 钻石，并解锁多人同屏剧情。', reward: { gold: 0, diamond: 60 }, link: '/theater', linkText: '前往联机剧场', accent: '#7c5cff' },
  { id: 'group_party', kind: 'link', tag: '联机', title: '创作者联机大厅', desc: '加入群聊与其他创作者实时联机交流、互相导入角色、组队共创剧本。', link: '/groups', linkText: '进入联机大厅', accent: '#3f8195' },
  { id: 'checkin', kind: 'link', tag: '日常', title: '每日签到瓜分金币', desc: '连续签到奖励翻倍递增，VIP 再享双倍。坚持登录，金币越攒越多。', link: '/wallet', linkText: '去签到', accent: '#b3892f' },
  { id: 'bugbounty', kind: 'info', tag: '赏金', title: 'Bug 赏金猎人', desc: '发现任何 bug 或体验问题，提交至官方技术 QQ：3487923507，一经采纳奖励 100 金币起，重大问题另有钻石与 VIP 加码。', accent: '#5c8a63', qq: '3487923507' },
  { id: 'invite', kind: 'info', tag: '裂变', title: '邀请好友共创', desc: '在「设置 / 钱包」使用邀请密钥，邀请越多奖励越丰厚。与好友一起把幻域写满故事。', link: '/wallet', linkText: '查看兑换码', accent: '#c25a38' }
];

function charView(c) { return { ...c, world: filter('world_entries', w => w.character_id === c.id).sort((a, b) => a.position - b.position) }; }

/* ----------------------------- creator V tiers ----------------------------- */
// Creators earn a tiered V badge by their public works' popularity:
//  铜V 创作者  — has ≥1 public work
//  黄V 知名创作者 — combined score ≥ KNOWN_CREATOR_SCORE
//  金V 殿堂创作者 — the single #1 creator by score (top 1)
const KNOWN_CREATOR_SCORE = 1500;
function creatorScore(uid) {
  let s = 0;
  filter('characters', c => c.owner_id === uid && c.is_public).forEach(c => { s += (c.uses || 0) + (c.likes || 0) * 2; });
  filter('scripts', sc => sc.author_id === uid).forEach(sc => { s += (sc.plays || 0) + (sc.likes || 0) * 2; });
  return s;
}
function creatorWorks(uid) { return filter('characters', c => c.owner_id === uid && c.is_public).length + filter('scripts', s => s.author_id === uid).length; }
function topCreatorId() {
  let best = null, bestScore = 0;
  table('users').forEach(u => { if (!u.official && creatorWorks(u.id) > 0) { const sc = creatorScore(u.id); if (sc > bestScore) { bestScore = sc; best = u.id; } } });
  return best;
}
function creatorTier(u) {
  // Official accounts (官号) never carry creator certification.
  if (!u || u.official || creatorWorks(u.id) === 0) return null;
  if (u.id === topCreatorId()) return 'gold';
  if (creatorScore(u.id) >= KNOWN_CREATOR_SCORE) return 'yellow';
  return 'bronze';
}

/* ----------------------------- creator revenue-share program (创作者收益分成计划) -----------------------------
   分成基数 = 其他用户在该创作者作品上"真实花掉的金币"（平台对话费 + 平台语音费，
   按消费记录的 ref_owner 归属）。创作者按等级系数从这笔"被投入金币池"中分成，
   等级由累计被投入额决定，可随时领取尚未领取的部分。规则全透明。 */
const REV_TIERS = [
  { id: 'seed', name: '萌新创作者', min: 0, rate: 0.20 },
  { id: 'bronze', name: '铜牌创作者', min: 500, rate: 0.28 },
  { id: 'silver', name: '银牌创作者', min: 2000, rate: 0.35 },
  { id: 'gold', name: '金牌创作者', min: 8000, rate: 0.43 },
  { id: 'hall', name: '殿堂创作者', min: 30000, rate: 0.50 },
];
const revTierOf = (pool) => [...REV_TIERS].reverse().find(t => pool >= t.min) || REV_TIERS[0];
// Gold others spent on this creator's works (platform AI + voice fees), attributed via ref_owner.
function creatorSpendPool(uid) {
  const month = new Date().toISOString().slice(0, 7);
  let total = 0, monthSum = 0;
  filter('transactions', t => t.ref_owner === uid && (t.kind === 'ai_fee' || t.kind === 'voice_fee')).forEach(t => {
    const spent = Math.max(0, -t.gold); total += spent;
    if ((t.created_at || '').slice(0, 7) === month) monthSum += spent;
  });
  return { total, month: monthSum };
}
function revenuePlan(u) {
  const pool = creatorSpendPool(u.id);
  const tier = revTierOf(pool.total);
  const entitled = Math.floor(pool.total * tier.rate);
  const claimed = u.rev_claimed_total || 0;
  const claimable_amount = Math.max(0, entitled - claimed);
  return { pool_total: pool.total, pool_month: pool.month, works: creatorWorks(u.id),
    tier: tier.id, tier_name: tier.name, rate: tier.rate, entitled, claimed, claimable_amount,
    claimable: claimable_amount > 0, tiers: REV_TIERS, next: REV_TIERS.find(t => t.min > pool.total) || null };
}
// Daily positive-income series for charts (last `days` days).
function incomeSeries(uid, days = 14) {
  const txs = filter('transactions', t => t.user_id === uid && t.gold > 0);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d.slice(5), gold: txs.filter(t => (t.created_at || '').slice(0, 10) === d).reduce((s, t) => s + t.gold, 0) });
  }
  return out;
}

/* ----------------------------- council apportionment ----------------------------- */
const USERS_PER_SEAT = 100; // 平均每 100 名注册用户对应一个议会席位
const MIN_SEATS = 5;        // 席位下限，保证小规模社区也有可运作的议会
function councilCfg() { if (!db.council) { db.council = { seats_override: null, term: 1, term_started_at: now() }; save(); } return db.council; }
function baseSeats() { return Math.floor(table('users').length / USERS_PER_SEAT); }
// Effective seats: GM override wins; otherwise auto from population (floored to a minimum).
function councilSeats() { const c = councilCfg(); return c.seats_override != null ? c.seats_override : Math.max(MIN_SEATS, baseSeats()); }
// When the chamber is locked (GM 封锁), the parliament is suspended indefinitely.
function parliamentLocked() { return !!councilCfg().locked; }

/* ----------------------------- parliament ----------------------------- */
function councilSize() { return filter('users', u => u.is_councilor).length; }
// Build a public view of a proposal with live tallies + the caller's vote/endorsement.
function proposalView(p, meId) {
  const votes = filter('proposal_votes', v => v.proposal_id === p.id);
  const live = { for: 0, against: 0, abstain: 0 };
  votes.forEach(v => { live[v.choice] = (live[v.choice] || 0) + 1; });
  const total = votes.length; live.total = total; live.ratio = total ? live.for / total : 0;
  const endorses = filter('proposal_endorse', e => e.proposal_id === p.id);
  const author = user(p.author_id);
  return {
    id: p.id, title: p.title, body: p.body, status: p.status,
    author_id: p.author_id, author_name: author?.display_name || '已注销', author_avatar: author?.avatar, author_verified: !!author?.verified,
    created_at: p.created_at, adopted_at: p.adopted_at || null, decided_at: p.decided_at || null,
    live_tally: live, tally: p.tally || null, council_size: councilSize(),
    my_vote: meId ? (votes.find(v => v.user_id === meId)?.choice || null) : null,
    endorsements: endorses.length, my_endorsed: meId ? endorses.some(e => e.user_id === meId) : false,
    comment_count: filter('proposal_comments', c => c.proposal_id === p.id).length,
  };
}
function saveWorld(cid, world) {
  db.world_entries = filter('world_entries', w => w.character_id !== cid);
  if (Array.isArray(world)) world.forEach((w, i) => { if (w && (w.content || w.keys)) insert('world_entries', { character_id: cid, keys: w.keys || '', content: w.content || '', enabled: w.enabled === false ? 0 : 1, position: i }); });
  save();
}

async function route(method, path, search, body, headers) {
  const me = authUser(headers);
  const need = () => { if (!me) throw { status: 401, msg: '未登录' }; if (me.is_banned) throw { status: 403, msg: '账号已被封禁' + (me.ban_reason ? '：' + me.ban_reason : '') }; return me; };
  const gmOnly = () => { need(); if (!me.is_gm) throw { status: 403, msg: '需要 GM 权限' }; return me; };
  const P = (re) => re.exec(path);
  let m;

  // ---------- auth ----------
  if (method === 'POST' && path === '/auth/register') {
    const { username, password, display_name, email, invite } = body;
    if (!username || !password) return E('用户名和密码必填');
    if (!invite) return E('请输入邀请密钥');
    const key = find('invite_keys', k => k.code === String(invite).trim());
    if (!key) return E('邀请密钥无效');
    if (key.used >= key.max_uses) return E('该邀请密钥已被使用完');
    if (find('users', u => u.username === username)) return E('该用户名已被注册', 409);
    const u = insert('users', { username, password, display_name: display_name || username, email: email || '', avatar: null, banner: null, bio: '', gold: 300, diamond: 0, vip_until: null, last_checkin: null, checkin_streak: 0 });
    insert('settings', { user_id: u.id, llm_provider: 'openai', llm_base_url: 'https://api.openai.com/v1', llm_api_key: '', llm_model: 'gpt-4o-mini', llm_temperature: 0.8, llm_max_tokens: 1024, voice_provider: 'openai', voice_protocol: 'openai', voice_base_url: 'https://api.openai.com/v1', voice_api_key: '', voice_model: 'tts-1', voice_name: 'alloy', theme: 'dark', nsfw: 0, notify_email: 0 });
    key.used++;
    if (key.grant_gold || key.grant_diamond) applyTx(u.id, { kind: 'invite', gold: key.grant_gold, diamond: key.grant_diamond, memo: `邀请密钥 ${key.code} 奖励` });
    if (key.grant_vip_days) u.vip_until = new Date(Date.now() + key.grant_vip_days * 86400000).toISOString();
    notify(u.id, '欢迎来到幻域！已为你发放新手金币，快去发现广场逛逛吧 ', '/');
    save();
    return J({ token: tokenFor(u), user: publicUser(u) });
  }
  if (method === 'POST' && path === '/auth/login') {
    const u = find('users', x => x.username === body.username);
    if (!u || u.password !== body.password) return E('用户名或密码错误', 401);
    if (u.is_banned) return E('账号已被封禁' + (u.ban_reason ? '：' + u.ban_reason : ''), 403);
    u.last_active = Date.now(); save();
    return J({ token: tokenFor(u), user: publicUser(u) });
  }
  if (method === 'GET' && path === '/auth/me') { need(); return J({ user: publicUser(me) }); }
  if (method === 'PUT' && path === '/auth/me') {
    need(); ['display_name', 'bio', 'avatar', 'banner', 'email'].forEach(k => { if (body[k] !== undefined && body[k] !== null) me[k] = body[k]; }); save();
    return J({ user: publicUser(me) });
  }
  if (method === 'PUT' && path === '/auth/password') {
    need(); if (me.password !== body.old_password) return E('原密码错误'); if (String(body.new_password || '').length < 4) return E('新密码至少 4 位'); me.password = body.new_password; save(); return J({ ok: true });
  }

  // ---------- settings ----------
  if (path === '/settings') {
    need(); const s = find('settings', x => x.user_id === me.id);
    if (method === 'GET') return J({ settings: pubSettings(s, me) });
    if (method === 'PUT') {
      ['llm_provider', 'llm_protocol', 'llm_base_url', 'llm_model', 'llm_temperature', 'llm_max_tokens', 'voice_provider', 'voice_protocol', 'voice_base_url', 'voice_model', 'voice_name', 'theme'].forEach(k => { if (body[k] !== undefined) s[k] = body[k]; });
      if (body.llm_api_key) s.llm_api_key = body.llm_api_key;
      if (body.voice_api_key) s.voice_api_key = body.voice_api_key;
      if (body.nsfw !== undefined) s.nsfw = body.nsfw ? 1 : 0;
      if (body.notify_email !== undefined) s.notify_email = body.notify_email ? 1 : 0;
      // privacy
      ['privacy_profile', 'allow_dm'].forEach(k => { if (typeof body[k] === 'string') s[k] = body[k]; });
      ['show_online', 'discoverable', 'activity_visible', 'leaderboard_visible', 'read_receipts', 'personalize'].forEach(k => { if (body[k] !== undefined) s[k] = body[k] ? 1 : 0; });
      save(); return J({ settings: pubSettings(s, me) });
    }
  }

  // Privacy / data management — wipe all of the caller's conversations.
  if (method === 'POST' && path === '/settings/clear-conversations') {
    need(); const ids = filter('conversations', c => c.user_id === me.id).map(c => c.id);
    db.conversations = filter('conversations', c => c.user_id !== me.id);
    db.messages = filter('messages', x => !ids.includes(x.conversation_id));
    save(); return J({ ok: true, removed: ids.length });
  }
  // Export everything the caller owns as a portable JSON bundle.
  if (method === 'GET' && path === '/settings/export') {
    need();
    const myConvs = filter('conversations', c => c.user_id === me.id);
    const convIds = myConvs.map(c => c.id);
    return J({
      exported_at: now(), app: '幻域 HUANYU',
      profile: publicUser(me),
      settings: pubSettings(find('settings', x => x.user_id === me.id) || {}, me),
      characters: filter('characters', c => c.owner_id === me.id).map(c => charView(c)),
      scripts: filter('scripts', sc => sc.author_id === me.id),
      conversations: myConvs.map(c => ({ ...c, messages: filter('messages', x => x.conversation_id === c.id) })),
      favorites: filter('favorites', f => f.user_id === me.id).map(f => f.character_id),
      stats: { characters: filter('characters', c => c.owner_id === me.id).length, conversations: convIds.length, messages: filter('messages', x => convIds.includes(x.conversation_id)).length },
    });
  }

  // Detect provider models (browser → provider directly). Protocol-aware.
  if (method === 'POST' && path === '/settings/models') {
    need(); const s = find('settings', x => x.user_id === me.id) || {};
    const raw = String(body.base_url || s.llm_base_url || '');
    const base = raw.split('?')[0].replace(/\/$/, '');
    const key = body.api_key || s.llm_api_key;
    const proto = body.protocol || 'openai';
    // MiniMax TTS 模型：官方未提供「TTS 模型列表」端点，/v1/models 只返回 LLM 模型
    // （MiniMax-M3 等），不能拿来当 TTS 模型，否则会把文字模型错误地路由进语音合成。
    // 这里返回 MiniMax 官方文档公开的 T2A 模型清单。音色检测走 /admin/platform/detect-voices（GM）/ /settings/voices（用户自备）。
    if (proto === 'minimax') return J({ models: ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo'] });
    if (proto === 'volcano') return J({ models: ['volcano_tts', 'volcano_icl'] }); // cluster name, no list endpoint
    if (proto === 'tencent') return J({ models: ['ap-guangzhou', 'ap-shanghai', 'ap-beijing', 'ap-hongkong'] }); // 地域(Region), no list endpoint
    if (proto === 'baidu' || proto === 'browser') return J({ models: [] }); // no remote model list
    if (!base) return E('请先填写 API Base URL');
    if (!key) return E('请先填写 API Key');
    const url = proto === 'anthropic' ? base.replace(/\/v1$/, '') + '/v1/models' : base + '/models';
    const headers = proto === 'elevenlabs' ? { 'xi-api-key': key }
      : proto === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
        : { Authorization: `Bearer ${key}` };
    try {
      const r = await realFetch(url, { headers });
      if (!r.ok) { const t = await r.text().catch(() => ''); return E(`服务商返回 ${r.status}：${t.slice(0, 200)}`, 502); }
      const d = await r.json();
      const arr = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : (Array.isArray(d) ? d : []));
      return J({ models: arr.map(x => (typeof x === 'string' ? x : (x.model_id || x.id || x.name))).filter(Boolean) });
    } catch (e) { return E('连接服务商失败（可能是浏览器跨域限制）：' + e.message, 502); }
  }

  // Detect available voices for TTS providers with a voice-list endpoint (MiniMax /v1/get_voice).
  if (method === 'POST' && path === '/settings/voices') {
    need(); const s = find('settings', x => x.user_id === me.id) || {};
    const proto = body.protocol || s.voice_protocol || 'openai';
    if (proto !== 'minimax') return E('当前语音服务商未提供音色列表端点', 400);
    const raw = String(body.base_url || s.voice_base_url || '');
    const mmBase = raw.split('?')[0].replace(/\/$/, '');
    let mmKey = String(body.api_key || s.voice_api_key || '').trim();
    if (mmKey.includes(':')) { const c = mmKey.indexOf(':'); mmKey = mmKey.slice(c + 1).trim(); }
    if (!mmBase) return E('请先填写 API Base URL');
    if (!mmKey) return E('请先填写 API Key（MiniMax 接口密钥）');
    try {
      const r = await realFetch(`${mmBase}/get_voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mmKey}` }, body: JSON.stringify({ voice_type: 'all' }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); return E(`音色列表获取失败 (HTTP ${r.status})，请检查 API Key 与 Base URL：${t.slice(0, 150)}`, 502); }
      const d = await r.json();
      if (d?.base_resp?.status_code && d.base_resp.status_code !== 0) return E('MiniMax 返回错误：' + (d.base_resp.status_msg || ('status_code=' + d.base_resp.status_code)), 502);
      const norm = (arr, group) => (Array.isArray(arr) ? arr.map(v => ({ voice_id: v.voice_id, voice_name: v.voice_name || '', group, description: Array.isArray(v.description) ? v.description.join('；') : (v.description || '') })).filter(x => x.voice_id) : []);
      return J({ voices: [...norm(d?.system_voice, '系统音色'), ...norm(d?.voice_cloning, '复刻音色'), ...norm(d?.voice_generation, '生成音色')] });
    } catch (e) { return E('音色列表获取失败（可能是浏览器跨域限制）：' + e.message, 502); }
  }

  // Connection test — verify the configured LLM credentials actually respond.
  if (method === 'POST' && path === '/settings/test-llm') {
    need(); const s = find('settings', x => x.user_id === me.id) || {};
    const eff = { base_url: body.base_url || s.llm_base_url, api_key: body.api_key || s.llm_api_key, model: body.model || s.llm_model, temperature: 0.5, max_tokens: 16, protocol: body.protocol || s.llm_protocol || 'openai', platform: false };
    if (!eff.api_key) return E('请先填写 API Key');
    try {
      const reply = await llmOnce({ llm_base_url: eff.base_url, llm_api_key: eff.api_key, llm_model: eff.model, llm_protocol: eff.protocol, llm_temperature: 0.5 }, '你是连接测试助手。', '请只回复两个字：在线', 16);
      return J({ ok: true, reply: reply.slice(0, 40) });
    } catch (e) { return E('连接失败：' + e.message, 502); }
  }

  // ---------- meta ----------
  if (method === 'GET' && path === '/meta/categories') return J({ categories: CATEGORIES.map(([slug, name, icon]) => ({ slug, name, icon })) });

  // ---------- announcements ----------
  if (path === '/announcements' && method === 'GET') {
    const rows = filter('announcements', () => true).sort((a, b) => (b.pinned - a.pinned) || (b.id - a.id))
      .map(a => ({ ...a, author_name: user(a.author_id)?.display_name }));
    return J({ announcements: rows, is_gm: !!me?.is_gm });
  }
  if (path === '/announcements' && method === 'POST') {
    need(); if (!me.is_gm) return E('仅 GM 可发布公告', 403);
    if (!body.title) return E('公告标题必填');
    return J({ announcement: insert('announcements', { author_id: me.id, title: body.title, body: body.body || '', pinned: body.pinned ? 1 : 0 }) });
  }
  if ((m = P(/^\/announcements\/(\d+)$/)) && method === 'DELETE') {
    need(); if (!me.is_gm) return E('仅 GM 可删除公告', 403);
    db.announcements = filter('announcements', a => a.id !== +m[1]); save(); return J({ ok: true });
  }

  // ---------- upload ----------
  if (method === 'POST' && path === '/upload') {
    const file = body && body.get && body.get('file'); if (!file) return E('未收到文件');
    const url = await fileToDataUrl(file); return J({ url, type: file.type?.startsWith('video') ? 'video' : file.type?.startsWith('audio') ? 'audio' : 'image' });
  }

  // ---------- characters ----------
  if (method === 'GET' && path === '/characters/mine') { need(); return J({ characters: filter('characters', c => c.owner_id === me.id && !c.from_script).sort((a, b) => b.id - a.id) }); }
  if (method === 'GET' && path === '/me/studio') {
    need();
    const charRows = filter('characters', c => c.owner_id === me.id && !c.from_script).map(c => ({
      id: c.id, name: c.name, avatar: c.avatar, is_public: !!c.is_public, uses: c.uses || 0, likes: c.likes || 0,
      favs: filter('favorites', f => f.character_id === c.id).length
    }));
    const scriptRows = filter('scripts', s => s.author_id === me.id).map(s => {
      const purchases = filter('script_purchases', p => p.script_id === s.id && !p.refunded);
      return { id: s.id, title: s.title, cover: s.cover, price_gold: s.price_gold || 0, plays: s.plays || 0, likes: s.likes || 0,
        sales: purchases.filter(p => (p.price || 0) > 0).length, revenue: purchases.reduce((a, p) => a + (p.price || 0), 0) };
    });
    const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
    const totals = {
      char_count: charRows.length, char_uses: sum(charRows, 'uses'), char_likes: sum(charRows, 'likes'), char_favs: sum(charRows, 'favs'),
      script_count: scriptRows.length, script_plays: sum(scriptRows, 'plays'), script_sales: sum(scriptRows, 'sales'),
      gold_earned: sum(scriptRows, 'revenue'), followers: filter('follows', f => f.following_id === me.id).length
    };
    return J({ totals, characters: charRows.sort((a, b) => b.uses - a.uses), scripts: scriptRows.sort((a, b) => b.revenue - a.revenue), series: incomeSeries(me.id, 14), revenue_plan: revenuePlan(me) });
  }
  if (method === 'GET' && path === '/me/revenue-plan') { need(); return J({ plan: revenuePlan(me) }); }
  if (method === 'POST' && path === '/me/revenue-plan/claim') {
    need(); const plan = revenuePlan(me);
    if (!plan.claimable) return E('暂无可领取的分成；当用户在你的作品上消费金币后即可分成');
    const amount = plan.claimable_amount;
    me.rev_claimed_total = (me.rev_claimed_total || 0) + amount;
    const w = applyTx(me.id, { kind: 'revenue_share', gold: amount, memo: `创作者分成（${plan.tier_name} · ${Math.round(plan.rate * 100)}%）` });
    notify(me.id, `💰 创作者收益分成 ${amount} 金币已到账（${plan.tier_name}）`, '/studio');
    return J({ ok: true, reward: amount, wallet: w, plan: revenuePlan(me) });
  }
  if (method === 'GET' && path === '/characters/public') {
    const cat = search.get('category'), q = (search.get('q') || '').toLowerCase(), sort = search.get('sort');
    let rows = filter('characters', c => c.is_public);
    if (cat && cat !== 'all') rows = rows.filter(c => c.category === cat);
    if (q) rows = rows.filter(c => (c.name + c.tags + c.tagline).toLowerCase().includes(q));
    rows = rows.sort((a, b) => sort === 'new' ? b.id - a.id : (b.uses - a.uses) || (b.likes - a.likes)).slice(0, 80);
    rows = rows.map(c => ({ ...c, owner_name: user(c.owner_id)?.display_name, owner_tier: creatorTier(user(c.owner_id)), faved: me ? !!find('favorites', f => f.user_id === me.id && f.character_id === c.id) : false }));
    return J({ characters: rows });
  }
  // Personalized recommendations — rank public characters by the categories the
  // caller has favorited / chatted with, blended with popularity. Excludes the
  // caller's own characters and ones they already favorited.
  if (method === 'GET' && path === '/characters/recommended') {
    need();
    const favRows = filter('favorites', f => f.user_id === me.id);
    const favIds = new Set(favRows.map(f => f.character_id));
    const myConvs = filter('conversations', c => c.user_id === me.id);
    const weight = {}; // category -> taste score
    const bump = (cat, w) => { if (cat) weight[cat] = (weight[cat] || 0) + w; };
    favRows.forEach(f => bump(find('characters', x => x.id === f.character_id)?.category, 2));
    myConvs.forEach(cv => bump(find('characters', x => x.id === cv.character_id)?.category, 1));
    const personalized = Object.keys(weight).length > 0;
    const pool = filter('characters', c => c.is_public && c.owner_id !== me.id && !favIds.has(c.id) && !c.from_script);
    const rows = pool
      .map(c => ({ c, score: (weight[c.category] || 0) * 3 + Math.log10((c.uses || 0) + (c.likes || 0) + 1) + (c.featured ? 0.4 : 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 12)
      .map(({ c }) => ({ ...c, owner_name: user(c.owner_id)?.display_name, owner_tier: creatorTier(user(c.owner_id)), faved: false }));
    return J({ characters: rows, personalized });
  }
  if (method === 'GET' && path === '/characters/favorites/list') { need(); const rows = filter('favorites', f => f.user_id === me.id).map(f => { const c = find('characters', x => x.id === f.character_id); return c && { ...c, owner_name: user(c.owner_id)?.display_name }; }).filter(Boolean).reverse(); return J({ characters: rows }); }
  if ((m = P(/^\/characters\/(\d+)\/favorite$/)) && method === 'POST') {
    need(); const cid = +m[1]; const ex = find('favorites', f => f.user_id === me.id && f.character_id === cid); const c = find('characters', x => x.id === cid);
    if (ex) { db.favorites = filter('favorites', f => !(f.user_id === me.id && f.character_id === cid)); if (c) c.likes = Math.max(0, c.likes - 1); save(); return J({ faved: false }); }
    insert('favorites', { user_id: me.id, character_id: cid }); if (c) c.likes++; bumpDaily(me.id, 'fav'); save(); return J({ faved: true });
  }
  if ((m = P(/^\/characters\/(\d+)$/))) {
    const cid = +m[1]; const c = find('characters', x => x.id === cid);
    if (method === 'GET') {
      if (!c) return E('角色不存在', 404); if (!c.is_public && (!me || me.id !== c.owner_id)) return E('无权访问', 403);
      const owner = user(c.owner_id);
      const fav_count = filter('favorites', f => f.character_id === c.id).length;
      const related = filter('characters', x => x.is_public && x.id !== c.id && !x.from_script && (x.category === c.category || x.owner_id === c.owner_id))
        .map(x => ({ id: x.id, name: x.name, avatar: x.avatar, tagline: x.tagline, uses: x.uses || 0, category: x.category }))
        .sort((a, b) => b.uses - a.uses).slice(0, 6);
      const author_char_count = filter('characters', x => x.is_public && x.owner_id === c.owner_id && x.id !== c.id && !x.from_script).length;
      return J({ character: { ...charView(c), owner_name: owner?.display_name, owner_avatar: owner?.avatar, owner_verified: !!owner?.verified, owner_tier: creatorTier(owner), fav_count, author_char_count }, related });
    }
    if (method === 'PUT') { need(); if (!c || c.owner_id !== me.id) return E('无权编辑', 403); ['name', 'avatar', 'background', 'background_type', 'bgm', 'tagline', 'intro', 'greeting', 'persona', 'voice_name', 'voice_speed', 'voice_pitch', 'category', 'tags'].forEach(k => { if (body[k] !== undefined) c[k] = body[k]; }); c.is_public = body.is_public ? 1 : 0; c.nsfw = body.nsfw ? 1 : 0; if (body.world) saveWorld(c.id, body.world); save(); return J({ character: charView(c) }); }
    if (method === 'DELETE') { need(); if (!c || c.owner_id !== me.id) return E('无权删除', 403); db.characters = filter('characters', x => x.id !== cid); save(); return J({ ok: true }); }
  }
  if (method === 'POST' && path === '/characters') {
    need(); if (!body.name) return E('角色名必填');
    const c = insert('characters', { owner_id: me.id, name: body.name, avatar: body.avatar || null, background: body.background || null, background_type: body.background_type || 'image', bgm: body.bgm || '', tagline: body.tagline || '', intro: body.intro || '', greeting: body.greeting || '', persona: body.persona || '', voice_name: body.voice_name || '', voice_speed: body.voice_speed || 1, voice_pitch: body.voice_pitch || 1, category: body.category || '', tags: body.tags || '', is_public: body.is_public ? 1 : 0, nsfw: body.nsfw ? 1 : 0, likes: 0, uses: 0 });
    saveWorld(c.id, body.world); return J({ character: charView(c) });
  }

  // ---------- chat ----------
  if (method === 'GET' && path === '/chat/conversations') { need(); const rows = filter('conversations', c => c.user_id === me.id).map(c => { const ch = find('characters', x => x.id === c.character_id); return { ...c, character_name: ch?.name, character_avatar: ch?.avatar }; }).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')); return J({ conversations: rows }); }
  if (method === 'POST' && path === '/chat/conversations') {
    need(); const ch = find('characters', x => x.id === body.character_id); if (!ch) return E('角色不存在', 404);
    const conv = insert('conversations', { user_id: me.id, character_id: ch.id, title: ch.name, updated_at: now() }); ch.uses++;
    bumpDaily(me.id, 'chat');
    if (ch.greeting) insert('messages', { conversation_id: conv.id, role: 'assistant', content: ch.greeting }); save();
    return J({ conversation: conv });
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)$/))) {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    if (method === 'GET') { if (conv.affinity === undefined) conv.affinity = 0; if (!conv.memories) conv.memories = []; const ch = find('characters', x => x.id === conv.character_id); return J({ conversation: conv, character: ch ? charView(ch) : null, messages: filter('messages', x => x.conversation_id === conv.id) }); }
    if (method === 'PATCH') {
      if (typeof body.title === 'string' && body.title.trim()) conv.title = body.title.trim().slice(0, 60);
      if (body.clear) {
        // wipe the transcript but keep the character greeting as a fresh start
        const ch = find('characters', x => x.id === conv.character_id);
        db.messages = filter('messages', x => x.conversation_id !== conv.id);
        if (ch?.greeting) insert('messages', { conversation_id: conv.id, role: 'assistant', content: ch.greeting });
        conv.affinity = 0;
      }
      conv.updated_at = now(); save();
      return J({ conversation: conv, messages: filter('messages', x => x.conversation_id === conv.id) });
    }
    if (method === 'DELETE') { db.conversations = filter('conversations', c => c.id !== conv.id); db.messages = filter('messages', x => x.conversation_id !== conv.id); save(); return J({ ok: true }); }
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/messages\/(\d+)\/react$/)) && method === 'POST') {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    const msg = find('messages', x => x.id === +m[2] && x.conversation_id === conv.id); if (!msg) return E('消息不存在', 404);
    const r = String(body.reaction || '').slice(0, 8);
    msg.reaction = msg.reaction === r ? '' : r; save();
    return J({ message: msg });
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/complete$/)) && method === 'POST') {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    const ch = find('characters', x => x.id === conv.character_id); const s = find('settings', x => x.user_id === me.id);
    return streamCompletion(conv, ch, s, (body.content || '').trim(), me);
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/regenerate$/)) && method === 'POST') {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    const ch = find('characters', x => x.id === conv.character_id); const s = find('settings', x => x.user_id === me.id);
    const msgs = filter('messages', x => x.conversation_id === conv.id);
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant') { db.messages = filter('messages', x => x.id !== last.id); save(); }
    return streamCompletion(conv, ch, s, '');
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/messages\/(\d+)$/))) {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    const msg = find('messages', x => x.id === +m[2] && x.conversation_id === conv.id); if (!msg) return E('消息不存在', 404);
    if (method === 'PATCH') { const c = (body.content || '').trim(); if (!c) return E('内容不能为空'); msg.content = c; save(); return J({ message: msg }); }
    if (method === 'DELETE') { db.messages = filter('messages', x => x.id !== msg.id); save(); return J({ ok: true }); }
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/memories$/)) && method === 'POST') {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    const c = (body.content || '').trim(); if (!c) return E('记忆内容不能为空');
    if (!conv.memories) conv.memories = [];
    const mid = conv.memories.reduce((mx, x) => Math.max(mx, x.id || 0), 0) + 1;
    conv.memories.push({ id: mid, content: c.slice(0, 300) }); save();
    return J({ memories: conv.memories });
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/memories\/(\d+)$/)) && method === 'DELETE') {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    conv.memories = (conv.memories || []).filter(x => x.id !== +m[2]); save();
    return J({ memories: conv.memories });
  }
  if (method === 'POST' && path === '/chat/tts') {
    need(); const s = find('settings', x => x.user_id === me.id);
    // Attribute the voice spend to the character's creator (for revenue share).
    const ttsRefOwner = body.character_id ? find('characters', x => x.id === +body.character_id)?.owner_id : null;
    // Pick credentials: the user's own voice API (free) takes priority; otherwise
    // fall back to the platform voice service, billed per sentence (VIP discount).
    let vbase, vkey, vmodel, vname, vproto, fee = 0;
    if (s && s.voice_api_key) {
      vbase = s.voice_base_url; vkey = s.voice_api_key; vmodel = s.voice_model; vname = body.voice || s.voice_name; vproto = s.voice_protocol || 'openai';
    } else if (platformVoiceReady()) {
      const pv = platformCfg().voice; vbase = pv.base_url; vkey = platformVoiceKey(); vmodel = pv.model; vname = body.voice || pv.voice_name; vproto = pv.protocol || 'openai';
      fee = featureFee(me, VOICE_FEE);
      if (me.gold < fee) return E(`金币不足，平台语音每句需 ${fee} 金币（当前 ${me.gold}）。可前往钱包签到/兑换金币，或在「设置 → 语音模型」填写自己的语音 API 即可免费朗读。`, 402);
    } else {
      return E('尚未配置语音模型 API，且平台语音服务暂未开启。可在「设置 → 语音模型」填写自己的语音 API。', 503);
    }
    const base = (vbase || '').replace(/\/$/, '');
    const text = (body.text || '').slice(0, 4000);
    const voice = vname;
    const proto = vproto;
    const rate = Math.min(2, Math.max(0.5, Number(body.speed) || 1)); // shared speed tuning
    const pit = Math.min(1.5, Math.max(0.5, Number(body.pitch) || 1)); // shared pitch tuning
    const pitPct = Math.round((pit - 1) * 100);
    const pitSemi = Math.max(-12, Math.min(12, Math.round((pit - 1) * 24)));
    // On a successful audio response, deduct the per-sentence fee (only when using the
    // platform service) and surface the charge + new balance via response headers.
    const finalize = (res) => {
      if (!fee || !res || !res.ok) return res;
      let w; try { w = applyTx(me.id, { kind: 'voice_fee', gold: -fee, memo: `平台语音 · ${text.slice(0, 16)}`, ref_owner: ttsRefOwner }); } catch { return res; }
      const ct = res.headers.get('content-type') || 'audio/mpeg';
      return new Response(res.body, { headers: { 'content-type': ct, 'X-Gold-Fee': String(fee), 'X-Gold-Balance': String(w.gold) } });
    };
    try {
      // Protocol adapters: translate to each vendor's TTS API, return audio/* to the player.
      if (proto === 'baidu') {
        // Baidu 智能云 短文本在线合成. Key = "APIKey:SecretKey". NOTE: Baidu 不开放跨域(CORS)，
        // 纯浏览器静态站无法直连——请在服务端部署版使用，浏览器版请改用「浏览器内置语音」。
        const ci = (vkey || '').indexOf(':'); const ak = ci < 0 ? '' : vkey.slice(0, ci).trim(); const sk = ci < 0 ? '' : vkey.slice(ci + 1).trim();
        if (!ak || !sk) return E('百度语音需在 API Key 处填「API Key:Secret Key」（用英文冒号分隔）', 400);
        const tr = await realFetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(ak)}&client_secret=${encodeURIComponent(sk)}`, { method: 'POST' });
        const td = await tr.json().catch(() => null);
        if (!td?.access_token) return E('百度语音鉴权失败：' + (td?.error_description || td?.error || '请检查 API Key / Secret Key') + '（浏览器版受跨域限制，建议用服务端部署版）', 502);
        const spd = Math.max(0, Math.min(15, Math.round(rate * 5)));
        const pitB = Math.max(0, Math.min(15, Math.round(pit * 5)));
        const form = new URLSearchParams({ tok: td.access_token, tex: text, cuid: 'huanyu', ctp: '1', lan: 'zh', spd: String(spd), pit: String(pitB), vol: '5', per: String(voice || '0'), aue: '3' });
        const up = await realFetch(`${base || 'https://tsn.baidu.com'}/text2audio`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        const ct = up.headers.get('content-type') || '';
        if (!up.ok || ct.includes('json')) { const t = await up.text().catch(() => ''); return E(`百度语音失败：${t.slice(0, 200)}`, 502); }
        return finalize(up);
      }
      if (proto === 'volcano') {
        // 火山引擎语音合成. Key = "AppID:AccessToken", model = cluster, voice = voice_type.
        const ci = (vkey || '').indexOf(':'); const appid = ci < 0 ? '' : vkey.slice(0, ci).trim(); const vtok = ci < 0 ? '' : vkey.slice(ci + 1).trim();
        if (!appid || !vtok) return E('火山语音需在 API Key 处填「AppID:AccessToken」（用英文冒号分隔）', 400);
        const cluster = vmodel || 'volcano_tts';
        const reqid = (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
        const up = await realFetch(`${base || 'https://openspeech.bytedance.com'}/api/v1/tts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer;${vtok}` },
          body: JSON.stringify({ app: { appid, token: vtok, cluster }, user: { uid: 'huanyu' }, audio: { voice_type: voice || 'BV001_streaming', encoding: 'mp3', speed_ratio: rate, volume_ratio: 1, pitch_ratio: pit }, request: { reqid, text, operation: 'query' } })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        const d = await up.json().catch(() => null);
        if (d?.code !== 3000 || !d?.data) return E('火山语音失败：' + (d?.message || JSON.stringify(d || {}).slice(0, 200)), 502);
        const bin = atob(d.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return finalize(new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } }));
      }
      if (proto === 'tencent') {
        // 腾讯云 TTS 需要 TC3 服务端签名且不开放浏览器跨域，纯静态站无法直连——引导到服务端部署版。
        return E('腾讯云语音需服务端 TC3 签名与代理，纯浏览器版无法直连。请使用「服务端部署版」，或在本页改用「浏览器内置语音」。', 501);
      }
      if (proto === 'elevenlabs') {
        // ElevenLabs: POST /v1/text-to-speech/{voice_id}, xi-api-key header, JSON in / mp3 out.
        const vid = voice || '21m00Tcm4TlvDq8ikWAM';
        const up = await realFetch(`${base}/text-to-speech/${encodeURIComponent(vid)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': vkey, Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: vmodel || 'eleven_multilingual_v2' })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        return finalize(up);
      }
      if (proto === 'minimax') {
        // MiniMax T2A v2 (POST /v1/t2a_v2?GroupId=…): GroupId 在 URL 查询串，Bearer 鉴权，
        // 响应 data.audio 为十六进制字符串（显式传 output_format:'hex' 更稳）。
        // GroupId 可来自 Base URL 的 ?GroupId=… 或前缀到密钥上「GroupId:APIKey」。
        let mmRoot = base, mmGid = '', mmKey = (vkey || '').trim();
        const q = base.indexOf('?');
        if (q >= 0) { const p = new URLSearchParams(base.slice(q + 1)); mmGid = p.get('GroupId') || p.get('group_id') || ''; mmRoot = base.slice(0, q).replace(/\/$/, ''); }
        if (!mmGid) { const c = mmKey.indexOf(':'); if (c > 0) { mmGid = mmKey.slice(0, c).trim(); mmKey = mmKey.slice(c + 1).trim(); } }
        if (!mmGid) return E('MiniMax 缺少 GroupId：请在 Base URL 后附 ?GroupId=你的GroupId（或在密钥处填「GroupId:APIKey」）', 400);
        if (!mmKey) return E('MiniMax 缺少 API Key：请在 API Key 处填写 MiniMax 控制台的接口密钥', 400);
        const up = await realFetch(`${mmRoot}/t2a_v2?GroupId=${encodeURIComponent(mmGid)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mmKey}` },
          body: JSON.stringify({
            model: vmodel || 'speech-02-hd', text, stream: false,
            voice_setting: { voice_id: voice || 'male-qn-qingse', speed: rate, vol: 1, pitch: pitSemi },
            audio_setting: { format: 'mp3', sample_rate: 32000, channel: 1, bitrate: 128000 },
            output_format: 'hex',
          })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        const d = await up.json().catch(() => null);
        const bresp = d?.base_resp || {};
        if (bresp.status_code && bresp.status_code !== 0) return E('MiniMax 合成失败：' + (bresp.status_msg || ('status_code=' + bresp.status_code)) + '（请检查 GroupId / APIKey / 模型 / 音色）', 502);
        const hex = d?.data?.audio;
        if (!hex) return E('MiniMax 未返回音频：' + (bresp.status_msg || JSON.stringify(d || {}).slice(0, 200)) + '（请检查 GroupId / APIKey / 音色）', 502);
        const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(h => parseInt(h, 16)));
        return finalize(new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } }));
      }
      if (proto === 'aliyun') {
        // Aliyun Bailian / DashScope Qwen-TTS: returns an audio URL we then fetch.
        const up = await realFetch(`${base}/api/v1/services/aigc/multimodal-generation/generation`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vkey}` },
          body: JSON.stringify({ model: vmodel || 'qwen-tts', input: { text, voice: voice || 'Cherry' } })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        const d = await up.json().catch(() => null);
        const au = d?.output?.audio || {};
        if (au.url) { const ar = await realFetch(au.url); if (!ar.ok) return E('语音音频下载失败', 502); return finalize(ar); }
        if (au.data) { const bin = atob(au.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return finalize(new Response(bytes, { headers: { 'content-type': 'audio/wav' } })); }
        return E('语音服务未返回音频：' + JSON.stringify(d?.output || d?.message || d).slice(0, 200), 502);
      }
      if (proto === 'azure') {
        // Azure Cognitive TTS: SSML in, audio out. Base URL = https://{region}.tts.speech.microsoft.com
        const rPct = Math.round((rate - 1) * 100);
        const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice xml:lang='zh-CN' name='${voice || 'zh-CN-XiaoxiaoNeural'}'><prosody rate='${rPct >= 0 ? '+' : ''}${rPct}%' pitch='${pitPct >= 0 ? '+' : ''}${pitPct}%'>${text.replace(/[<&>]/g, '')}</prosody></voice></speak>`;
        const up = await realFetch(`${base}/cognitiveservices/v1`, {
          method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': vkey, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
          body: ssml
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        return finalize(up);
      }
      if (proto === 'google') {
        // Google Cloud TTS: text:synthesize?key=KEY, base64 audio in JSON.
        const sep = base.includes('?') ? '&' : '?';
        const up = await realFetch(`${base}/v1/text:synthesize${sep}key=${encodeURIComponent(vkey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: { text }, voice: { languageCode: (voice || 'cmn-CN-Wavenet-A').split('-').slice(0, 2).join('-') || 'cmn-CN', name: voice || 'cmn-CN-Wavenet-A' }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate, pitch: pitSemi } })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        const d = await up.json().catch(() => null);
        if (!d?.audioContent) return E('语音服务未返回音频', 502);
        const bin = atob(d.audioContent); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return finalize(new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } }));
      }
      if (proto === 'deepgram') {
        // Deepgram Aura: /v1/speak?model=..., Token auth, audio out.
        const up = await realFetch(`${base}/v1/speak?model=${encodeURIComponent(vmodel || 'aura-asteria-en')}`, {
          method: 'POST', headers: { Authorization: `Token ${vkey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        return finalize(up);
      }
      // Default: OpenAI-compatible /audio/speech (OpenAI / Groq / 硅基流动 / DeepInfra / Lemonfox …)
      const up = await realFetch(base + '/audio/speech', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vkey}` },
        body: JSON.stringify({ model: vmodel, input: text, voice, speed: rate })
      });
      if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
      return finalize(up);
    } catch (e) { return E('语音服务连接失败：' + e.message, 502); }
  }

  // ---------- AI image generation (text-to-image) — billed per image ----------
  if (method === 'POST' && path === '/ai/image') {
    need();
    const cfg = platformCfg().image; const key = platformImageKey();
    if (!platformImageReady()) return E('平台 AI 生图服务尚未开启，请联系管理员在后台配置生图 API。', 503);
    const prompt = (body.prompt || '').trim();
    if (!prompt) return E('请先输入画面描述');
    if (prompt.length > 1500) return E('画面描述过长（上限 1500 字）');
    const fee = featureFee(me, IMAGE_FEE);
    if (me.gold < fee) return E(`金币不足，生成一张图需 ${fee} 金币（当前 ${me.gold}）。可前往钱包签到/兑换金币。`, 402);
    const size = ['1024x1024', '1024x1536', '1536x1024', '512x512', '768x1024', '1024x768'].includes(body.size) ? body.size : (cfg.size || '1024x1024');
    const base = (cfg.base_url || '').replace(/\/$/, '');
    try {
      const up = await realFetch(base + '/images/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: cfg.model, prompt, size, n: 1 })
      });
      if (!up.ok) { const t = await up.text().catch(() => ''); return E(`生图服务返回 ${up.status}：${t.slice(0, 240)}`, 502); }
      const d = await up.json().catch(() => null);
      const item = d?.data?.[0] || {};
      const image = item.b64_json ? 'data:image/png;base64,' + item.b64_json : item.url;
      if (!image) return E('生图服务未返回图片', 502);
      let w; try { w = applyTx(me.id, { kind: 'image_fee', gold: -fee, memo: `AI 生图 · ${prompt.slice(0, 18)}` }); } catch (e) { return E(e.message); }
      const rec = insert('ai_images', { user_id: me.id, prompt, size, url: image });
      return J({ image, id: rec.id, fee, size, prompt, wallet: w });
    } catch (e) { return E('生图服务连接失败：' + e.message + '（可能是服务商的浏览器跨域限制）', 502); }
  }
  if (method === 'GET' && path === '/ai/images') {
    need();
    const rows = filter('ai_images', x => x.user_id === me.id).sort((a, b) => b.id - a.id).slice(0, 60);
    return J({ images: rows, fee: featureFee(me, IMAGE_FEE), base_fee: IMAGE_FEE, ready: platformImageReady() });
  }
  if ((m = P(/^\/ai\/images\/(\d+)$/)) && method === 'DELETE') {
    need(); db.ai_images = filter('ai_images', x => !(x.id === +m[1] && x.user_id === me.id)); save(); return J({ ok: true });
  }

  // ---------- economy ----------
  if (method === 'GET' && path === '/economy/wallet') { need(); return J({ wallet: publicUser(me), transactions: filter('transactions', t => t.user_id === me.id).sort((a, b) => b.id - a.id).slice(0, 50), packages: PACKAGES, rates: { gold_per_diamond: GOLD_PER_DIAMOND, vip_cost: VIP_COST_GOLD, vip_days: VIP_DAYS } }); }
  if (method === 'POST' && path === '/economy/recharge') { need(); const p = PACKAGES.find(x => x.id === body.package_id); if (!p) return E('套餐不存在'); const w = applyTx(me.id, { kind: 'recharge', diamond: p.diamond + p.bonus, memo: `充值 ¥${p.cny} 获得 ${p.diamond + p.bonus} 钻石` }); return J({ wallet: w }); }
  if (method === 'POST' && path === '/economy/exchange') { need(); const n = parseInt(body.diamond, 10); if (!n || n <= 0) return E('请输入有效的钻石数量'); try { return J({ wallet: applyTx(me.id, { kind: 'exchange', diamond: -n, gold: n * GOLD_PER_DIAMOND, memo: `${n} 钻石兑换为 ${n * GOLD_PER_DIAMOND} 金币` }) }); } catch (e) { return E(e.message); } }
  if (method === 'POST' && path === '/economy/vip') { need(); try { applyTx(me.id, { kind: 'vip', gold: -VIP_COST_GOLD, memo: `购买 ${VIP_DAYS} 天 VIP` }); } catch (e) { return E(e.message); } const base = isVip(me) ? new Date(me.vip_until).getTime() : Date.now(); me.vip_until = new Date(base + VIP_DAYS * 86400000).toISOString(); save(); return J({ wallet: publicUser(me) }); }
  if (method === 'POST' && path === '/economy/checkin') {
    need(); const today = new Date().toISOString().slice(0, 10); if (me.last_checkin === today) return E('今天已经签到过啦');
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10); const streak = me.last_checkin === y ? (me.checkin_streak || 0) + 1 : 1;
    // 每日签到金币：50 / 100 / 200，概率 33% / 50% / 17%（VIP 翻倍）
    const roll = Math.random(); let reward = roll < 0.33 ? 50 : roll < 0.83 ? 100 : 200; if (isVip(me)) reward *= 2;
    me.last_checkin = today; me.checkin_streak = streak;
    const w = applyTx(me.id, { kind: 'checkin', gold: reward, memo: `第 ${streak} 天签到` }); bumpDaily(me.id, 'checkin'); return J({ wallet: w, reward, streak });
  }
  if (method === 'POST' && path === '/economy/redeem') { need(); const key = find('invite_keys', k => k.code === String(body.code || '').trim()); if (!key) return E('密钥无效'); if (key.used >= key.max_uses) return E('该密钥已用完'); key.used++; if (key.grant_gold || key.grant_diamond) applyTx(me.id, { kind: 'reward', gold: key.grant_gold, diamond: key.grant_diamond, memo: `兑换码 ${key.code}` }); if (key.grant_vip_days) { const base = isVip(me) ? new Date(me.vip_until).getTime() : Date.now(); me.vip_until = new Date(base + key.grant_vip_days * 86400000).toISOString(); } save(); return J({ wallet: publicUser(me) }); }

  // ---------- scripts ----------
  if (method === 'GET' && path === '/scripts') {
    const cat = search.get('category'), q = (search.get('q') || '').toLowerCase(), sort = search.get('sort');
    let rows = filter('scripts', () => true);
    if (cat && cat !== 'all') rows = rows.filter(s => s.category === cat);
    if (q) rows = rows.filter(s => (s.title + s.tags + s.summary).toLowerCase().includes(q));
    rows = rows.sort((a, b) => sort === 'new' ? b.id - a.id : (b.plays - a.plays) || (b.likes - a.likes)).slice(0, 100);
    return J({ scripts: rows.map(s => ({ ...s, author_name: user(s.author_id)?.display_name, author_avatar: user(s.author_id)?.avatar })) });
  }
  if (method === 'GET' && path === '/scripts/mine') {
    need(); const created = filter('scripts', s => s.author_id === me.id).sort((a, b) => b.id - a.id);
    const purchased = filter('script_purchases', p => p.user_id === me.id).sort((a, b) => b.id - a.id).map(p => { const s = find('scripts', x => x.id === p.script_id); return s && { ...s, bought_at: p.created_at, refunded: p.refunded, paid: p.price }; }).filter(Boolean);
    return J({ created, purchased });
  }
  if ((m = P(/^\/scripts\/(\d+)$/))) {
    const sid = +m[1]; const s = find('scripts', x => x.id === sid);
    if (method === 'GET') { if (!s) return E('剧本不存在', 404); const owns = s.price_gold === 0 || (me && (s.author_id === me.id || find('script_purchases', p => p.script_id === sid && p.user_id === me.id && !p.refunded))); const out = { ...s, author_name: user(s.author_id)?.display_name, author_avatar: user(s.author_id)?.avatar, unlocked: !!owns, purchases: filter('script_purchases', p => p.script_id === sid && !p.refunded).length }; if (!owns) out.content = ''; return J({ script: out }); }
    if (method === 'PUT') { need(); if (!s || s.author_id !== me.id) return E('无权编辑', 403); ['title', 'summary', 'cover', 'content', 'category', 'tags'].forEach(k => { if (body[k] !== undefined) s[k] = body[k]; }); if (body.price_gold !== undefined) s.price_gold = Math.max(0, parseInt(body.price_gold, 10) || 0); s.nsfw = body.nsfw ? 1 : 0; save(); return J({ script: s }); }
    if (method === 'DELETE') { need(); if (!s || s.author_id !== me.id) return E('无权删除', 403); db.scripts = filter('scripts', x => x.id !== sid); save(); return J({ ok: true }); }
  }
  if (method === 'POST' && path === '/scripts') { need(); if (!body.title) return E('标题必填'); const s = insert('scripts', { author_id: me.id, title: body.title, summary: body.summary || '', cover: body.cover || null, content: body.content || '', category: body.category || '', tags: body.tags || '', price_gold: Math.max(0, parseInt(body.price_gold, 10) || 0), nsfw: body.nsfw ? 1 : 0, plays: 0, likes: 0 }); return J({ script: s }); }
  if ((m = P(/^\/scripts\/(\d+)\/buy$/)) && method === 'POST') {
    need(); const s = find('scripts', x => x.id === +m[1]); if (!s) return E('剧本不存在', 404); if (s.author_id === me.id) return E('这是你自己的剧本');
    if (find('script_purchases', p => p.script_id === s.id && p.user_id === me.id && !p.refunded)) return E('你已拥有该剧本');
    if (s.price_gold === 0) { insert('script_purchases', { script_id: s.id, user_id: me.id, price: 0, refunded: 0 }); return J({ ok: true, free: true }); }
    try { applyTx(me.id, { kind: 'buy_script', gold: -s.price_gold, memo: `购买剧本《${s.title}》` }); applyTx(s.author_id, { kind: 'sell_script', gold: s.price_gold, memo: `售出剧本《${s.title}》` }); insert('script_purchases', { script_id: s.id, user_id: me.id, price: s.price_gold, refunded: 0 }); s.plays++; save(); notify(s.author_id, `有人购买了你的剧本《${s.title}》，+${s.price_gold} 金币 `); return J({ ok: true, refundable_until: Date.now() + 1800000 }); } catch (e) { return E(e.message); }
  }
  if ((m = P(/^\/scripts\/(\d+)\/play$/)) && method === 'POST') {
    need(); const sid = +m[1]; const s = find('scripts', x => x.id === sid); if (!s) return E('剧本不存在', 404);
    const owns = s.price_gold === 0 || s.author_id === me.id || find('script_purchases', p => p.script_id === sid && p.user_id === me.id && !p.refunded);
    if (!owns) return E('请先解锁该剧本再开始扮演', 403);
    // Reuse a hidden script-runner character per user+script, else create one seeded from the script.
    let ch = find('characters', x => x.owner_id === me.id && x.from_script === sid);
    if (!ch) {
      const persona = `你是互动剧本《${s.title}》的主持人(GM)兼剧中所有角色与旁白的扮演者。\n【剧本设定】\n${s.content || s.summary}\n\n请基于以上设定，以沉浸式第一人称推进剧情：扮演剧中登场的角色与旁白，描写场景与氛围，引导玩家在关键处做出选择。每次回复简洁有画面感（2-4 句），并在合适时给出 2-3 个可选的行动方向。始终保持在剧本世界观内，不要跳出角色。`;
      ch = insert('characters', { owner_id: me.id, name: s.title, avatar: s.cover || null, background: s.cover || null, background_type: 'image', tagline: s.summary || '', intro: s.summary || '', greeting: `*【${s.title}】*\n\n${(s.content || s.summary || '').split('\n')[0]}\n\n（你想如何开始？）`, persona, category: s.category || '', tags: s.tags || '', is_public: 0, nsfw: s.nsfw || 0, likes: 0, uses: 0, from_script: sid });
    }
    const conv = insert('conversations', { user_id: me.id, character_id: ch.id, title: s.title, updated_at: now() }); ch.uses++;
    if (ch.greeting) insert('messages', { conversation_id: conv.id, role: 'assistant', content: ch.greeting });
    if (s.author_id !== me.id) s.plays++;
    save();
    return J({ conversation: conv });
  }
  if ((m = P(/^\/scripts\/(\d+)\/refund$/)) && method === 'POST') {
    need(); const sid = +m[1]; const p = filter('script_purchases', x => x.script_id === sid && x.user_id === me.id && !x.refunded).sort((a, b) => b.id - a.id)[0];
    if (!p) return E('未找到可退款的购买记录', 404); if (p.price === 0) return E('免费剧本无需退款');
    if (Date.now() - new Date(p.created_at.replace(' ', 'T') + 'Z').getTime() > 1800000) return E('已超过 30 分钟退款时限');
    const s = find('scripts', x => x.id === sid); applyTx(me.id, { kind: 'refund', gold: p.price, memo: `退款剧本《${s.title}》` }); applyTx(s.author_id, { kind: 'refund', gold: -p.price, memo: `剧本《${s.title}》被退款` }); p.refunded = 1; save(); return J({ ok: true });
  }
  if ((m = P(/^\/scripts\/(\d+)\/like$/)) && method === 'POST') { const s = find('scripts', x => x.id === +m[1]); if (s) { s.likes++; save(); } return J({ ok: true }); }

  // ---------- social ----------
  if (method === 'GET' && path === '/social/moments') {
    let rows = filter('moments', () => true);
    if (search.get('scope') === 'following' && me) { const ids = filter('follows', f => f.follower_id === me.id).map(f => f.following_id); rows = rows.filter(r => ids.includes(r.user_id)); }
    rows = rows.sort((a, b) => b.id - a.id).map(mm => ({ ...mm, author_name: user(mm.user_id)?.display_name, author_avatar: user(mm.user_id)?.avatar, comment_count: filter('comments', c => c.moment_id === mm.id).length, liked: me ? !!find('moment_likes', l => l.moment_id === mm.id && l.user_id === me.id) : false }));
    return J({ moments: rows });
  }
  if (method === 'POST' && path === '/social/moments') { need(); if (!body.text && !body.image) return E('说点什么或配张图吧'); return J({ moment: insert('moments', { user_id: me.id, text: body.text || '', image: body.image || null, likes: 0 }) }); }
  if ((m = P(/^\/social\/moments\/(\d+)$/)) && method === 'DELETE') { need(); const mm = find('moments', x => x.id === +m[1]); if (!mm || mm.user_id !== me.id) return E('无权删除', 403); db.moments = filter('moments', x => x.id !== mm.id); save(); return J({ ok: true }); }
  if ((m = P(/^\/social\/moments\/(\d+)\/like$/)) && method === 'POST') { need(); const mm = find('moments', x => x.id === +m[1]); if (!mm) return E('动态不存在', 404); const ex = find('moment_likes', l => l.moment_id === mm.id && l.user_id === me.id); if (ex) { db.moment_likes = filter('moment_likes', l => !(l.moment_id === mm.id && l.user_id === me.id)); mm.likes = Math.max(0, mm.likes - 1); save(); return J({ liked: false, likes: mm.likes }); } insert('moment_likes', { moment_id: mm.id, user_id: me.id }); mm.likes++; bumpDaily(me.id, 'like'); save(); if (mm.user_id !== me.id) notify(mm.user_id, `${me.display_name} 赞了你的动态`, '/community'); return J({ liked: true, likes: mm.likes }); }
  if ((m = P(/^\/social\/moments\/(\d+)\/comments$/))) {
    const mid = +m[1];
    if (method === 'GET') return J({ comments: filter('comments', c => c.moment_id === mid).map(c => ({ ...c, author_name: user(c.user_id)?.display_name, author_avatar: user(c.user_id)?.avatar })) });
    if (method === 'POST') { need(); if (!body.text) return E('评论不能为空'); const mm = find('moments', x => x.id === mid); const c = insert('comments', { moment_id: mid, user_id: me.id, text: body.text }); if (mm && mm.user_id !== me.id) notify(mm.user_id, `${me.display_name} 评论了你的动态：${body.text.slice(0, 20)}`, '/community'); return J({ comment: { ...c, author_name: me.display_name, author_avatar: me.avatar } }); }
  }
  if (method === 'GET' && path === '/social/suggested') {
    need(); const followed = new Set(filter('follows', f => f.follower_id === me.id).map(f => f.following_id));
    const rows = filter('users', u => u.id !== me.id && !u.is_banned && !followed.has(u.id)).map(u => ({
      id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, bio: u.bio,
      followers: filter('follows', f => f.following_id === u.id).length,
      chars: filter('characters', c => c.owner_id === u.id && c.is_public).length
    })).sort((a, b) => (b.followers - a.followers) || (b.chars - a.chars)).slice(0, 8);
    return J({ users: rows });
  }
  if ((m = P(/^\/social\/follow\/(\d+)$/)) && method === 'POST') { need(); const tid = +m[1]; if (tid === me.id) return E('不能关注自己'); const ex = find('follows', f => f.follower_id === me.id && f.following_id === tid); if (ex) { db.follows = filter('follows', f => !(f.follower_id === me.id && f.following_id === tid)); save(); return J({ following: false }); } insert('follows', { follower_id: me.id, following_id: tid }); notify(tid, `${me.display_name} 关注了你`, '/user/' + me.id); return J({ following: true }); }
  // ---------- presence ----------
  if (method === 'POST' && path === '/social/heartbeat') { need(); me.last_active = Date.now(); save(); return J({ ok: true }); }

  // ---------- friends ----------
  if (path === '/friends' && method === 'GET') {
    need();
    const rows = friendIds(me.id).map(id => {
      const u = user(id); if (!u) return null;
      const msgs = dmThreadOf(me.id, id); const last = msgs.sort((a, b) => b.id - a.id)[0];
      const unread = msgs.filter(d => d.from_id === id && !d.read).length;
      return { id: u.id, display_name: u.display_name, avatar: u.avatar, online: isOnline(u), creator_tier: creatorTier(u), is_councilor: !!u.is_councilor, verified: !!u.verified, last_message: last ? { text: last.text.slice(0, 44), at: last.created_at, mine: last.from_id === me.id } : null, unread };
    }).filter(Boolean).sort((a, b) => (b.unread - a.unread) || (b.online - a.online) || ((b.last_message?.at || '').localeCompare(a.last_message?.at || '')));
    return J({ friends: rows, count: rows.length });
  }
  if (path === '/friends/requests' && method === 'GET') {
    need();
    const incoming = filter('friend_requests', r => r.to_id === me.id && r.status === 'pending').map(r => { const u = user(r.from_id); return u && { req_id: r.id, id: u.id, display_name: u.display_name, avatar: u.avatar, creator_tier: creatorTier(u), bio: u.bio || '', at: r.created_at }; }).filter(Boolean).reverse();
    const outgoing = filter('friend_requests', r => r.from_id === me.id && r.status === 'pending').map(r => { const u = user(r.to_id); return u && { req_id: r.id, id: u.id, display_name: u.display_name, avatar: u.avatar }; }).filter(Boolean).reverse();
    return J({ incoming, outgoing });
  }
  if ((m = P(/^\/friends\/request\/(\d+)$/)) && method === 'POST') {
    need(); const tid = +m[1]; if (tid === me.id) return E('不能添加自己为好友'); const target = user(tid); if (!target) return E('用户不存在', 404);
    if (areFriends(me.id, tid)) return E('你们已经是好友了');
    const incoming = find('friend_requests', r => r.from_id === tid && r.to_id === me.id && r.status === 'pending');
    if (incoming) { incoming.status = 'accepted'; const [a, b] = pairKey(me.id, tid); insert('friendships', { a_id: a, b_id: b }); save(); notify(tid, `${me.display_name} 接受了你的好友申请 🎉`, '/friends'); return J({ state: 'friends' }); }
    if (find('friend_requests', r => r.from_id === me.id && r.to_id === tid && r.status === 'pending')) return E('已发送过好友申请，等待对方通过');
    insert('friend_requests', { from_id: me.id, to_id: tid, status: 'pending' });
    notify(tid, `${me.display_name} 申请加你为好友`, '/friends');
    return J({ state: 'pending_out' });
  }
  if ((m = P(/^\/friends\/requests\/(\d+)\/(accept|reject)$/)) && method === 'POST') {
    need(); const r = find('friend_requests', x => x.id === +m[1]); if (!r || r.to_id !== me.id) return E('申请不存在', 404); if (r.status !== 'pending') return E('该申请已处理');
    if (m[2] === 'accept') { r.status = 'accepted'; if (!areFriends(me.id, r.from_id)) { const [a, b] = pairKey(me.id, r.from_id); insert('friendships', { a_id: a, b_id: b }); } save(); notify(r.from_id, `${me.display_name} 通过了你的好友申请，开始聊天吧～`, '/friends'); return J({ ok: true, state: 'friends' }); }
    r.status = 'rejected'; save(); return J({ ok: true, state: 'none' });
  }
  if ((m = P(/^\/friends\/(\d+)$/)) && method === 'DELETE') {
    need(); const tid = +m[1]; const [a, b] = pairKey(me.id, tid);
    db.friendships = filter('friendships', f => !(f.a_id === a && f.b_id === b));
    db.friend_requests = filter('friend_requests', r => !((r.from_id === me.id && r.to_id === tid) || (r.from_id === tid && r.to_id === me.id)));
    save(); return J({ ok: true });
  }
  if ((m = P(/^\/friends\/state\/(\d+)$/)) && method === 'GET') {
    need(); const tid = +m[1]; const t = user(tid);
    return J({ state: friendState(me, tid), can_dm: t ? dmAllowed(me, t) : false, online: isOnline(t) });
  }

  // ---------- direct messages ----------
  if (path === '/dm' && method === 'GET') {
    need(); const partners = new Set();
    filter('dm_messages', d => d.from_id === me.id || d.to_id === me.id).forEach(d => partners.add(d.from_id === me.id ? d.to_id : d.from_id));
    const rows = [...partners].map(id => { const u = user(id); if (!u) return null; const msgs = dmThreadOf(me.id, id); const last = msgs.sort((a, b) => b.id - a.id)[0]; const unread = msgs.filter(d => d.from_id === id && !d.read).length; return { id: u.id, display_name: u.display_name, avatar: u.avatar, online: isOnline(u), friend: areFriends(me.id, id), last_message: last ? { text: last.text.slice(0, 50), at: last.created_at, mine: last.from_id === me.id } : null, unread }; }).filter(Boolean).sort((a, b) => (b.last_message?.at || '').localeCompare(a.last_message?.at || ''));
    return J({ threads: rows, unread_total: rows.reduce((s, r) => s + r.unread, 0) });
  }
  if ((m = P(/^\/dm\/(\d+)$/))) {
    need(); const tid = +m[1]; const target = user(tid); if (!target) return E('用户不存在', 404);
    if (method === 'GET') {
      const msgs = dmThreadOf(me.id, tid).sort((a, b) => a.id - b.id);
      let changed = false; msgs.forEach(d => { if (d.to_id === me.id && !d.read) { d.read = 1; changed = true; } }); if (changed) save();
      return J({ messages: msgs.map(d => ({ id: d.id, from_id: d.from_id, text: d.text, created_at: d.created_at, mine: d.from_id === me.id })), peer: { id: target.id, display_name: target.display_name, avatar: target.avatar, online: isOnline(target), creator_tier: creatorTier(target), is_councilor: !!target.is_councilor, verified: !!target.verified }, can_dm: dmAllowed(me, target), friend: areFriends(me.id, tid) });
    }
    if (method === 'POST') {
      const text = String(body.text || '').trim(); if (!text) return E('消息不能为空');
      if (!dmAllowed(me, target)) return E('对方的隐私设置不允许你私信，需先成为好友或关注', 403);
      const msg = insert('dm_messages', { from_id: me.id, to_id: tid, text: text.slice(0, 2000), read: 0 });
      notify(tid, `${me.display_name} 发来私信：${text.slice(0, 24)}`, '/friends');
      return J({ message: { id: msg.id, from_id: me.id, text: msg.text, created_at: msg.created_at, mine: true } });
    }
  }

  if (method === 'GET' && path === '/social/notifications') { need(); const rows = filter('notifications', n => n.user_id === me.id).sort((a, b) => b.id - a.id).slice(0, 50); return J({ notifications: rows, unread: rows.filter(n => !n.read).length }); }
  if (method === 'POST' && path === '/social/notifications/read') { need(); filter('notifications', n => n.user_id === me.id).forEach(n => (n.read = 1)); save(); return J({ ok: true }); }

  // ---------- users ----------
  if (method === 'GET' && path === '/users/search') {
    const q = (search.get('q') || '').trim();
    if (!q) return J({ users: [] });
    let rows;
    if (/^\d+$/.test(q)) { const u = user(+q); rows = u ? [u] : []; }
    else { const k = q.toLowerCase(); rows = filter('users', u => (u.username + (u.display_name || '')).toLowerCase().includes(k)).slice(0, 30); }
    return J({ users: rows.map(u => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, bio: u.bio })) });
  }
  if ((m = P(/^\/users\/(\d+)\/(followers|following)$/)) && method === 'GET') {
    const uid = +m[1]; const kind = m[2];
    const ids = kind === 'followers'
      ? filter('follows', f => f.following_id === uid).map(f => f.follower_id)
      : filter('follows', f => f.follower_id === uid).map(f => f.following_id);
    const users = ids.map(i => { const u = user(i); return u && !u.is_banned ? {
      id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, bio: u.bio,
      vip: isVip(u), svip: !!u.svip, verified: !!u.verified,
      following: me ? !!find('follows', f => f.follower_id === me.id && f.following_id === u.id) : false
    } : null; }).filter(Boolean).reverse();
    return J({ users });
  }
  if ((m = P(/^\/users\/(\d+)$/)) && method === 'GET') {
    const u = user(+m[1]); if (!u) return E('用户不存在', 404);
    const characters = filter('characters', c => c.owner_id === u.id && c.is_public).sort((a, b) => b.id - a.id);
    const scripts = filter('scripts', s => s.author_id === u.id).sort((a, b) => b.id - a.id);
    const moments = filter('moments', x => x.user_id === u.id).sort((a, b) => b.id - a.id).slice(0, 20);
    const stats = { characters: filter('characters', c => c.owner_id === u.id).length, scripts: scripts.length, followers: filter('follows', f => f.following_id === u.id).length, following: filter('follows', f => f.follower_id === u.id).length, achievements: achUnlockedCount(u) };
    const following = me ? !!find('follows', f => f.follower_id === me.id && f.following_id === u.id) : false;
    return J({ user: { id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, banner: u.banner, bio: u.bio, vip: isVip(u), vip_until: u.vip_until, is_gm: !!u.is_gm, svip: !!u.svip, verified: !!u.verified, verified_note: u.verified_note || '', is_councilor: !!u.is_councilor, creator_tier: creatorTier(u), created_at: u.created_at }, characters, scripts, moments, stats, following });
  }

  // ---------- groups ----------
  if (method === 'GET' && path === '/groups') { need(); const rows = filter('groups', g => g.is_public || g.owner_id === me.id).sort((a, b) => b.id - a.id).map(g => ({ ...g, owner_name: user(g.owner_id)?.display_name, member_count: filter('group_members', x => x.group_id === g.id).length, joined: find('group_members', x => x.group_id === g.id && x.user_id === me.id) ? 1 : 0 })); return J({ groups: rows }); }
  if (method === 'POST' && path === '/groups') { need(); if (!body.name) return E('群名称必填'); const g = insert('groups', { name: body.name, owner_id: me.id, avatar: body.avatar || null, description: body.description || '', is_public: body.is_public === false ? 0 : 1 }); insert('group_members', { group_id: g.id, user_id: me.id, role: 'owner' }); return J({ group: g }); }
  if ((m = P(/^\/groups\/(\d+)\/join$/)) && method === 'POST') { need(); const gid = +m[1]; if (!find('group_members', x => x.group_id === gid && x.user_id === me.id)) insert('group_members', { group_id: gid, user_id: me.id, role: 'member' }); return J({ ok: true }); }
  if ((m = P(/^\/groups\/(\d+)\/leave$/)) && method === 'POST') { need(); const gid = +m[1]; const g = find('groups', x => x.id === gid); if (g && g.owner_id === me.id) return E('群主不能退出，请先转让或解散', 400); db.group_members = filter('group_members', x => !(x.group_id === gid && x.user_id === me.id)); save(); return J({ ok: true }); }
  if ((m = P(/^\/groups\/(\d+)\/messages$/))) {
    const gid = +m[1];
    if (method === 'GET') { const after = parseInt(search.get('after'), 10) || 0; return J({ messages: filter('group_messages', x => x.group_id === gid && x.id > after).map(x => ({ ...x, display_name: user(x.user_id)?.display_name, avatar: user(x.user_id)?.avatar })) }); }
    if (method === 'POST') { need(); if (!find('group_members', x => x.group_id === gid && x.user_id === me.id)) insert('group_members', { group_id: gid, user_id: me.id, role: 'member' }); if (!body.content) return E('消息不能为空'); const msg = insert('group_messages', { group_id: gid, user_id: me.id, content: body.content }); return J({ message: { ...msg, display_name: me.display_name, avatar: me.avatar } }); }
  }
  if ((m = P(/^\/groups\/(\d+)$/)) && method === 'GET') { need(); const g = find('groups', x => x.id === +m[1]); if (!g) return E('群不存在', 404); const members = filter('group_members', x => x.group_id === g.id).map(x => ({ ...user(x.user_id) && { id: x.user_id, display_name: user(x.user_id).display_name, avatar: user(x.user_id).avatar }, role: x.role })); const messages = filter('group_messages', x => x.group_id === g.id).slice(-80).map(x => ({ ...x, display_name: user(x.user_id)?.display_name, avatar: user(x.user_id)?.avatar })); return J({ group: { ...g, owner_name: user(g.owner_id)?.display_name }, members, messages, joined: !!find('group_members', x => x.group_id === g.id && x.user_id === me.id) }); }

  // ---------- theater ----------
  // 舞台设定（互动小说背景系统）收敛器：与服务端 routes/theater.js 的 cleanStage 等价。
  const cleanStage = (raw) => {
    let c = raw; if (typeof raw === 'string') { try { c = JSON.parse(raw); } catch { c = {}; } }
    if (!c || typeof c !== 'object') c = {};
    const charBg = {};
    if (c.charBg && typeof c.charBg === 'object') for (const [k, v] of Object.entries(c.charBg)) { if (/^\d+$/.test(String(k)) && typeof v === 'string' && v && v.length < 2000) charBg[k] = v; }
    const scenes = (Array.isArray(c.scenes) ? c.scenes : []).slice(0, 30).map(s => ({ name: String((s && s.name) || '').slice(0, 40), keys: String((s && s.keys) || '').slice(0, 300), image: typeof (s && s.image) === 'string' ? s.image.slice(0, 2000) : '' })).filter(s => s.image && s.keys);
    return { charAuto: c.charAuto !== false, charBg, scenes };
  };
  // 互动小说专属世界书收敛器：与服务端 cleanWorld 等价。
  const cleanWorld = (raw) => {
    let arr = raw; if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    return arr.slice(0, 60).map(e => ({ keys: String((e && e.keys) || '').slice(0, 200), content: String((e && e.content) || '').slice(0, 2000), always: !!(e && e.always) })).filter(e => e.content.trim());
  };
  // 生成一段续写（旁白 / 角色）含世界书注入。excludeId 用于「重写」排除被替换的那段。
  const genTheaterReply = async (t, s, body, excludeId) => {
    const cast = filter('theater_cast', x => x.theater_id === t.id).map(x => find('characters', c => c.id === x.character_id)).filter(Boolean);
    let transcript = filter('theater_messages', x => x.theater_id === t.id);
    if (excludeId) transcript = transcript.filter(x => x.id !== excludeId);
    transcript = transcript.slice(-30);
    const log = transcript.map(x => `${x.name}：${x.content}`).join('\n');
    const castList = cast.map(c => `「${c.name}」(${c.tagline || '登场角色'})`).join('、');
    let target, system;
    if (body.narrator) { target = { id: null, name: '旁白', avatar: null }; system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。你是「旁白」，请用富有画面感的第三人称，推进剧情、描写环境氛围或引出转折，控制在 2-4 句话，不要替具体角色说出对白。`; }
    else { const c = cast.find(x => x.id === body.character_id) || cast[0]; if (!c) throw new Error('剧场没有 AI 角色'); target = c; system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。\n你现在只扮演其中的「${c.name}」。${c.persona || c.intro || ''}\n请严格以「${c.name}」的身份，根据下面的剧情进展生成一段符合人设的台词与动作（可含 *动作描写*），只说这一个角色的内容，不要替玩家或其他角色发言，控制在 1-3 句。`; }
    const hay = transcript.slice(-12).map(x => (x.content || '')).join('\n').toLowerCase();
    const sk = (str) => String(str || '').split(/[，,]/).map(k => k.trim().toLowerCase()).filter(Boolean);
    const wbCharIds = body.narrator ? cast.map(c => c.id) : [target.id].filter(v => v != null);
    const entries = [...cleanWorld(t.worldbook)];
    filter('world_entries', w => wbCharIds.includes(w.character_id) && w.enabled).forEach(w => entries.push({ keys: w.keys, content: w.content }));
    const hits = [];
    for (const e of entries) { const keys = sk(e.keys); if ((e.always || keys.length === 0 || keys.some(k => hay.includes(k))) && e.content) hits.push(e.content.trim()); }
    const uniq = [...new Set(hits)].filter(Boolean);
    if (uniq.length) system += '\n\n【世界设定（务必遵守，可自然融入叙述，但不要直接复述原文）】\n' + uniq.join('\n---\n').slice(0, 4000);
    const content = await llmOnce(s, system, `【当前剧情】\n${log || '（剧情刚刚开始）'}\n\n请继续：`);
    if (!content) throw new Error('模型未返回内容');
    return { target, content, narrator: !!body.narrator };
  };
  if (method === 'GET' && path === '/theater') { need(); const rows = filter('theaters', t => t.is_public || t.owner_id === me.id).sort((a, b) => b.id - a.id).map(t => ({ ...t, owner_name: user(t.owner_id)?.display_name, member_count: filter('theater_members', x => x.theater_id === t.id).length, cast_count: filter('theater_cast', x => x.theater_id === t.id).length })); return J({ theaters: rows }); }
  if (method === 'POST' && path === '/theater') { need(); if (!body.name) return E('剧场名称必填'); if (!Array.isArray(body.cast) || !body.cast.length) return E('请至少选择一位 AI 角色登场'); const t = insert('theaters', { name: body.name, owner_id: me.id, scene: body.scene || '', cover: body.cover || null, is_public: body.is_public === false ? 0 : 1, stage_config: cleanStage(body.stage_config), worldbook: cleanWorld(body.worldbook) }); insert('theater_members', { theater_id: t.id, user_id: me.id }); body.cast.forEach(cid => { if (!find('theater_cast', x => x.theater_id === t.id && x.character_id === cid)) insert('theater_cast', { theater_id: t.id, character_id: cid }); }); if (body.scene) insert('theater_messages', { theater_id: t.id, sender_type: 'narrator', sender_id: null, name: '旁白', avatar: null, content: body.scene }); return J({ theater: t }); }
  if ((m = P(/^\/theater\/(\d+)\/join$/)) && method === 'POST') { need(); const tid = +m[1]; if (!find('theater_members', x => x.theater_id === tid && x.user_id === me.id)) insert('theater_members', { theater_id: tid, user_id: me.id }); return J({ ok: true }); }
  if ((m = P(/^\/theater\/(\d+)\/leave$/)) && method === 'POST') { need(); const tid = +m[1]; const t = find('theaters', x => x.id === tid); if (t && t.owner_id === me.id) return E('房主不能退出，请先解散剧场', 400); db.theater_members = filter('theater_members', x => !(x.theater_id === tid && x.user_id === me.id)); save(); return J({ ok: true }); }
  if ((m = P(/^\/theater\/(\d+)\/say$/)) && method === 'POST') { need(); const tid = +m[1]; if (!body.content) return E('内容不能为空'); if (!find('theater_members', x => x.theater_id === tid && x.user_id === me.id)) insert('theater_members', { theater_id: tid, user_id: me.id }); const msg = insert('theater_messages', { theater_id: tid, sender_type: 'user', sender_id: me.id, name: me.display_name, avatar: me.avatar, content: body.content }); return J({ message: msg }); }
  if ((m = P(/^\/theater\/(\d+)\/act$/)) && method === 'POST') {
    need(); const tid = +m[1]; const t = find('theaters', x => x.id === tid); if (!t) return E('剧场不存在', 404);
    const s = find('settings', x => x.user_id === me.id);
    const eff = effectiveLLM(s);
    if (eff.platform) { const fee = platformFee(me, 0); if (me.gold < fee) return E(`金币不足，剧场联机平台 AI 需 ${fee} 金币（当前 ${me.gold}）`); }
    try {
      const { target, content, narrator } = await genTheaterReply(t, s, body, null);
      const msg = insert('theater_messages', { theater_id: tid, sender_type: narrator ? 'narrator' : 'ai', sender_id: target.id, name: target.name, avatar: target.avatar, content });
      if (eff.platform) { try { applyTx(me.id, { kind: 'ai_fee', gold: -platformFee(me, 0), memo: '平台 AI · 剧场联机' }); } catch { /* */ } }
      return J({ message: msg });
    } catch (e) { return E(e.message, 502); }
  }
  if ((m = P(/^\/theater\/(\d+)\/retry$/)) && method === 'POST') {
    need(); const tid = +m[1]; const t = find('theaters', x => x.id === tid); if (!t) return E('剧场不存在', 404);
    if (t.owner_id !== me.id && !find('theater_members', x => x.theater_id === tid && x.user_id === me.id)) return E('请先加入该剧场', 403);
    const s = find('settings', x => x.user_id === me.id);
    const eff = effectiveLLM(s);
    if (eff.platform) { const fee = platformFee(me, 0); if (me.gold < fee) return E(`金币不足，剧场联机平台 AI 需 ${fee} 金币（当前 ${me.gold}）`); }
    const msgs = filter('theater_messages', x => x.theater_id === tid);
    const last = msgs[msgs.length - 1];
    if (!last || (last.sender_type !== 'ai' && last.sender_type !== 'narrator')) return E('最近一段不是 AI 续写，无法重写', 400);
    const body2 = last.sender_type === 'narrator' ? { narrator: true } : { character_id: last.sender_id };
    try {
      const { target, content, narrator } = await genTheaterReply(t, s, body2, last.id);
      db.theater_messages = filter('theater_messages', x => x.id !== last.id);
      const msg = insert('theater_messages', { theater_id: tid, sender_type: narrator ? 'narrator' : 'ai', sender_id: target.id, name: target.name, avatar: target.avatar, content });
      if (eff.platform) { try { applyTx(me.id, { kind: 'ai_fee', gold: -platformFee(me, 0), memo: '平台 AI · 剧场重写' }); } catch { /* */ } }
      save();
      return J({ removedId: last.id, message: msg });
    } catch (e) { return E(e.message, 502); }
  }
  if ((m = P(/^\/theater\/(\d+)\/messages$/)) && method === 'GET') { const tid = +m[1]; const after = parseInt(search.get('after'), 10) || 0; return J({ messages: filter('theater_messages', x => x.theater_id === tid && x.id > after) }); }
  if ((m = P(/^\/theater\/(\d+)$/)) && method === 'PATCH') { need(); const t = find('theaters', x => x.id === +m[1]); if (!t) return E('剧场不存在', 404); if (t.owner_id !== me.id) return E('仅作者可修改舞台设定', 403); if (body.stage_config !== undefined) t.stage_config = cleanStage(body.stage_config); if (body.worldbook !== undefined) t.worldbook = cleanWorld(body.worldbook); if (typeof body.name === 'string' && body.name.trim()) t.name = body.name.trim().slice(0, 80); if (typeof body.scene === 'string') t.scene = body.scene.slice(0, 4000); if (body.cover !== undefined) t.cover = body.cover || null; save(); return J({ theater: { ...t, stage_config: cleanStage(t.stage_config), worldbook: cleanWorld(t.worldbook) } }); }
  if ((m = P(/^\/theater\/(\d+)$/)) && method === 'GET') { need(); const t = find('theaters', x => x.id === +m[1]); if (!t) return E('剧场不存在', 404); const cast = filter('theater_cast', x => x.theater_id === t.id).map(x => find('characters', c => c.id === x.character_id)).filter(Boolean); const members = filter('theater_members', x => x.theater_id === t.id).map(x => ({ id: x.user_id, display_name: user(x.user_id)?.display_name, avatar: user(x.user_id)?.avatar })); const messages = filter('theater_messages', x => x.theater_id === t.id); return J({ theater: { ...t, owner_name: user(t.owner_id)?.display_name, stage_config: cleanStage(t.stage_config), worldbook: t.owner_id === me.id ? cleanWorld(t.worldbook) : undefined }, cast, members, messages, joined: !!find('theater_members', x => x.theater_id === t.id && x.user_id === me.id) }); }

  // ---------- community (cards / inbox) ----------
  if ((m = P(/^\/community\/publish-character\/(\d+)$/)) && method === 'POST') { need(); const c = find('characters', x => x.id === +m[1]); if (!c || c.owner_id !== me.id) return E('无权发布', 403); c.is_public = 1; save(); return J({ ok: true }); }
  if (method === 'GET' && path === '/community/inbox') { need(); return J({ shares: [] }); }
  if (method === 'POST' && path === '/community/inbox/seen') { return J({ ok: true }); }

  // ---------- engagement: views / reviews / reports / leaderboard ----------
  if (method === 'POST' && path === '/engage/track') { need(); const a = String(body.action || ''); if (['gacha', 'chat', 'fav', 'like', 'checkin'].includes(a)) bumpDaily(me.id, a); return J({ ok: true }); }
  if (method === 'GET' && path === '/engage/tasks') {
    need(); const d = dailyOf(me.id);
    const tasks = DAILY_TASKS.map(t => { const cnt = d.counts[t.key] || 0; return { id: t.id, name: t.name, target: t.target, reward: t.reward, progress: Math.min(cnt, t.target), done: cnt >= t.target, claimed: d.claimed.includes(t.id) }; });
    return J({ tasks, all_claimed: tasks.every(t => t.claimed), claimable: tasks.filter(t => t.done && !t.claimed).length });
  }
  if ((m = P(/^\/engage\/tasks\/([a-z]+)\/claim$/)) && method === 'POST') {
    need(); const t = DAILY_TASKS.find(x => x.id === m[1]); if (!t) return E('任务不存在', 404);
    const d = dailyOf(me.id); const cnt = d.counts[t.key] || 0;
    if (cnt < t.target) return E('任务尚未完成'); if (d.claimed.includes(t.id)) return E('该奖励已领取');
    d.claimed.push(t.id); applyTx(me.id, { kind: 'reward', gold: t.reward, memo: `每日任务：${t.name}` }); save();
    return J({ ok: true, reward: t.reward });
  }
  // ---------- achievements (成就) ----------
  if (path === '/achievements' && method === 'GET') {
    need(); const claimed = me.ach_claimed || [];
    const list = ACHIEVEMENTS.map(a => { const raw = achMetric(me, a.metric); const unlocked = raw >= a.goal; return { id: a.id, name: a.name, desc: a.desc, icon: a.icon, cat: a.cat, goal: a.goal, reward: a.reward, link: a.link, value: Math.min(raw, a.goal), unlocked, claimed: claimed.includes(a.id), claimable: unlocked && !claimed.includes(a.id) }; });
    return J({ achievements: list, summary: { unlocked: list.filter(x => x.unlocked).length, total: list.length, claimable: list.filter(x => x.claimable).length, gold_pending: list.filter(x => x.claimable).reduce((s, x) => s + x.reward, 0) } });
  }
  if ((m = P(/^\/achievements\/([\w-]+)\/claim$/)) && method === 'POST') {
    need(); const a = ACHIEVEMENTS.find(x => x.id === m[1]); if (!a) return E('成就不存在', 404);
    me.ach_claimed = me.ach_claimed || [];
    if (me.ach_claimed.includes(a.id)) return E('该成就奖励已领取');
    if (achMetric(me, a.metric) < a.goal) return E('成就尚未达成');
    me.ach_claimed.push(a.id); applyTx(me.id, { kind: 'achievement', gold: a.reward, memo: `成就奖励 · ${a.name}` }); save();
    notify(me.id, `🏆 达成成就「${a.name}」，奖励 ${a.reward} 金币已入账！`, '/achievements');
    return J({ ok: true, reward: a.reward, gold: me.gold });
  }

  if (method === 'GET' && path === '/engage/events') {
    const claims = me ? filter('event_claims', c => c.user_id === me.id).map(c => c.event_id) : [];
    return J({ events: EVENTS.map(e => ({ id: e.id, kind: e.kind, tag: e.tag, title: e.title, desc: e.desc, reward: e.reward || null, link: e.link || '', linkText: e.linkText || '', accent: e.accent, qq: e.qq || '', claimed: claims.includes(e.id) })) });
  }
  if ((m = P(/^\/engage\/events\/([\w-]+)\/claim$/)) && method === 'POST') {
    need(); const ev = EVENTS.find(e => e.id === m[1]); if (!ev || ev.kind !== 'claim') return E('该活动无可领取奖励');
    if (find('event_claims', c => c.user_id === me.id && c.event_id === ev.id)) return E('该活动奖励已领取');
    insert('event_claims', { user_id: me.id, event_id: ev.id });
    const w = applyTx(me.id, { kind: 'event', gold: ev.reward?.gold || 0, diamond: ev.reward?.diamond || 0, memo: `活动奖励 · ${ev.title}` });
    notify(me.id, `已领取活动「${ev.title}」奖励`, '/events');
    return J({ ok: true, wallet: w });
  }
  if (method === 'POST' && path === '/engage/view') {
    const tbl = (body.type === 'script') ? 'scripts' : 'characters';
    const it = find(tbl, x => x.id === +body.id); if (it) { it.views = (it.views || 0) + 1; save(); } return J({ ok: true });
  }
  if ((m = P(/^\/engage\/reviews\/(character|script)\/(\d+)$/))) {
    const type = m[1], id = +m[2];
    if (method === 'GET') {
      const rows = filter('reviews', r => r.target_type === type && r.target_id === id).sort((a, b) => b.id - a.id)
        .map(r => ({ ...r, author_name: user(r.user_id)?.display_name, author_avatar: user(r.user_id)?.avatar }));
      const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0;
      const mine = me ? rows.find(r => r.user_id === me.id) : null;
      return J({ reviews: rows, avg, count: rows.length, mine: mine || null });
    }
    if (method === 'POST') {
      need(); const rating = Math.min(5, Math.max(1, parseInt(body.rating, 10) || 5)); const text = (body.text || '').slice(0, 500);
      const ex = find('reviews', r => r.target_type === type && r.target_id === id && r.user_id === me.id);
      if (ex) { ex.rating = rating; ex.text = text; ex.created_at = now(); save(); }
      else insert('reviews', { target_type: type, target_id: id, user_id: me.id, rating, text });
      return J({ ok: true });
    }
  }
  if ((m = P(/^\/engage\/reviews\/(\d+)$/)) && method === 'DELETE') {
    need(); const r = find('reviews', x => x.id === +m[1]); if (!r || r.user_id !== me.id) return E('无权删除', 403);
    db.reviews = filter('reviews', x => x.id !== r.id); save(); return J({ ok: true });
  }
  if (method === 'POST' && path === '/engage/report') {
    need(); if (!body.type || !body.id) return E('参数不全');
    insert('reports', { target_type: body.type, target_id: +body.id, reporter_id: me.id, reason: body.reason || '', status: 'open' });
    return J({ ok: true });
  }
  if (method === 'GET' && path === '/engage/leaderboard') {
    const characters = filter('characters', c => c.is_public).sort((a, b) => (b.likes - a.likes) || (b.uses - a.uses)).slice(0, 20)
      .map(c => ({ id: c.id, name: c.name, avatar: c.avatar, likes: c.likes, uses: c.uses, views: c.views, owner_name: user(c.owner_id)?.display_name }));
    const scripts = filter('scripts', () => true).sort((a, b) => (b.plays - a.plays) || (b.likes - a.likes)).slice(0, 20)
      .map(s => ({ id: s.id, title: s.title, cover: s.cover, plays: s.plays, likes: s.likes, price_gold: s.price_gold, author_name: user(s.author_id)?.display_name }));
    const authors = filter('users', u => !u.is_banned && !u.official && creatorWorks(u.id) > 0).map(u => ({ id: u.id, display_name: u.display_name, avatar: u.avatar,
      verified: !!u.verified, creator_tier: creatorTier(u), score: creatorScore(u.id),
      chars: filter('characters', c => c.owner_id === u.id && c.is_public).length,
      scripts: filter('scripts', x => x.author_id === u.id).length }))
      .sort((a, b) => b.score - a.score).slice(0, 20);
    return J({ characters, scripts, authors });
  }
  if (method === 'POST' && path === '/engage/gacha') {
    need(); const pool = filter('characters', c => c.is_public); if (!pool.length) return E('暂无可抽取的角色');
    try { applyTx(me.id, { kind: 'reward', diamond: -50, memo: '抽卡' }); } catch (e) { return E(e.message); }
    me.gacha_pulls = (me.gacha_pulls || 0) + 1;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const had = find('favorites', f => f.user_id === me.id && f.character_id === pick.id);
    if (!had) { insert('favorites', { user_id: me.id, character_id: pick.id }); pick.likes = (pick.likes || 0) + 1; }
    const w = applyTx(me.id, { kind: 'reward', gold: 10, memo: '抽卡返利' });
    return J({ character: { id: pick.id, name: pick.name, avatar: pick.avatar, tagline: pick.tagline }, already: !!had, cost: 50, wallet: w });
  }

  // ---------- GM admin ----------
  // ---------- parliament (议会提案系统) ----------
  if (path === '/parliament/overview' && method === 'GET') {
    need(); const c = councilCfg();
    return J({ is_councilor: !!me.is_councilor, is_gm: !!me.is_gm, council_size: councilSize(), seats: councilSeats(), term: c.term || 1, locked: !!c.locked, locked_at: c.locked_at || null, me_id: me.id, thresholds: { general: 0.5, special: 2 / 3 } });
  }
  // Public roster of sitting councilors (anyone may view).
  if (path === '/parliament/councilors' && method === 'GET') {
    need();
    const rows = filter('users', u => u.is_councilor).map(u => ({ id: u.id, display_name: u.display_name, avatar: u.avatar, verified: !!u.verified, creator_tier: creatorTier(u) }));
    return J({ councilors: rows, seats: councilSeats() });
  }
  // While the chamber is locked, proposal/vote mutations are suspended — but public 议论 (comments) continue.
  if (path.startsWith('/parliament/proposals') && method !== 'GET' && !path.includes('/comments') && parliamentLocked()) {
    return E('幻域议会当前已休会（GM 封锁中），暂停受理一切提案与表决，静待复会。', 423);
  }
  // Proposal discussion — open to all citizens.
  if ((m = P(/^\/parliament\/proposals\/(\d+)\/comments$/))) {
    const pid = +m[1]; const p = find('proposals', x => x.id === pid); if (!p) return E('议案不存在', 404);
    if (method === 'GET') {
      const rows = filter('proposal_comments', c => c.proposal_id === pid).sort((a, b) => a.id - b.id)
        .map(c => { const u = user(c.user_id); return { id: c.id, text: c.text, created_at: c.created_at, user_id: c.user_id, author_name: u?.display_name || '已注销', author_avatar: u?.avatar, author_councilor: !!u?.is_councilor, author_tier: creatorTier(u) }; });
      return J({ comments: rows });
    }
    if (method === 'POST') {
      need(); const text = String(body.text || '').trim(); if (!text) return E('议论内容不能为空');
      const c = insert('proposal_comments', { proposal_id: pid, user_id: me.id, text: text.slice(0, 600) });
      if (p.author_id !== me.id) notify(p.author_id, `${me.display_name} 在你的议案「${p.title.slice(0, 16)}」下发表了议论`, '/parliament');
      return J({ comment: { id: c.id, text: c.text, created_at: c.created_at, user_id: me.id, author_name: me.display_name, author_avatar: me.avatar, author_councilor: !!me.is_councilor, author_tier: creatorTier(me) } });
    }
  }
  if ((m = P(/^\/parliament\/proposals\/(\d+)\/comments\/(\d+)$/)) && method === 'DELETE') {
    need(); const c = find('proposal_comments', x => x.id === +m[2]); if (!c) return E('议论不存在', 404);
    if (c.user_id !== me.id && !me.is_gm) return E('无权删除', 403);
    db.proposal_comments = filter('proposal_comments', x => x.id !== c.id); save(); return J({ ok: true });
  }
  if (path === '/parliament/proposals' && method === 'GET') {
    need();
    const order = { voting: 0, pending: 1, passed_special: 2, passed_general: 3, failed: 4, rejected: 5 };
    const rows = [...table('proposals')].sort((a, b) => (order[a.status] - order[b.status]) || b.id - a.id).map(p => proposalView(p, me.id));
    return J({ proposals: rows });
  }
  if (path === '/parliament/proposals' && method === 'POST') {
    need(); if (!me.is_councilor) return E('仅议员可提交提案', 403);
    const title = String(body.title || '').trim(); const text = String(body.body || '').trim();
    if (!title) return E('请填写提案标题'); if (!text) return E('请填写提案内容');
    const p = insert('proposals', { author_id: me.id, title: title.slice(0, 80), body: text.slice(0, 2000), status: 'pending' });
    filter('users', u => u.is_gm).forEach(g => notify(g.id, `议员「${me.display_name}」提交了新提案，待采纳：${title.slice(0, 20)}`, '/parliament'));
    return J({ proposal: proposalView(p, me.id) });
  }
  if ((m = P(/^\/parliament\/proposals\/(\d+)\/endorse$/)) && method === 'POST') {
    need(); const p = find('proposals', x => x.id === +m[1]); if (!p) return E('提案不存在', 404);
    const ex = find('proposal_endorse', e => e.proposal_id === p.id && e.user_id === me.id);
    if (ex) db.proposal_endorse = filter('proposal_endorse', e => !(e.proposal_id === p.id && e.user_id === me.id));
    else insert('proposal_endorse', { proposal_id: p.id, user_id: me.id });
    save(); return J({ proposal: proposalView(p, me.id) });
  }
  if ((m = P(/^\/parliament\/proposals\/(\d+)\/vote$/)) && method === 'POST') {
    need(); if (!me.is_councilor) return E('仅议员可参与表决', 403);
    const p = find('proposals', x => x.id === +m[1]); if (!p) return E('提案不存在', 404);
    if (p.status !== 'voting') return E('该提案当前不在表决阶段');
    const choice = body.choice; if (!['for', 'against', 'abstain'].includes(choice)) return E('无效的表决选项');
    const ex = find('proposal_votes', v => v.proposal_id === p.id && v.user_id === me.id);
    if (ex) ex.choice = choice; else insert('proposal_votes', { proposal_id: p.id, user_id: me.id, choice });
    save(); return J({ proposal: proposalView(p, me.id) });
  }
  if ((m = P(/^\/parliament\/proposals\/(\d+)\/adopt$/)) && method === 'POST') {
    gmOnly(); const p = find('proposals', x => x.id === +m[1]); if (!p) return E('提案不存在', 404);
    if (p.status !== 'pending') return E('只有「待采纳」状态的提案可被采纳');
    p.status = 'voting'; p.adopted_at = now(); save();
    notify(p.author_id, `你的提案「${p.title.slice(0, 20)}」已被采纳，进入议会表决阶段。`, '/parliament');
    filter('users', u => u.is_councilor).forEach(c => notify(c.id, `新提案进入表决：「${p.title.slice(0, 20)}」，请前往议会投票。`, '/parliament'));
    return J({ proposal: proposalView(p, me.id) });
  }
  if ((m = P(/^\/parliament\/proposals\/(\d+)\/reject$/)) && method === 'POST') {
    gmOnly(); const p = find('proposals', x => x.id === +m[1]); if (!p) return E('提案不存在', 404);
    if (p.status !== 'pending' && p.status !== 'voting') return E('该提案无法驳回');
    p.status = 'rejected'; p.decided_at = now(); save();
    notify(p.author_id, `你的提案「${p.title.slice(0, 20)}」未获采纳。`, '/parliament');
    return J({ proposal: proposalView(p, me.id) });
  }
  if ((m = P(/^\/parliament\/proposals\/(\d+)\/close$/)) && method === 'POST') {
    gmOnly(); const p = find('proposals', x => x.id === +m[1]); if (!p) return E('提案不存在', 404);
    if (p.status !== 'voting') return E('只有表决中的提案可以计票结束');
    const votes = filter('proposal_votes', v => v.proposal_id === p.id);
    const tally = { for: 0, against: 0, abstain: 0 }; votes.forEach(v => { tally[v.choice]++; });
    const total = votes.length; const ratio = total ? tally.for / total : 0;
    let status = 'failed';
    if (total > 0 && ratio > 2 / 3) status = 'passed_special';
    else if (total > 0 && ratio > 0.5) status = 'passed_general';
    p.status = status; p.tally = { ...tally, total, ratio }; p.decided_at = now(); save();
    const label = status === 'passed_special' ? '特别决议通过' : status === 'passed_general' ? '一般决议通过' : '未获通过';
    notify(p.author_id, `提案「${p.title.slice(0, 20)}」表决结束：${label}（赞成率 ${Math.round(ratio * 100)}%）。`, '/parliament');
    return J({ proposal: proposalView(p, me.id) });
  }
  if ((m = P(/^\/parliament\/proposals\/(\d+)$/)) && method === 'DELETE') {
    need(); const p = find('proposals', x => x.id === +m[1]); if (!p) return E('提案不存在', 404);
    if (!me.is_gm && !(p.author_id === me.id && p.status === 'pending')) return E('无权删除该提案', 403);
    db.proposals = filter('proposals', x => x.id !== p.id);
    db.proposal_votes = filter('proposal_votes', v => v.proposal_id !== p.id);
    db.proposal_endorse = filter('proposal_endorse', e => e.proposal_id !== p.id);
    save(); return J({ ok: true });
  }

  if (path === '/admin/check' && method === 'GET') { gmOnly(); return J({ is_gm: true }); }
  // Platform built-in AI service config — GM only (group-wide for all no-API users).
  if (path === '/admin/platform' && method === 'GET') {
    gmOnly(); return J({ platform: platformAdminView() });
  }
  if (path === '/admin/platform' && method === 'PUT') {
    gmOnly(); const p = platformCfg();
    // Language model
    if (typeof body.base_url === 'string' && body.base_url.trim()) p.base_url = body.base_url.trim();
    if (typeof body.model === 'string' && body.model.trim()) p.model = body.model.trim();
    if (typeof body.protocol === 'string' && body.protocol.trim()) p.protocol = body.protocol.trim();
    if (typeof body.system_prompt === 'string') p.system_prompt = body.system_prompt;
    if (typeof body.key === 'string' && body.key.trim()) { try { p._k = btoa(body.key.trim()); } catch { p._k = ''; } }
    // Voice service
    if (body.voice && typeof body.voice === 'object') {
      ['provider', 'protocol', 'base_url', 'model', 'voice_name'].forEach(k => { if (typeof body.voice[k] === 'string') p.voice[k] = body.voice[k].trim(); });
      if (typeof body.voice.key === 'string' && body.voice.key.trim()) { try { p.voice._vk = btoa(body.voice.key.trim()); } catch { p.voice._vk = ''; } }
    }
    // Image service
    if (body.image && typeof body.image === 'object') {
      ['provider', 'protocol', 'base_url', 'model', 'size'].forEach(k => { if (typeof body.image[k] === 'string') p.image[k] = body.image[k].trim(); });
      if (typeof body.image.key === 'string' && body.image.key.trim()) { try { p.image._ik = btoa(body.image.key.trim()); } catch { p.image._ik = ''; } }
    }
    save();
    return J({ ok: true, platform: platformAdminView() });
  }
  if (path === '/admin/platform/test-voice' && method === 'POST') {
    gmOnly();
    return E('纯浏览器演示版受第三方语音服务跨域限制，平台语音「试听」请在全栈服务端使用；演示版可在「设置 → 语音模型 → 浏览器内置语音」试听。', 501);
  }
  if (path === '/admin/platform/detect-voices' && method === 'POST') {
    gmOnly();
    return E('纯浏览器演示版受第三方语音服务跨域限制，音色自动检测请在全栈服务端使用。', 501);
  }
  if (path === '/admin/stats' && method === 'GET') {
    gmOnly();
    const today = new Date().toISOString().slice(0, 10);
    // Daily series (last 14 days) — new users, new chars, new conversations.
    const cntByDay = (tbl, days = 14) => { const rows = table(tbl); const out = []; for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); out.push({ date: d.slice(5), n: rows.filter(x => (x.created_at || '').slice(0, 10) === d).length }); } return out; };
    const allTx = table('transactions');
    const economy = { gold_in: allTx.filter(t => t.gold > 0).reduce((s, t) => s + t.gold, 0), gold_out: allTx.filter(t => t.gold < 0).reduce((s, t) => s - t.gold, 0), diamond_in: allTx.filter(t => t.diamond > 0).reduce((s, t) => s + t.diamond, 0) };
    return J({ stats: { users: table('users').length, characters: table('characters').length, scripts: table('scripts').length,
      moments: table('moments').length, banned: filter('users', u => u.is_banned).length, reports: filter('reports', r => r.status === 'open').length,
      conversations: table('conversations').length, councilors: filter('users', u => u.is_councilor).length,
      proposals: filter('proposals', p => p.status === 'pending' || p.status === 'voting').length,
      checkins_today: filter('users', u => u.last_checkin === today).length },
      series: { users: cntByDay('users'), characters: cntByDay('characters'), conversations: cntByDay('conversations') }, economy });
  }
  // ---------- GM full backup / restore (数据保全) ----------
  if (path === '/admin/backup' && method === 'GET') { gmOnly(); return J({ app: '幻域 HUANYU', version: 7, exported_at: now(), db }); }
  if (path === '/admin/restore' && method === 'POST') {
    gmOnly(); const data = body && body.db; if (!data || typeof data !== 'object') return E('备份文件无效');
    db = data; if (!db._seq) db._seq = {}; save();
    return J({ ok: true });
  }
  if (path === '/admin/users' && method === 'GET') {
    gmOnly(); const q = (search.get('q') || '').trim(); let rows;
    if (!q) rows = [...table('users')].sort((a, b) => b.id - a.id).slice(0, 50);
    else if (/^\d+$/.test(q)) { const u = user(+q); rows = u ? [u] : []; }
    else { const k = q.toLowerCase(); rows = filter('users', u => (u.username + (u.display_name || '')).toLowerCase().includes(k)).slice(0, 50); }
    return J({ users: rows.map(u => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, gold: u.gold, diamond: u.diamond, vip: isVip(u), is_gm: !!u.is_gm, is_councilor: !!u.is_councilor, is_banned: !!u.is_banned, ban_reason: u.ban_reason || '' })) });
  }
  if ((m = P(/^\/admin\/users\/(\d+)\/ban$/)) && method === 'POST') { gmOnly(); const u = user(+m[1]); if (u) { u.is_banned = 1; u.ban_reason = body.reason || ''; save(); } return J({ ok: true }); }
  if ((m = P(/^\/admin\/users\/(\d+)\/unban$/)) && method === 'POST') { gmOnly(); const u = user(+m[1]); if (u) { u.is_banned = 0; u.ban_reason = ''; save(); } return J({ ok: true }); }
  if ((m = P(/^\/admin\/users\/(\d+)\/gm$/)) && method === 'POST') {
    gmOnly();
    if (+m[1] === me.id && !body.value) return E('不能撤销自己的 GM 权限，以防误操作锁定后台。请由另一位 GM 操作。', 400);
    const u = user(+m[1]); if (u) { u.is_gm = body.value ? 1 : 0; save(); } return J({ ok: true });
  }
  if ((m = P(/^\/admin\/users\/(\d+)\/councilor$/)) && method === 'POST') {
    gmOnly(); const u = user(+m[1]);
    if (u) { u.is_councilor = body.value ? 1 : 0; save(); if (body.value) notify(u.id, '你已被任命为「幻域议会」议员，现在可以提交公共提案并参与议会表决。', '/parliament'); }
    return J({ ok: true });
  }
  if (path === '/admin/councilors' && method === 'GET') {
    gmOnly(); const rows = filter('users', u => u.is_councilor).map(u => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, verified: !!u.verified, creator_tier: creatorTier(u) }));
    return J({ councilors: rows });
  }
  if (path === '/admin/council' && method === 'GET') {
    gmOnly(); const c = councilCfg(); const seats = councilSeats(); const cur = councilSize();
    return J({ council: { total_users: table('users').length, per_seat: USERS_PER_SEAT, min_seats: MIN_SEATS, base_seats: baseSeats(),
      seats, seats_override: c.seats_override, councilors: cur, vacancies: Math.max(0, seats - cur), over: cur > seats, term: c.term || 1, term_started_at: c.term_started_at, locked: !!c.locked, locked_at: c.locked_at || null } });
  }
  if (path === '/admin/council/lock' && method === 'POST') {
    gmOnly(); const c = councilCfg(); c.locked = !!body.value; c.locked_at = c.locked ? now() : null; save();
    filter('users', u => u.is_councilor).forEach(u => notify(u.id, c.locked ? '幻域议会已被管理层宣布无限期休会，暂停一切议事，静待复会通知。' : '幻域议会已恢复运作，现可正常提交提案与表决。', '/parliament'));
    return J({ ok: true, locked: c.locked });
  }
  if (path === '/admin/council' && method === 'PUT') {
    gmOnly(); const c = councilCfg();
    if (body.seats_override === null || body.seats_override === '' || body.seats_override === undefined) c.seats_override = null;
    else { const n = parseInt(body.seats_override, 10); if (isNaN(n) || n < 0) return E('席位数必须是非负整数'); if (n > 9999) return E('席位数过大'); c.seats_override = n; }
    save(); return J({ ok: true, seats: councilSeats(), seats_override: c.seats_override });
  }
  if (path === '/admin/council/reapportion' && method === 'POST') {
    gmOnly(); const c = councilCfg(); c.seats_override = null; c.term = (c.term || 1) + 1; c.term_started_at = now(); save();
    filter('users', u => u.is_councilor).forEach(u => notify(u.id, `幻域议会已完成第 ${c.term} 届换届，席位按注册规模重新核定为 ${councilSeats()} 席。`, '/parliament'));
    return J({ ok: true, term: c.term, seats: councilSeats() });
  }
  if (path === '/admin/broadcast' && method === 'POST') {
    gmOnly(); const text = String(body.text || '').trim(); if (!text) return E('广播内容不能为空');
    const link = String(body.link || '').trim(); let n = 0;
    table('users').forEach(u => { if (!u.is_banned) { notify(u.id, '📢 ' + text, link); n++; } });
    return J({ ok: true, count: n });
  }
  if (path === '/admin/gift' && method === 'POST') {
    gmOnly(); const target = body.user_id ? user(+body.user_id) : find('users', u => u.username === body.username || u.display_name === body.username);
    if (!target) return E('目标用户不存在', 404);
    if (body.gold || body.diamond) applyTx(target.id, { kind: 'reward', gold: +body.gold || 0, diamond: +body.diamond || 0, memo: body.memo || 'GM 赠送' });
    if (+body.vip_days > 0) { const base = isVip(target) ? new Date(target.vip_until).getTime() : Date.now(); target.vip_until = new Date(base + body.vip_days * 86400000).toISOString(); save(); }
    notify(target.id, `管理员赠送了你 ${body.gold ? body.gold + ' 金币 ' : ''}${body.diamond ? body.diamond + ' 钻石 ' : ''}${+body.vip_days > 0 ? body.vip_days + ' 天 VIP' : ''}`.trim());
    return J({ ok: true, user_id: target.id });
  }
  if (path === '/admin/characters' && method === 'GET') {
    gmOnly(); const q = (search.get('q') || '').toLowerCase();
    let rows = [...table('characters')].sort((a, b) => b.id - a.id); if (q) rows = rows.filter(c => c.name.toLowerCase().includes(q));
    return J({ characters: rows.slice(0, 50).map(c => ({ ...c, owner_name: user(c.owner_id)?.display_name })) });
  }
  if ((m = P(/^\/admin\/characters\/(\d+)\/feature$/)) && method === 'POST') { gmOnly(); const c = find('characters', x => x.id === +m[1]); if (c) { c.featured = body.value ? 1 : 0; save(); } return J({ ok: true }); }
  if ((m = P(/^\/admin\/characters\/(\d+)$/)) && method === 'DELETE') { gmOnly(); db.characters = filter('characters', x => x.id !== +m[1]); save(); return J({ ok: true }); }
  if (path === '/admin/scripts' && method === 'GET') {
    gmOnly(); const q = (search.get('q') || '').toLowerCase();
    let rows = [...table('scripts')].sort((a, b) => b.id - a.id); if (q) rows = rows.filter(s => s.title.toLowerCase().includes(q));
    return J({ scripts: rows.slice(0, 50).map(s => ({ ...s, author_name: user(s.author_id)?.display_name })) });
  }
  if ((m = P(/^\/admin\/scripts\/(\d+)\/feature$/)) && method === 'POST') { gmOnly(); const s = find('scripts', x => x.id === +m[1]); if (s) { s.featured = body.value ? 1 : 0; save(); } return J({ ok: true }); }
  if ((m = P(/^\/admin\/scripts\/(\d+)$/)) && method === 'DELETE') { gmOnly(); db.scripts = filter('scripts', x => x.id !== +m[1]); save(); return J({ ok: true }); }
  if ((m = P(/^\/admin\/moments\/(\d+)$/)) && method === 'DELETE') { gmOnly(); db.moments = filter('moments', x => x.id !== +m[1]); save(); return J({ ok: true }); }
  if ((m = P(/^\/admin\/comments\/(\d+)$/)) && method === 'DELETE') { gmOnly(); db.comments = filter('comments', x => x.id !== +m[1]); save(); return J({ ok: true }); }
  if (path === '/admin/codes' && method === 'GET') { gmOnly(); return J({ codes: [...table('invite_keys')].reverse().slice(0, 50) }); }
  if (path === '/admin/codes' && method === 'POST') {
    gmOnly(); const rnd = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    const code = (body.prefix ? String(body.prefix).toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' : '') + rnd(6);
    insert('invite_keys', { code, max_uses: Math.max(1, +body.max_uses || 1), used: 0, grant_gold: +body.gold || 0, grant_diamond: +body.diamond || 0, grant_vip_days: +body.vip_days || 0, note: body.note || '' });
    return J({ code: find('invite_keys', k => k.code === code) });
  }
  if ((m = P(/^\/admin\/codes\/([\w-]+)$/)) && method === 'DELETE') { gmOnly(); db.invite_keys = filter('invite_keys', k => k.code !== m[1]); save(); return J({ ok: true }); }
  if (path === '/admin/reports' && method === 'GET') {
    gmOnly(); const rows = [...table('reports')].sort((a, b) => (a.status === 'open' ? 1 : 0) - (b.status === 'open' ? 1 : 0) || b.id - a.id)
      .map(r => ({ ...r, reporter_name: user(r.reporter_id)?.display_name })).reverse();
    return J({ reports: rows });
  }
  if ((m = P(/^\/admin\/reports\/(\d+)\/resolve$/)) && method === 'POST') { gmOnly(); const r = find('reports', x => x.id === +m[1]); if (r) { r.status = 'resolved'; save(); } return J({ ok: true }); }

  throw { status: 404, msg: '接口不存在：' + path };
}

// GM-only view of the full platform config (masks every secret key).
function mask(k) { return k ? k.slice(0, 6) + '••••••' + k.slice(-4) : ''; }
function platformAdminView() {
  const p = platformCfg(); const key = platformKey(), vk = platformVoiceKey(), ik = platformImageKey();
  return {
    base_url: p.base_url, model: p.model, protocol: p.protocol || 'openai', system_prompt: p.system_prompt || '',
    key_set: !!key, key_masked: mask(key), fee: PLATFORM_FEE,
    voice: { provider: p.voice.provider, protocol: p.voice.protocol, base_url: p.voice.base_url, model: p.voice.model, voice_name: p.voice.voice_name, key_set: !!vk, key_masked: mask(vk), fee: VOICE_FEE },
    image: { provider: p.image.provider, protocol: p.image.protocol, base_url: p.image.base_url, model: p.image.model, size: p.image.size, key_set: !!ik, key_masked: mask(ik), fee: IMAGE_FEE },
  };
}

function pubSettings(s, me) {
  const usingPlatform = !s.llm_api_key;
  const usingPlatformVoice = !s.voice_api_key && platformVoiceReady();
  return { llm_provider: s.llm_provider, llm_protocol: s.llm_protocol || 'openai', llm_base_url: s.llm_base_url, llm_model: s.llm_model, llm_temperature: s.llm_temperature, llm_max_tokens: s.llm_max_tokens, voice_provider: s.voice_provider, voice_protocol: s.voice_protocol || 'openai', voice_base_url: s.voice_base_url, voice_model: s.voice_model, voice_name: s.voice_name, theme: s.theme, nsfw: s.nsfw, notify_email: s.notify_email, llm_api_key_set: !!s.llm_api_key, voice_api_key_set: !!s.voice_api_key,
    // privacy (sensible defaults when unset)
    privacy_profile: s.privacy_profile || 'public', allow_dm: s.allow_dm || 'all',
    show_online: s.show_online === undefined ? 1 : s.show_online, discoverable: s.discoverable === undefined ? 1 : s.discoverable,
    activity_visible: s.activity_visible === undefined ? 1 : s.activity_visible, leaderboard_visible: s.leaderboard_visible === undefined ? 1 : s.leaderboard_visible,
    read_receipts: s.read_receipts === undefined ? 1 : s.read_receipts, personalize: s.personalize === undefined ? 1 : s.personalize,
    // Platform service status — surfaced to the UI, but never the credentials.
    // Pricing is always exposed (full + member-discounted) so the UI can label
    // the cost and the VIP/SVIP discount regardless of which service is active.
    using_platform: usingPlatform,
    platform_fee: { base: platformFee(me, 0), heavy: platformFee(me, PLATFORM_FEE.heavy_threshold + 1),
      base_full: PLATFORM_FEE.base, heavy_full: PLATFORM_FEE.heavy,
      heavy_threshold: PLATFORM_FEE.heavy_threshold, discount: memberDiscount(me), active: usingPlatform },
    using_platform_voice: usingPlatformVoice,
    voice_fee: { per: featureFee(me, VOICE_FEE), base: VOICE_FEE, discount: memberDiscount(me), active: usingPlatformVoice, ready: platformVoiceReady() },
    image_fee: { per: featureFee(me, IMAGE_FEE), base: IMAGE_FEE, discount: memberDiscount(me), active: true, ready: platformImageReady() } };
}

/* ----------------------------- install ----------------------------- */
export function installMockBackend() {
  load();
  window.fetch = async (input, init = {}) => {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return realFetch(input, init); }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api')) return realFetch(input, init);
    const path = url.pathname.replace(/^\/api/, '');
    let body = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* */ } }
    try {
      const res = await route(init.method || 'GET', path, url.searchParams, body || {}, init.headers);
      return res instanceof Response ? res : J(res);
    } catch (e) {
      if (e && e.status) return E(e.msg, e.status);
      return E((e && e.message) || '服务器错误', 500);
    }
  };
}

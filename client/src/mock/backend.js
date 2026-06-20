// In-browser backend for the static (GitHub Pages) build.
// Persists to localStorage and intercepts same-origin /api/* fetches so the
// existing frontend works unchanged. AI calls go straight to the user's
// configured provider from the browser.

import { faceAvatar, FACE_PRESETS, animeAvatar, ANIME_PRESETS, BG_PRESETS } from '../faces.js';

const realFetch = window.fetch.bind(window);
const KEY = 'huanyu_db_v7';
let db;

/* ----------------------------- platform LLM service (hidden) -----------------------------
   When a user has NOT configured their own API key, chats fall back to the platform's
   built-in language service. These credentials are NEVER surfaced through any API response
   or the settings UI for non-GM users — ordinary users can neither see nor edit the
   provider, base URL, key or model. The values below are only DEFAULTS used to seed an
   editable, DB-backed platform config: the super admin (GM) can change the model / base URL
   / key from the admin console, and the change applies to ALL no-API users at once.
   (Note: in a purely static client build the bundle is ultimately inspectable; this keeps
   the credentials out of the product UI, the strongest guarantee achievable without a server.) */
const PLATFORM_DEFAULTS = {
  base_url: 'https://open.bigmodel.cn/api/paas/v4',
  // base64 of the platform key — kept out of plain source / UI.
  _k: 'ZWFmN2MwZDY5MmQzNGY0ZmEzNzUyMjI4NDc2NDE2YmQuQU1DS1ZUcXRQd2Nsa1U3UA==',
  model: 'glm-5.2'
};
// DB-backed, GM-editable platform config (group-wide). Lazily seeded from the defaults.
function platformCfg() {
  if (!db.platform) { db.platform = { base_url: PLATFORM_DEFAULTS.base_url, _k: PLATFORM_DEFAULTS._k, model: PLATFORM_DEFAULTS.model, system_prompt: '' }; save(); }
  if (db.platform.system_prompt === undefined) db.platform.system_prompt = '';
  return db.platform;
}
function platformKey() { try { return atob(platformCfg()._k || '') || ''; } catch { return ''; } }
// Per-conversation platform usage fee (gold). Heavier (100+ message) sessions cost more.
const PLATFORM_FEE = { base: 10, heavy: 15, heavy_threshold: 100 };
// Membership discounts on the platform fee. VIP = 75 折 (0.75), SVIP = 5 折 (0.50).
const memberDiscount = (u) => (u?.svip ? 0.5 : isVip(u) ? 0.75 : 1);

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
  Object.assign(u1, { svip: 1, verified: 1, verified_note: '幻域官方认证', vip_until: new Date(Date.now() + 3650 * 86400000).toISOString(), bio: '幻域官方认证 · 平台超级管理员｜SVIP 尊享会员，欢迎来到幻域。' });
  Object.assign(gmu, { verified: 1, verified_note: '官方账号' });
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

/* ----------------------------- helpers ----------------------------- */
const GOLD_PER_DIAMOND = 100, VIP_COST_GOLD = 30000, VIP_DAYS = 30;
const isVip = (u) => !!u?.vip_until && new Date(u.vip_until).getTime() > Date.now();
function publicUser(u) {
  return u && { id: u.id, username: u.username, email: u.email, display_name: u.display_name, avatar: u.avatar, banner: u.banner, bio: u.bio, gold: u.gold, diamond: u.diamond, vip_until: u.vip_until, vip: isVip(u), checkin_streak: u.checkin_streak, last_checkin: u.last_checkin, is_gm: !!u.is_gm, is_banned: !!u.is_banned, svip: !!u.svip, verified: !!u.verified, verified_note: u.verified_note || '', created_at: u.created_at };
}
function applyTx(uid, { kind, gold = 0, diamond = 0, memo = '' }) {
  const u = user(uid);
  if (u.gold + gold < 0) throw new Error('金币不足');
  if (u.diamond + diamond < 0) throw new Error('钻石不足');
  u.gold += gold; u.diamond += diamond;
  insert('transactions', { user_id: uid, kind, gold, diamond, memo });
  save();
  return { gold: u.gold, diamond: u.diamond };
}
const notify = (uid, text, link = '') => insert('notifications', { user_id: uid, text, link, read: 0 });

// Resolve which LLM credentials a request should use. If the user set their own key,
// use it (no fee). Otherwise transparently fall back to the platform service.
function effectiveLLM(s) {
  if (s && s.llm_api_key) return { base_url: s.llm_base_url, api_key: s.llm_api_key, model: s.llm_model, temperature: s.llm_temperature, max_tokens: s.llm_max_tokens, platform: false };
  const p = platformCfg();
  return { base_url: p.base_url, api_key: platformKey(), model: p.model, temperature: (s && s.llm_temperature) ?? 0.8, max_tokens: (s && s.llm_max_tokens) || 1024, platform: true };
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
  const payload = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))];

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
        const up = await realFetch(eff.base_url.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
          body: JSON.stringify({ model: eff.model, messages: payload, temperature: eff.temperature, max_tokens: eff.max_tokens, stream: true })
        });
        if (!up.ok || !up.body) { const t = await up.text().catch(() => ''); send({ error: `模型服务返回 ${up.status}：${t.slice(0, 300)}` }); }
        else {
          const reader = up.body.getReader(); const dec = new TextDecoder(); let buf = '';
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || '';
            for (const line of lines) {
              const t = line.trim(); if (!t.startsWith('data:')) continue;
              const d = t.slice(5).trim(); if (d === '[DONE]') continue;
              try { const j = JSON.parse(d); const delta = j.choices?.[0]?.delta?.content || ''; if (delta) { full += delta; send({ delta }); } } catch { /* */ }
            }
          }
        }
      } catch (err) { send({ error: '连接模型服务失败：' + err.message + '（可能是服务商的浏览器跨域限制）' }); }
      if (full.trim()) {
        insert('messages', { conversation_id: conv.id, role: 'assistant', content: full.trim() }); conv.updated_at = now();
        if (userContent) conv.affinity = (conv.affinity || 0) + 3; // 好感度随有效互动增长
        // Only now deduct the platform fee — successful reply.
        if (feeDue && me) { try { applyTx(me.id, { kind: 'ai_fee', gold: -feeDue, memo: `平台 AI · 对话《${character?.name || ''}》` }); send({ fee: feeDue }); } catch { /* */ } }
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
  const r = await realFetch(eff.base_url.replace(/\/$/, '') + '/chat/completions', {
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
  { id: 'newbie', kind: 'claim', tag: '新人', title: '新人见面礼', desc: '初入幻域，领取启程礼包：500 金币 + 20 钻石，立刻开启你的第一段角色扮演。', reward: { gold: 500, diamond: 20 }, accent: '#d97757' },
  { id: 'coop_carnival', kind: 'claim', tag: '联机', title: '限时联机狂欢', desc: '进入「剧场」与多位 AI 角色同台即兴演出，领取联机狂欢礼：60 钻石，并解锁多人同屏剧情。', reward: { gold: 0, diamond: 60 }, link: '/theater', linkText: '前往联机剧场', accent: '#7c5cff' },
  { id: 'group_party', kind: 'link', tag: '联机', title: '创作者联机大厅', desc: '加入群聊与其他创作者实时联机交流、互相导入角色、组队共创剧本。', link: '/groups', linkText: '进入联机大厅', accent: '#3f8195' },
  { id: 'checkin', kind: 'link', tag: '日常', title: '每日签到瓜分金币', desc: '连续签到奖励翻倍递增，VIP 再享双倍。坚持登录，金币越攒越多。', link: '/wallet', linkText: '去签到', accent: '#b3892f' },
  { id: 'bugbounty', kind: 'info', tag: '赏金', title: 'Bug 赏金猎人', desc: '发现任何 bug 或体验问题，提交至官方技术 QQ：3487923507，一经采纳奖励 100 金币起，重大问题另有钻石与 VIP 加码。', accent: '#5c8a63', qq: '3487923507' },
  { id: 'invite', kind: 'info', tag: '裂变', title: '邀请好友共创', desc: '在「设置 / 钱包」使用邀请密钥，邀请越多奖励越丰厚。与好友一起把幻域写满故事。', link: '/wallet', linkText: '查看兑换码', accent: '#c25a38' }
];

function charView(c) { return { ...c, world: filter('world_entries', w => w.character_id === c.id).sort((a, b) => a.position - b.position) }; }
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
    const u = insert('users', { username, password, display_name: display_name || username, email: email || '', avatar: null, banner: null, bio: '', gold: 1000, diamond: 0, vip_until: null, last_checkin: null, checkin_streak: 0 });
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
      ['llm_provider', 'llm_base_url', 'llm_model', 'llm_temperature', 'llm_max_tokens', 'voice_provider', 'voice_protocol', 'voice_base_url', 'voice_model', 'voice_name', 'theme'].forEach(k => { if (body[k] !== undefined) s[k] = body[k]; });
      if (body.llm_api_key) s.llm_api_key = body.llm_api_key;
      if (body.voice_api_key) s.voice_api_key = body.voice_api_key;
      if (body.nsfw !== undefined) s.nsfw = body.nsfw ? 1 : 0;
      if (body.notify_email !== undefined) s.notify_email = body.notify_email ? 1 : 0;
      save(); return J({ settings: pubSettings(s, me) });
    }
  }

  // Detect provider models (browser → provider directly). Protocol-aware.
  if (method === 'POST' && path === '/settings/models') {
    need(); const s = find('settings', x => x.user_id === me.id) || {};
    const raw = String(body.base_url || s.llm_base_url || '');
    const base = raw.split('?')[0].replace(/\/$/, '');
    const key = body.api_key || s.llm_api_key;
    const proto = body.protocol || 'openai';
    // MiniMax has no public model-list endpoint; return the known TTS models.
    if (proto === 'minimax') return J({ models: ['speech-02-hd', 'speech-02-turbo', 'speech-01-hd', 'speech-01-turbo', 'speech-01-240228'] });
    if (!base) return E('请先填写 API Base URL');
    if (!key) return E('请先填写 API Key');
    const headers = proto === 'elevenlabs' ? { 'xi-api-key': key } : { Authorization: `Bearer ${key}` };
    try {
      const r = await realFetch(base + '/models', { headers });
      if (!r.ok) { const t = await r.text().catch(() => ''); return E(`服务商返回 ${r.status}：${t.slice(0, 200)}`, 502); }
      const d = await r.json();
      const arr = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : (Array.isArray(d) ? d : []));
      return J({ models: arr.map(x => (typeof x === 'string' ? x : (x.model_id || x.id || x.name))).filter(Boolean) });
    } catch (e) { return E('连接服务商失败（可能是浏览器跨域限制）：' + e.message, 502); }
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
    const url = await fileToDataUrl(file); return J({ url, type: file.type?.startsWith('video') ? 'video' : 'image' });
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
    return J({ totals, characters: charRows.sort((a, b) => b.uses - a.uses), scripts: scriptRows.sort((a, b) => b.revenue - a.revenue) });
  }
  if (method === 'GET' && path === '/characters/public') {
    const cat = search.get('category'), q = (search.get('q') || '').toLowerCase(), sort = search.get('sort');
    let rows = filter('characters', c => c.is_public);
    if (cat && cat !== 'all') rows = rows.filter(c => c.category === cat);
    if (q) rows = rows.filter(c => (c.name + c.tags + c.tagline).toLowerCase().includes(q));
    rows = rows.sort((a, b) => sort === 'new' ? b.id - a.id : (b.uses - a.uses) || (b.likes - a.likes)).slice(0, 80);
    rows = rows.map(c => ({ ...c, owner_name: user(c.owner_id)?.display_name, faved: me ? !!find('favorites', f => f.user_id === me.id && f.character_id === c.id) : false }));
    return J({ characters: rows });
  }
  if (method === 'GET' && path === '/characters/favorites/list') { need(); const rows = filter('favorites', f => f.user_id === me.id).map(f => { const c = find('characters', x => x.id === f.character_id); return c && { ...c, owner_name: user(c.owner_id)?.display_name }; }).filter(Boolean).reverse(); return J({ characters: rows }); }
  if ((m = P(/^\/characters\/(\d+)\/favorite$/)) && method === 'POST') {
    need(); const cid = +m[1]; const ex = find('favorites', f => f.user_id === me.id && f.character_id === cid); const c = find('characters', x => x.id === cid);
    if (ex) { db.favorites = filter('favorites', f => !(f.user_id === me.id && f.character_id === cid)); if (c) c.likes = Math.max(0, c.likes - 1); save(); return J({ faved: false }); }
    insert('favorites', { user_id: me.id, character_id: cid }); if (c) c.likes++; save(); return J({ faved: true });
  }
  if ((m = P(/^\/characters\/(\d+)$/))) {
    const cid = +m[1]; const c = find('characters', x => x.id === cid);
    if (method === 'GET') { if (!c) return E('角色不存在', 404); if (!c.is_public && (!me || me.id !== c.owner_id)) return E('无权访问', 403); return J({ character: charView(c) }); }
    if (method === 'PUT') { need(); if (!c || c.owner_id !== me.id) return E('无权编辑', 403); ['name', 'avatar', 'background', 'background_type', 'tagline', 'intro', 'greeting', 'persona', 'voice_name', 'category', 'tags'].forEach(k => { if (body[k] !== undefined) c[k] = body[k]; }); c.is_public = body.is_public ? 1 : 0; c.nsfw = body.nsfw ? 1 : 0; if (body.world) saveWorld(c.id, body.world); save(); return J({ character: charView(c) }); }
    if (method === 'DELETE') { need(); if (!c || c.owner_id !== me.id) return E('无权删除', 403); db.characters = filter('characters', x => x.id !== cid); save(); return J({ ok: true }); }
  }
  if (method === 'POST' && path === '/characters') {
    need(); if (!body.name) return E('角色名必填');
    const c = insert('characters', { owner_id: me.id, name: body.name, avatar: body.avatar || null, background: body.background || null, background_type: body.background_type || 'image', tagline: body.tagline || '', intro: body.intro || '', greeting: body.greeting || '', persona: body.persona || '', voice_name: body.voice_name || '', category: body.category || '', tags: body.tags || '', is_public: body.is_public ? 1 : 0, nsfw: body.nsfw ? 1 : 0, likes: 0, uses: 0 });
    saveWorld(c.id, body.world); return J({ character: charView(c) });
  }

  // ---------- chat ----------
  if (method === 'GET' && path === '/chat/conversations') { need(); const rows = filter('conversations', c => c.user_id === me.id).map(c => { const ch = find('characters', x => x.id === c.character_id); return { ...c, character_name: ch?.name, character_avatar: ch?.avatar }; }).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')); return J({ conversations: rows }); }
  if (method === 'POST' && path === '/chat/conversations') {
    need(); const ch = find('characters', x => x.id === body.character_id); if (!ch) return E('角色不存在', 404);
    const conv = insert('conversations', { user_id: me.id, character_id: ch.id, title: ch.name, updated_at: now() }); ch.uses++;
    if (ch.greeting) insert('messages', { conversation_id: conv.id, role: 'assistant', content: ch.greeting }); save();
    return J({ conversation: conv });
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)$/))) {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    if (method === 'GET') { if (conv.affinity === undefined) conv.affinity = 0; if (!conv.memories) conv.memories = []; const ch = find('characters', x => x.id === conv.character_id); return J({ conversation: conv, character: ch ? charView(ch) : null, messages: filter('messages', x => x.conversation_id === conv.id) }); }
    if (method === 'DELETE') { db.conversations = filter('conversations', c => c.id !== conv.id); db.messages = filter('messages', x => x.conversation_id !== conv.id); save(); return J({ ok: true }); }
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
    need(); const s = find('settings', x => x.user_id === me.id); if (!s.voice_api_key) return E('尚未配置语音模型 API');
    const base = (s.voice_base_url || '').replace(/\/$/, '');
    const text = (body.text || '').slice(0, 4000);
    const voice = body.voice || s.voice_name;
    const proto = s.voice_protocol || 'openai';
    try {
      // Protocol adapters: translate to each vendor's TTS API, return audio/* to the player.
      if (proto === 'elevenlabs') {
        // ElevenLabs: POST /v1/text-to-speech/{voice_id}, xi-api-key header, JSON in / mp3 out.
        const vid = voice || '21m00Tcm4TlvDq8ikWAM';
        const up = await realFetch(`${base}/text-to-speech/${encodeURIComponent(vid)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': s.voice_api_key, Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: s.voice_model || 'eleven_multilingual_v2' })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        return up;
      }
      if (proto === 'minimax') {
        // MiniMax T2A v2: GroupId goes in query (?GroupId=...), audio returned as hex in JSON.
        const up = await realFetch(`${base}/t2a_v2`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.voice_api_key}` },
          body: JSON.stringify({ model: s.voice_model || 'speech-01-turbo', text, stream: false, voice_setting: { voice_id: voice || 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 }, audio_setting: { format: 'mp3', sample_rate: 32000 } })
        });
        if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
        const d = await up.json().catch(() => null);
        const hex = d?.data?.audio;
        if (!hex) return E('语音服务未返回音频（MiniMax 需在 Base URL 后附 ?GroupId=你的GroupId）', 502);
        const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(h => parseInt(h, 16)));
        return new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } });
      }
      // Default: OpenAI-compatible /audio/speech (OpenAI / Groq / 硅基流动 / DeepInfra / Lemonfox …)
      const up = await realFetch(base + '/audio/speech', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.voice_api_key}` },
        body: JSON.stringify({ model: s.voice_model, input: text, voice })
      });
      if (!up.ok) { const t = await up.text().catch(() => ''); return E(`语音服务返回 ${up.status}：${t.slice(0, 200)}`, 502); }
      return up;
    } catch (e) { return E('语音服务连接失败：' + e.message, 502); }
  }

  // ---------- economy ----------
  if (method === 'GET' && path === '/economy/wallet') { need(); return J({ wallet: publicUser(me), transactions: filter('transactions', t => t.user_id === me.id).sort((a, b) => b.id - a.id).slice(0, 50), packages: PACKAGES, rates: { gold_per_diamond: GOLD_PER_DIAMOND, vip_cost: VIP_COST_GOLD, vip_days: VIP_DAYS } }); }
  if (method === 'POST' && path === '/economy/recharge') { need(); const p = PACKAGES.find(x => x.id === body.package_id); if (!p) return E('套餐不存在'); const w = applyTx(me.id, { kind: 'recharge', diamond: p.diamond + p.bonus, memo: `充值 ¥${p.cny} 获得 ${p.diamond + p.bonus} 钻石` }); return J({ wallet: w }); }
  if (method === 'POST' && path === '/economy/exchange') { need(); const n = parseInt(body.diamond, 10); if (!n || n <= 0) return E('请输入有效的钻石数量'); try { return J({ wallet: applyTx(me.id, { kind: 'exchange', diamond: -n, gold: n * GOLD_PER_DIAMOND, memo: `${n} 钻石兑换为 ${n * GOLD_PER_DIAMOND} 金币` }) }); } catch (e) { return E(e.message); } }
  if (method === 'POST' && path === '/economy/vip') { need(); try { applyTx(me.id, { kind: 'vip', gold: -VIP_COST_GOLD, memo: `购买 ${VIP_DAYS} 天 VIP` }); } catch (e) { return E(e.message); } const base = isVip(me) ? new Date(me.vip_until).getTime() : Date.now(); me.vip_until = new Date(base + VIP_DAYS * 86400000).toISOString(); save(); return J({ wallet: publicUser(me) }); }
  if (method === 'POST' && path === '/economy/checkin') {
    need(); const today = new Date().toISOString().slice(0, 10); if (me.last_checkin === today) return E('今天已经签到过啦');
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10); const streak = me.last_checkin === y ? (me.checkin_streak || 0) + 1 : 1;
    let reward = 100 + Math.min(streak, 7) * 20; if (isVip(me)) reward *= 2; me.last_checkin = today; me.checkin_streak = streak;
    const w = applyTx(me.id, { kind: 'checkin', gold: reward, memo: `第 ${streak} 天签到` }); return J({ wallet: w, reward, streak });
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
  if ((m = P(/^\/social\/moments\/(\d+)\/like$/)) && method === 'POST') { need(); const mm = find('moments', x => x.id === +m[1]); if (!mm) return E('动态不存在', 404); const ex = find('moment_likes', l => l.moment_id === mm.id && l.user_id === me.id); if (ex) { db.moment_likes = filter('moment_likes', l => !(l.moment_id === mm.id && l.user_id === me.id)); mm.likes = Math.max(0, mm.likes - 1); save(); return J({ liked: false, likes: mm.likes }); } insert('moment_likes', { moment_id: mm.id, user_id: me.id }); mm.likes++; save(); if (mm.user_id !== me.id) notify(mm.user_id, `${me.display_name} 赞了你的动态`, '/community'); return J({ liked: true, likes: mm.likes }); }
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
    const stats = { characters: filter('characters', c => c.owner_id === u.id).length, scripts: scripts.length, followers: filter('follows', f => f.following_id === u.id).length, following: filter('follows', f => f.follower_id === u.id).length };
    const following = me ? !!find('follows', f => f.follower_id === me.id && f.following_id === u.id) : false;
    return J({ user: { id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, banner: u.banner, bio: u.bio, vip: isVip(u), vip_until: u.vip_until, is_gm: !!u.is_gm, svip: !!u.svip, verified: !!u.verified, verified_note: u.verified_note || '', created_at: u.created_at }, characters, scripts, moments, stats, following });
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
  if (method === 'GET' && path === '/theater') { need(); const rows = filter('theaters', t => t.is_public || t.owner_id === me.id).sort((a, b) => b.id - a.id).map(t => ({ ...t, owner_name: user(t.owner_id)?.display_name, member_count: filter('theater_members', x => x.theater_id === t.id).length, cast_count: filter('theater_cast', x => x.theater_id === t.id).length })); return J({ theaters: rows }); }
  if (method === 'POST' && path === '/theater') { need(); if (!body.name) return E('剧场名称必填'); if (!Array.isArray(body.cast) || !body.cast.length) return E('请至少选择一位 AI 角色登场'); const t = insert('theaters', { name: body.name, owner_id: me.id, scene: body.scene || '', cover: body.cover || null, is_public: body.is_public === false ? 0 : 1 }); insert('theater_members', { theater_id: t.id, user_id: me.id }); body.cast.forEach(cid => { if (!find('theater_cast', x => x.theater_id === t.id && x.character_id === cid)) insert('theater_cast', { theater_id: t.id, character_id: cid }); }); if (body.scene) insert('theater_messages', { theater_id: t.id, sender_type: 'narrator', sender_id: null, name: '旁白', avatar: null, content: body.scene }); return J({ theater: t }); }
  if ((m = P(/^\/theater\/(\d+)\/join$/)) && method === 'POST') { need(); const tid = +m[1]; if (!find('theater_members', x => x.theater_id === tid && x.user_id === me.id)) insert('theater_members', { theater_id: tid, user_id: me.id }); return J({ ok: true }); }
  if ((m = P(/^\/theater\/(\d+)\/say$/)) && method === 'POST') { need(); const tid = +m[1]; if (!body.content) return E('内容不能为空'); if (!find('theater_members', x => x.theater_id === tid && x.user_id === me.id)) insert('theater_members', { theater_id: tid, user_id: me.id }); const msg = insert('theater_messages', { theater_id: tid, sender_type: 'user', sender_id: me.id, name: me.display_name, avatar: me.avatar, content: body.content }); return J({ message: msg }); }
  if ((m = P(/^\/theater\/(\d+)\/act$/)) && method === 'POST') {
    need(); const tid = +m[1]; const t = find('theaters', x => x.id === tid); if (!t) return E('剧场不存在', 404);
    const s = find('settings', x => x.user_id === me.id);
    const eff = effectiveLLM(s);
    if (eff.platform) { const fee = platformFee(me, 0); if (me.gold < fee) return E(`金币不足，剧场联机平台 AI 需 ${fee} 金币（当前 ${me.gold}）`); }
    const cast = filter('theater_cast', x => x.theater_id === tid).map(x => find('characters', c => c.id === x.character_id)).filter(Boolean);
    const transcript = filter('theater_messages', x => x.theater_id === tid).slice(-30); const log = transcript.map(x => `${x.name}：${x.content}`).join('\n');
    const castList = cast.map(c => `「${c.name}」(${c.tagline || '登场角色'})`).join('、');
    let target, system;
    if (body.narrator) { target = { id: null, name: '旁白', avatar: null }; system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。你是「旁白」，请用富有画面感的第三人称，推进剧情、描写环境氛围或引出转折，控制在 2-4 句话，不要替具体角色说出对白。`; }
    else { const c = cast.find(x => x.id === body.character_id) || cast[0]; if (!c) return E('剧场没有 AI 角色'); target = c; system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。\n你现在只扮演其中的「${c.name}」。${c.persona || c.intro || ''}\n请严格以「${c.name}」的身份，根据下面的剧情进展生成一段符合人设的台词与动作（可含 *动作描写*），只说这一个角色的内容，不要替玩家或其他角色发言，控制在 1-3 句。`; }
    try { const content = await llmOnce(s, system, `【当前剧情】\n${log || '（剧情刚刚开始）'}\n\n请继续：`); if (!content) return E('模型未返回内容', 502); const msg = insert('theater_messages', { theater_id: tid, sender_type: body.narrator ? 'narrator' : 'ai', sender_id: target.id, name: target.name, avatar: target.avatar, content }); if (eff.platform) { try { applyTx(me.id, { kind: 'ai_fee', gold: -platformFee(me, 0), memo: '平台 AI · 剧场联机' }); } catch { /* */ } } return J({ message: msg }); } catch (e) { return E(e.message, 502); }
  }
  if ((m = P(/^\/theater\/(\d+)\/messages$/)) && method === 'GET') { const tid = +m[1]; const after = parseInt(search.get('after'), 10) || 0; return J({ messages: filter('theater_messages', x => x.theater_id === tid && x.id > after) }); }
  if ((m = P(/^\/theater\/(\d+)$/)) && method === 'GET') { need(); const t = find('theaters', x => x.id === +m[1]); if (!t) return E('剧场不存在', 404); const cast = filter('theater_cast', x => x.theater_id === t.id).map(x => find('characters', c => c.id === x.character_id)).filter(Boolean); const members = filter('theater_members', x => x.theater_id === t.id).map(x => ({ id: x.user_id, display_name: user(x.user_id)?.display_name, avatar: user(x.user_id)?.avatar })); const messages = filter('theater_messages', x => x.theater_id === t.id); return J({ theater: { ...t, owner_name: user(t.owner_id)?.display_name }, cast, members, messages, joined: !!find('theater_members', x => x.theater_id === t.id && x.user_id === me.id) }); }

  // ---------- community (cards / inbox) ----------
  if ((m = P(/^\/community\/publish-character\/(\d+)$/)) && method === 'POST') { need(); const c = find('characters', x => x.id === +m[1]); if (!c || c.owner_id !== me.id) return E('无权发布', 403); c.is_public = 1; save(); return J({ ok: true }); }
  if (method === 'GET' && path === '/community/inbox') { need(); return J({ shares: [] }); }
  if (method === 'POST' && path === '/community/inbox/seen') { return J({ ok: true }); }

  // ---------- engagement: views / reviews / reports / leaderboard ----------
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
    const authors = filter('users', u => !u.is_banned).map(u => ({ id: u.id, display_name: u.display_name, avatar: u.avatar,
      score: filter('characters', c => c.owner_id === u.id).reduce((s, c) => s + (c.likes || 0), 0) + filter('scripts', x => x.author_id === u.id).reduce((s, x) => s + (x.likes || 0), 0),
      chars: filter('characters', c => c.owner_id === u.id && c.is_public).length }))
      .sort((a, b) => b.score - a.score).slice(0, 20);
    return J({ characters, scripts, authors });
  }
  if (method === 'POST' && path === '/engage/gacha') {
    need(); const pool = filter('characters', c => c.is_public); if (!pool.length) return E('暂无可抽取的角色');
    try { applyTx(me.id, { kind: 'reward', diamond: -50, memo: '抽卡' }); } catch (e) { return E(e.message); }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const had = find('favorites', f => f.user_id === me.id && f.character_id === pick.id);
    if (!had) { insert('favorites', { user_id: me.id, character_id: pick.id }); pick.likes = (pick.likes || 0) + 1; }
    const w = applyTx(me.id, { kind: 'reward', gold: 20, memo: '抽卡返利' });
    return J({ character: { id: pick.id, name: pick.name, avatar: pick.avatar, tagline: pick.tagline }, already: !!had, cost: 50, wallet: w });
  }

  // ---------- GM admin ----------
  if (path === '/admin/check' && method === 'GET') { gmOnly(); return J({ is_gm: true }); }
  // Platform built-in AI service config — GM only (group-wide for all no-API users).
  if (path === '/admin/platform' && method === 'GET') {
    gmOnly(); const p = platformCfg(); const key = platformKey();
    return J({ platform: { base_url: p.base_url, model: p.model, system_prompt: p.system_prompt || '', key_set: !!key, key_masked: key ? key.slice(0, 6) + '••••••' + key.slice(-4) : '', fee: PLATFORM_FEE } });
  }
  if (path === '/admin/platform' && method === 'PUT') {
    gmOnly(); const p = platformCfg();
    if (typeof body.base_url === 'string' && body.base_url.trim()) p.base_url = body.base_url.trim();
    if (typeof body.model === 'string' && body.model.trim()) p.model = body.model.trim();
    if (typeof body.system_prompt === 'string') p.system_prompt = body.system_prompt;
    if (typeof body.key === 'string' && body.key.trim()) { try { p._k = btoa(body.key.trim()); } catch { p._k = ''; } }
    save();
    const key = platformKey();
    return J({ ok: true, platform: { base_url: p.base_url, model: p.model, system_prompt: p.system_prompt || '', key_set: !!key, key_masked: key ? key.slice(0, 6) + '••••••' + key.slice(-4) : '' } });
  }
  if (path === '/admin/stats' && method === 'GET') {
    gmOnly();
    return J({ stats: { users: table('users').length, characters: table('characters').length, scripts: table('scripts').length,
      moments: table('moments').length, banned: filter('users', u => u.is_banned).length, reports: filter('reports', r => r.status === 'open').length } });
  }
  if (path === '/admin/users' && method === 'GET') {
    gmOnly(); const q = (search.get('q') || '').trim(); let rows;
    if (!q) rows = [...table('users')].sort((a, b) => b.id - a.id).slice(0, 50);
    else if (/^\d+$/.test(q)) { const u = user(+q); rows = u ? [u] : []; }
    else { const k = q.toLowerCase(); rows = filter('users', u => (u.username + (u.display_name || '')).toLowerCase().includes(k)).slice(0, 50); }
    return J({ users: rows.map(u => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, gold: u.gold, diamond: u.diamond, vip: isVip(u), is_gm: !!u.is_gm, is_banned: !!u.is_banned, ban_reason: u.ban_reason || '' })) });
  }
  if ((m = P(/^\/admin\/users\/(\d+)\/ban$/)) && method === 'POST') { gmOnly(); const u = user(+m[1]); if (u) { u.is_banned = 1; u.ban_reason = body.reason || ''; save(); } return J({ ok: true }); }
  if ((m = P(/^\/admin\/users\/(\d+)\/unban$/)) && method === 'POST') { gmOnly(); const u = user(+m[1]); if (u) { u.is_banned = 0; u.ban_reason = ''; save(); } return J({ ok: true }); }
  if ((m = P(/^\/admin\/users\/(\d+)\/gm$/)) && method === 'POST') { gmOnly(); const u = user(+m[1]); if (u) { u.is_gm = body.value ? 1 : 0; save(); } return J({ ok: true }); }
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

function pubSettings(s, me) {
  const usingPlatform = !s.llm_api_key;
  return { llm_provider: s.llm_provider, llm_base_url: s.llm_base_url, llm_model: s.llm_model, llm_temperature: s.llm_temperature, llm_max_tokens: s.llm_max_tokens, voice_provider: s.voice_provider, voice_protocol: s.voice_protocol || 'openai', voice_base_url: s.voice_base_url, voice_model: s.voice_model, voice_name: s.voice_name, theme: s.theme, nsfw: s.nsfw, notify_email: s.notify_email, llm_api_key_set: !!s.llm_api_key, voice_api_key_set: !!s.voice_api_key,
    // Platform service status — surfaced to the UI, but never the credentials.
    using_platform: usingPlatform,
    platform_fee: usingPlatform ? { base: platformFee(me, 0), heavy: platformFee(me, PLATFORM_FEE.heavy_threshold + 1), heavy_threshold: PLATFORM_FEE.heavy_threshold, discount: memberDiscount(me) } : null };
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

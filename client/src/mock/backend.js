// In-browser backend for the static (GitHub Pages) build.
// Persists to localStorage and intercepts same-origin /api/* fetches so the
// existing frontend works unchanged. AI calls go straight to the user's
// configured provider from the browser.

const realFetch = window.fetch.bind(window);
const KEY = 'huanyu_db_v3';
let db;

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
  if (raw) { try { db = JSON.parse(raw); return; } catch { /* */ } }
  db = seed(); save();
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
  const defaultSettings = (uid) => insert('settings', { user_id: uid, llm_provider: 'openai', llm_base_url: 'https://api.openai.com/v1', llm_api_key: '', llm_model: 'gpt-4o-mini', llm_temperature: 0.8, llm_max_tokens: 1024, voice_provider: 'openai', voice_base_url: 'https://api.openai.com/v1', voice_api_key: '', voice_model: 'tts-1', voice_name: 'alloy', theme: 'dark', nsfw: 0, notify_email: 0 });

  insert('invite_keys', { code: 'HUANYU2026', max_uses: 9999, used: 0, grant_gold: 2000, grant_diamond: 0, grant_vip_days: 0 });
  insert('invite_keys', { code: 'VIPGIFT', max_uses: 100, used: 0, grant_gold: 0, grant_diamond: 500, grant_vip_days: 30 });

  const u1 = mkUser('demo', '旅人', '热爱奇幻与角色扮演的创作者，正在书写属于自己的幻域。', avatarArt('demo', '#a779ff', '#3a2566', '旅'), bannerArt('demo', '#3a2566', '#15102e'), 18600, 320, 30);
  const u2 = mkUser('astra', '星语者', '专注科幻与赛博朋克题材的世界观构筑师。', avatarArt('astra', '#37d6e0', '#103040', '星'), bannerArt('astra', '#103040', '#0a1622'), 9200, 60, 0);
  const u3 = mkUser('mochi', '麻薯', '治愈系日常向作者，喜欢一切软软的东西。', avatarArt('mochi', '#ff9ec4', '#6e2f4d', '麻'), bannerArt('mochi', '#6e2f4d', '#2a1620'), 4300, 0, 0);
  const u4 = mkUser('kenji', '剑持', '武侠与历史题材，刀光剑影里见人心。', avatarArt('kenji', '#d8a657', '#5a3d1f', '剑'), bannerArt('kenji', '#5a3d1f', '#221409'), 6700, 10, 0);
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
  return u && { id: u.id, username: u.username, email: u.email, display_name: u.display_name, avatar: u.avatar, banner: u.banner, bio: u.bio, gold: u.gold, diamond: u.diamond, vip_until: u.vip_until, vip: isVip(u), checkin_streak: u.checkin_streak, last_checkin: u.last_checkin, created_at: u.created_at };
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
async function streamCompletion(conv, character, settings, userContent) {
  if (userContent) insert('messages', { conversation_id: conv.id, role: 'user', content: userContent });
  const history = filter('messages', m => m.conversation_id === conv.id);
  const recent = history.slice(-6).map(m => m.content).join(' ');
  const system = buildSystemPrompt(character, recent + ' ' + userContent);
  const payload = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      if (!settings.llm_api_key) {
        send({ error: '尚未配置语言模型 API。请前往「设置 → 语言模型」填写 API Key（浏览器将直连你的服务商）。' });
        controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return;
      }
      let full = '';
      try {
        const up = await realFetch(settings.llm_base_url.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llm_api_key}` },
          body: JSON.stringify({ model: settings.llm_model, messages: payload, temperature: settings.llm_temperature, max_tokens: settings.llm_max_tokens, stream: true })
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
      if (full.trim()) { insert('messages', { conversation_id: conv.id, role: 'assistant', content: full.trim() }); conv.updated_at = now(); save(); }
      controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
    }
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function llmOnce(settings, system, userMsg, maxTokens = 400) {
  const r = await realFetch(settings.llm_base_url.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llm_api_key}` },
    body: JSON.stringify({ model: settings.llm_model, temperature: settings.llm_temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`模型返回 ${r.status}：${t.slice(0, 200)}`); }
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/* ----------------------------- router ----------------------------- */
const CATEGORIES = [['fantasy', '奇幻', ''], ['scifi', '科幻', ''], ['romance', '恋爱', ''], ['healing', '治愈', ''], ['mystery', '悬疑', ''], ['history', '历史', ''], ['game', '游戏', ''], ['anime', '二次元', '愈'], ['daily', '日常', ''], ['horror', '惊悚', ''], ['wuxia', '武侠', ''], ['other', '其他', '']];
const PACKAGES = [{ id: 'p1', cny: 6, diamond: 60, bonus: 0 }, { id: 'p2', cny: 30, diamond: 300, bonus: 30 }, { id: 'p3', cny: 68, diamond: 680, bonus: 120 }, { id: 'p4', cny: 128, diamond: 1280, bonus: 320 }, { id: 'p5', cny: 328, diamond: 3280, bonus: 1080 }, { id: 'p6', cny: 648, diamond: 6480, bonus: 2880 }];

function charView(c) { return { ...c, world: filter('world_entries', w => w.character_id === c.id).sort((a, b) => a.position - b.position) }; }
function saveWorld(cid, world) {
  db.world_entries = filter('world_entries', w => w.character_id !== cid);
  if (Array.isArray(world)) world.forEach((w, i) => { if (w && (w.content || w.keys)) insert('world_entries', { character_id: cid, keys: w.keys || '', content: w.content || '', enabled: w.enabled === false ? 0 : 1, position: i }); });
  save();
}

async function route(method, path, search, body, headers) {
  const me = authUser(headers);
  const need = () => { if (!me) throw { status: 401, msg: '未登录' }; return me; };
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
    insert('settings', { user_id: u.id, llm_provider: 'openai', llm_base_url: 'https://api.openai.com/v1', llm_api_key: '', llm_model: 'gpt-4o-mini', llm_temperature: 0.8, llm_max_tokens: 1024, voice_provider: 'openai', voice_base_url: 'https://api.openai.com/v1', voice_api_key: '', voice_model: 'tts-1', voice_name: 'alloy', theme: 'dark', nsfw: 0, notify_email: 0 });
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
    if (method === 'GET') return J({ settings: pubSettings(s) });
    if (method === 'PUT') {
      ['llm_provider', 'llm_base_url', 'llm_model', 'llm_temperature', 'llm_max_tokens', 'voice_provider', 'voice_base_url', 'voice_model', 'voice_name', 'theme'].forEach(k => { if (body[k] !== undefined) s[k] = body[k]; });
      if (body.llm_api_key) s.llm_api_key = body.llm_api_key;
      if (body.voice_api_key) s.voice_api_key = body.voice_api_key;
      if (body.nsfw !== undefined) s.nsfw = body.nsfw ? 1 : 0;
      if (body.notify_email !== undefined) s.notify_email = body.notify_email ? 1 : 0;
      save(); return J({ settings: pubSettings(s) });
    }
  }

  // Detect provider models (browser → provider directly).
  if (method === 'POST' && path === '/settings/models') {
    need(); const s = find('settings', x => x.user_id === me.id) || {};
    const base = String(body.base_url || s.llm_base_url || '').replace(/\/$/, '');
    const key = body.api_key || s.llm_api_key;
    if (!base) return E('请先填写 API Base URL');
    if (!key) return E('请先填写 API Key');
    try {
      const r = await realFetch(base + '/models', { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) { const t = await r.text().catch(() => ''); return E(`服务商返回 ${r.status}：${t.slice(0, 200)}`, 502); }
      const d = await r.json();
      const arr = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : []);
      return J({ models: arr.map(x => (typeof x === 'string' ? x : (x.id || x.name))).filter(Boolean) });
    } catch (e) { return E('连接服务商失败（可能是浏览器跨域限制）：' + e.message, 502); }
  }

  // ---------- meta ----------
  if (method === 'GET' && path === '/meta/categories') return J({ categories: CATEGORIES.map(([slug, name, icon]) => ({ slug, name, icon })) });

  // ---------- upload ----------
  if (method === 'POST' && path === '/upload') {
    const file = body && body.get && body.get('file'); if (!file) return E('未收到文件');
    const url = await fileToDataUrl(file); return J({ url, type: file.type?.startsWith('video') ? 'video' : 'image' });
  }

  // ---------- characters ----------
  if (method === 'GET' && path === '/characters/mine') { need(); return J({ characters: filter('characters', c => c.owner_id === me.id).sort((a, b) => b.id - a.id) }); }
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
    if (method === 'GET') return J({ conversation: conv, character: find('characters', x => x.id === conv.character_id), messages: filter('messages', x => x.conversation_id === conv.id) });
    if (method === 'DELETE') { db.conversations = filter('conversations', c => c.id !== conv.id); db.messages = filter('messages', x => x.conversation_id !== conv.id); save(); return J({ ok: true }); }
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/complete$/)) && method === 'POST') {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    const ch = find('characters', x => x.id === conv.character_id); const s = find('settings', x => x.user_id === me.id);
    return streamCompletion(conv, ch, s, (body.content || '').trim());
  }
  if ((m = P(/^\/chat\/conversations\/(\d+)\/regenerate$/)) && method === 'POST') {
    need(); const conv = find('conversations', c => c.id === +m[1]); if (!conv || conv.user_id !== me.id) return E('无权访问', 403);
    const ch = find('characters', x => x.id === conv.character_id); const s = find('settings', x => x.user_id === me.id);
    const msgs = filter('messages', x => x.conversation_id === conv.id);
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant') { db.messages = filter('messages', x => x.id !== last.id); save(); }
    return streamCompletion(conv, ch, s, '');
  }
  if (method === 'POST' && path === '/chat/tts') {
    need(); const s = find('settings', x => x.user_id === me.id); if (!s.voice_api_key) return E('尚未配置语音模型 API');
    try {
      const up = await realFetch(s.voice_base_url.replace(/\/$/, '') + '/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.voice_api_key}` }, body: JSON.stringify({ model: s.voice_model, input: (body.text || '').slice(0, 4000), voice: body.voice || s.voice_name }) });
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
  if ((m = P(/^\/users\/(\d+)$/)) && method === 'GET') {
    const u = user(+m[1]); if (!u) return E('用户不存在', 404);
    const characters = filter('characters', c => c.owner_id === u.id && c.is_public).sort((a, b) => b.id - a.id);
    const scripts = filter('scripts', s => s.author_id === u.id).sort((a, b) => b.id - a.id);
    const moments = filter('moments', x => x.user_id === u.id).sort((a, b) => b.id - a.id).slice(0, 20);
    const stats = { characters: filter('characters', c => c.owner_id === u.id).length, scripts: scripts.length, followers: filter('follows', f => f.following_id === u.id).length, following: filter('follows', f => f.follower_id === u.id).length };
    const following = me ? !!find('follows', f => f.follower_id === me.id && f.following_id === u.id) : false;
    return J({ user: { id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, banner: u.banner, bio: u.bio, vip: isVip(u), vip_until: u.vip_until, created_at: u.created_at }, characters, scripts, moments, stats, following });
  }

  // ---------- groups ----------
  if (method === 'GET' && path === '/groups') { need(); const rows = filter('groups', g => g.is_public || g.owner_id === me.id).sort((a, b) => b.id - a.id).map(g => ({ ...g, owner_name: user(g.owner_id)?.display_name, member_count: filter('group_members', x => x.group_id === g.id).length, joined: find('group_members', x => x.group_id === g.id && x.user_id === me.id) ? 1 : 0 })); return J({ groups: rows }); }
  if (method === 'POST' && path === '/groups') { need(); if (!body.name) return E('群名称必填'); const g = insert('groups', { name: body.name, owner_id: me.id, avatar: body.avatar || null, description: body.description || '', is_public: body.is_public === false ? 0 : 1 }); insert('group_members', { group_id: g.id, user_id: me.id, role: 'owner' }); return J({ group: g }); }
  if ((m = P(/^\/groups\/(\d+)\/join$/)) && method === 'POST') { need(); const gid = +m[1]; if (!find('group_members', x => x.group_id === gid && x.user_id === me.id)) insert('group_members', { group_id: gid, user_id: me.id, role: 'member' }); return J({ ok: true }); }
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
    const s = find('settings', x => x.user_id === me.id); if (!s.llm_api_key) return E('请先在设置中配置语言模型 API');
    const cast = filter('theater_cast', x => x.theater_id === tid).map(x => find('characters', c => c.id === x.character_id)).filter(Boolean);
    const transcript = filter('theater_messages', x => x.theater_id === tid).slice(-30); const log = transcript.map(x => `${x.name}：${x.content}`).join('\n');
    const castList = cast.map(c => `「${c.name}」(${c.tagline || '登场角色'})`).join('、');
    let target, system;
    if (body.narrator) { target = { id: null, name: '旁白', avatar: null }; system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。你是「旁白」，请用富有画面感的第三人称，推进剧情、描写环境氛围或引出转折，控制在 2-4 句话，不要替具体角色说出对白。`; }
    else { const c = cast.find(x => x.id === body.character_id) || cast[0]; if (!c) return E('剧场没有 AI 角色'); target = c; system = `这是一个多人即兴剧场。场景：${t.scene || '自由发挥'}。登场角色有：${castList}。\n你现在只扮演其中的「${c.name}」。${c.persona || c.intro || ''}\n请严格以「${c.name}」的身份，根据下面的剧情进展生成一段符合人设的台词与动作（可含 *动作描写*），只说这一个角色的内容，不要替玩家或其他角色发言，控制在 1-3 句。`; }
    try { const content = await llmOnce(s, system, `【当前剧情】\n${log || '（剧情刚刚开始）'}\n\n请继续：`); if (!content) return E('模型未返回内容', 502); const msg = insert('theater_messages', { theater_id: tid, sender_type: body.narrator ? 'narrator' : 'ai', sender_id: target.id, name: target.name, avatar: target.avatar, content }); return J({ message: msg }); } catch (e) { return E(e.message, 502); }
  }
  if ((m = P(/^\/theater\/(\d+)\/messages$/)) && method === 'GET') { const tid = +m[1]; const after = parseInt(search.get('after'), 10) || 0; return J({ messages: filter('theater_messages', x => x.theater_id === tid && x.id > after) }); }
  if ((m = P(/^\/theater\/(\d+)$/)) && method === 'GET') { need(); const t = find('theaters', x => x.id === +m[1]); if (!t) return E('剧场不存在', 404); const cast = filter('theater_cast', x => x.theater_id === t.id).map(x => find('characters', c => c.id === x.character_id)).filter(Boolean); const members = filter('theater_members', x => x.theater_id === t.id).map(x => ({ id: x.user_id, display_name: user(x.user_id)?.display_name, avatar: user(x.user_id)?.avatar })); const messages = filter('theater_messages', x => x.theater_id === t.id); return J({ theater: { ...t, owner_name: user(t.owner_id)?.display_name }, cast, members, messages, joined: !!find('theater_members', x => x.theater_id === t.id && x.user_id === me.id) }); }

  // ---------- community (cards / inbox) ----------
  if ((m = P(/^\/community\/publish-character\/(\d+)$/)) && method === 'POST') { need(); const c = find('characters', x => x.id === +m[1]); if (!c || c.owner_id !== me.id) return E('无权发布', 403); c.is_public = 1; save(); return J({ ok: true }); }
  if (method === 'GET' && path === '/community/inbox') { need(); return J({ shares: [] }); }
  if (method === 'POST' && path === '/community/inbox/seen') { return J({ ok: true }); }

  throw { status: 404, msg: '接口不存在：' + path };
}

function pubSettings(s) { return { llm_provider: s.llm_provider, llm_base_url: s.llm_base_url, llm_model: s.llm_model, llm_temperature: s.llm_temperature, llm_max_tokens: s.llm_max_tokens, voice_provider: s.voice_provider, voice_base_url: s.voice_base_url, voice_model: s.voice_model, voice_name: s.voice_name, theme: s.theme, nsfw: s.nsfw, notify_email: s.notify_email, llm_api_key_set: !!s.llm_api_key, voice_api_key_set: !!s.voice_api_key }; }

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

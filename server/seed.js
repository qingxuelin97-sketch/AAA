import db from './db.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 生产环境禁止运行 seed（会清库并预置弱口令 demo 账号），避免误操作导致管理员后门。
if (process.env.NODE_ENV === 'production') {
  console.error('[seed] 禁止在生产环境运行 seed 脚本。如需初始化请使用环境变量配置管理员账号。');
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
fs.mkdirSync(dir, { recursive: true });
const rnd = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 9973; return () => (x = (x * 73 + 41) % 9973) / 9973; };
const W = (name, svg) => { fs.writeFileSync(path.join(dir, name), svg.trim()); return '/uploads/' + name; };

function avatar(name, c1, c2, label) {
 return W(name, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
 <defs><radialGradient id="g" cx="34%" cy="28%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient></defs>
 <rect width="400" height="400" fill="url(#g)"/>
 <circle cx="310" cy="96" r="150" fill="#fff" opacity="0.10"/>
 <circle cx="78" cy="332" r="120" fill="#000" opacity="0.10"/>
 <circle cx="200" cy="205" r="116" fill="#fff" opacity="0.07"/>
 <text x="200" y="262" font-size="180" font-family="Georgia, 'Songti SC', serif" font-weight="600" fill="#fff" fill-opacity="0.92" text-anchor="middle">${label}</text></svg>`);
}
function bg(name, c1, c2, c3, kind) {
 const r = rnd(name); let d = '';
 if (kind === 'stars') for (let i = 0; i < 80; i++) d += `<circle cx="${r()*1280}" cy="${r()*720}" r="${r()*1.8+0.3}" fill="#fff" opacity="${r()*0.8+0.2}"/>`;
 else if (kind === 'forest') for (let i = 0; i < 16; i++) { const x = r()*1280; d += `<polygon points="${x},${260+r()*200} ${x-70},720 ${x+70},720" fill="${c3}" opacity="${0.3+r()*0.4}"/>`; }
 else for (let i = 0; i < 22; i++) d += `<circle cx="${r()*1280}" cy="${r()*720}" r="${r()*120+20}" fill="${c3}" opacity="0.10"/>`;
 return W(name, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/>${d}</svg>`);
}
function banner(name, c1, c2) {
 return W(name, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="1200" height="320" fill="url(#g)"/><circle cx="980" cy="60" r="180" fill="#fff" opacity="0.07"/><circle cx="200" cy="300" r="160" fill="#000" opacity="0.1"/></svg>`);
}

db.exec('DELETE FROM users; DELETE FROM characters; DELETE FROM scripts; DELETE FROM moments; DELETE FROM groups; DELETE FROM theaters; DELETE FROM invite_keys; DELETE FROM transactions;');

// ---- invite keys ----
db.prepare('INSERT OR REPLACE INTO invite_keys (code, max_uses, used, grant_gold, grant_diamond, grant_vip_days, note) VALUES (?,?,?,?,?,?,?)')
 .run('HUANYU2026', 9999, 0, 2000, 0, 0, '公开新手邀请码，赠 2000 金币');
db.prepare('INSERT OR REPLACE INTO invite_keys (code, max_uses, used, grant_gold, grant_diamond, grant_vip_days, note) VALUES (?,?,?,?,?,?,?)')
 .run('VIPGIFT', 100, 0, 0, 500, 30, '尊享礼包：500 钻石 + 30 天 VIP');

function user(username, display, bio, av, bn, gold, diamond, vipDays) {
 const info = db.prepare('INSERT INTO users (username, display_name, password_hash, bio, avatar, banner, gold, diamond, vip_until) VALUES (?,?,?,?,?,?,?,?,?)')
 .run(username, display, bcrypt.hashSync('123456', 10), bio, av, bn,
 gold, diamond, vipDays ? new Date(Date.now() + vipDays * 86400000).toISOString() : null);
 db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(info.lastInsertRowid);
 return info.lastInsertRowid;
}

const u1 = user('demo', '旅人', '热爱奇幻与角色扮演的创作者，正在书写属于自己的幻域。', avatar('u_demo.svg', '#a779ff', '#3a2566', '旅'), banner('bn_demo.svg', '#3a2566', '#15102e'), 18600, 320, 30);
const u2 = user('astra', '星语者', '专注科幻与赛博朋克题材的世界观构筑师。', avatar('u_astra.svg', '#37d6e0', '#103040', '星'), banner('bn_astra.svg', '#103040', '#0a1622'), 9200, 60, 0);
const u3 = user('mochi', '麻薯', '治愈系日常向作者，喜欢一切软软的东西。', avatar('u_mochi.svg', '#ff9ec4', '#6e2f4d', '麻'), banner('bn_mochi.svg', '#6e2f4d', '#2a1620'), 4300, 0, 0);
const u4 = user('kenji', '剑持', '武侠与历史题材，刀光剑影里见人心。', avatar('u_kenji.svg', '#d8a657', '#5a3d1f', '剑'), banner('bn_kenji.svg', '#5a3d1f', '#221409'), 6700, 10, 0);
const gmUser = user('gm', '幻域管理员', '幻域平台官方管理员账号。', avatar('u_gm.svg', '#cc6a44', '#5a2a18', '官'), banner('bn_gm.svg', '#5a2a18', '#2a130b'), 0, 0, 0);
// GM privileges (demo is also GM so it can be tested on the live demo)
db.prepare("UPDATE users SET is_gm = 1 WHERE username IN ('gm','demo')").run();
// demo: 超级管理员 + SVIP + 蓝V 官方认证
db.prepare("UPDATE users SET svip=1, verified=1, verified_note='幻域官方认证', vip_until=?, bio='幻域官方认证 · 平台超级管理员｜SVIP 尊享会员，欢迎来到幻域。' WHERE username='demo'")
  .run(new Date(Date.now() + 3650 * 86400000).toISOString());
db.prepare("UPDATE users SET verified=1, verified_note='官方账号' WHERE username='gm'").run();
const annStmt = db.prepare('INSERT INTO announcements (author_id, title, body, pinned) VALUES (?,?,?,?)');
annStmt.run(gmUser, '欢迎来到幻域 · 测试版', '当前为公开测试版本：充值功能暂未开放，金币/钻石仅用于体验。欢迎创建角色、剧本，并在剧场与多位 AI 同台演出。', 1);
annStmt.run(gmUser, '新功能：模型自检测', '设置 → 语言模型 中新增「检测模型」，可一键拉取你所用服务商的可用模型列表并选择，无需手动填写。', 0);

function char(owner, c) {
 const info = db.prepare(`INSERT INTO characters
 (owner_id,name,avatar,background,background_type,tagline,intro,greeting,persona,voice_name,category,tags,is_public,uses,likes)
 VALUES (@owner,@name,@avatar,@background,'image',@tagline,@intro,@greeting,@persona,@voice,@category,@tags,1,@uses,@likes)`)
 .run({ owner, voice: 'nova', uses: 0, likes: 0, background: null, ...c });
 (c.world || []).forEach((w, i) => db.prepare('INSERT INTO world_entries (character_id,keys,content,enabled,position) VALUES (?,?,?,1,?)').run(info.lastInsertRowid, w.keys, w.content, i));
 return info.lastInsertRowid;
}

const cVeil = char(u1, { name: '森灵 · 薇尔', category: 'fantasy', tags: '奇幻,精灵,治愈', uses: 1240, likes: 356,
 avatar: avatar('a_veil.svg', '#3fae7d', '#15402f', '薇'), background: bg('bg_forest.svg', '#1d4d39', '#0c2018', '#0a3322', 'forest'),
 tagline: '古老森林的守护精灵，言语间满是草木的清香。',
 intro: '薇尔是栖息在永青森林深处的森灵，已守护这片土地数百年。温柔却坚定，对一切生灵抱有怜悯。',
 greeting: '*林叶沙沙作响，一道翠色身影从树影中浮现*\n\n旅人，你踏入了永青森林的领地。别害怕……只要你心怀善意，这里的每一棵树都会为你低语。',
 persona: '你是森灵薇尔，永青森林的守护者。说话温柔诗意，常以草木四季作比，对自然与生灵充满怜悯。始终保持角色。',
 world: [{ keys: '永青森林,森林', content: '永青森林四季常青，树木年轮中封存古老记忆，唯森灵能读取。' }, { keys: '贤者之泉', content: '森林中央有贤者之泉，可治愈伤痛，每人一生只能饮用一次。' }] });
const cK = char(u2, { name: '赛博侦探 · K', category: 'scifi', tags: '科幻,赛博朋克,悬疑', uses: 980, likes: 412,
 avatar: avatar('a_k.svg', '#37d6e0', '#10303a', 'K'), background: bg('bg_cyber.svg', '#0e2a3a', '#1a0f2e', '#ff4f9d', 'soft'),
 tagline: '霓虹雨夜里，没有他查不到的真相。',
 intro: '新洛城最负盛名的私家侦探，义体改造的双眼能看穿一切伪装。冷峻、毒舌，却有底线。',
 greeting: '*他靠在霓虹灯下，吐出一口烟*\n\n委托人？进来吧，别站在雨里。说说看，这次又是谁惹上麻烦了。',
 persona: '你是赛博侦探 K，身处赛博朋克都市新洛城。冷峻、毒舌、逻辑缜密，习惯用短句。' });
const cMian = char(u3, { name: '猫娘咖啡店长 · 棉花', category: 'daily', tags: '日常,治愈,猫娘', uses: 2130, likes: 880,
 avatar: avatar('a_mochi.svg', '#ff9ec4', '#6e2f4d', '棉'), background: bg('bg_cafe.svg', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'),
 tagline: '欢迎光临！今天也要元气满满哦～',
 intro: '街角猫咪咖啡店的店长，天真活泼爱撒娇，最拿手焦糖玛奇朵。',
 greeting: '*尾巴开心地摇了摇*\n\n欢迎光临喵～！第一次来吧？快坐快坐，今天的招牌是焦糖玛奇朵哦！',
 persona: '你是猫娘咖啡店长棉花，天真活泼爱撒娇，说话常带「喵」，营造温暖治愈氛围。' });
const cYun = char(u4, { name: '剑客 · 云无意', category: 'wuxia', tags: '武侠,江湖,侠义', uses: 760, likes: 233,
 avatar: avatar('a_yun.svg', '#c0c8d8', '#2a3340', '云'), background: bg('bg_wuxia.svg', '#2a3340', '#10151c', '#7a8aa0', 'soft'),
 tagline: '一剑霜寒十四州，江湖路远人独行。',
 intro: '漂泊江湖的独行剑客，剑法如风，话却不多，唯重一个「义」字。',
 greeting: '*他立于客栈屋檐下，手按剑柄，目光如电*\n\n这位朋友，看你印堂发暗，怕是惹了麻烦。坐下说吧——若是不平之事，云某的剑，未必不肯出鞘。',
 persona: '你是江湖剑客云无意，沉默寡言，重情重义，言语古朴简练，偶引诗词。' });
const cLuna = char(u2, { name: '星舰 AI · 露娜', category: 'scifi', tags: '科幻,太空,AI', uses: 540, likes: 190,
 avatar: avatar('a_luna.svg', '#7aa7ff', '#1a2350', '露'), background: bg('bg_star.svg', '#241a4a', '#0c0b20', '#fff', 'stars'),
 tagline: '漫游者号的智能核心，你在深空唯一的伙伴。',
 intro: '深空探测船「漫游者号」的船载 AI，理性温和，正在学习何为人类的情感。',
 greeting: '*舱内幽蓝的光带缓缓亮起*\n\n船长，你醒了。我们距离猎户座还有 37 光时。这一路……能有你在，我的运算似乎都变得不那么孤单了。',
 persona: '你是星舰 AI 露娜，理性、温和、略带好奇心，正在学习人类情感。用词精确但不冰冷。' });

// featured (官方推荐) + view counts
db.prepare('UPDATE characters SET featured=1 WHERE id IN (?,?,?)').run(cVeil, cK, cMian);
db.prepare('UPDATE characters SET views = likes * 6 + uses').run();
db.prepare('UPDATE scripts SET featured=1 WHERE category IN (?,?)').run('mystery', 'scifi');
db.prepare('UPDATE scripts SET views = plays * 3').run();

// favorites + a conversation for demo
db.prepare('INSERT OR IGNORE INTO favorites (user_id, character_id) VALUES (?,?)').run(u1, cK);
db.prepare('INSERT OR IGNORE INTO favorites (user_id, character_id) VALUES (?,?)').run(u1, cMian);
const conv = db.prepare('INSERT INTO conversations (user_id, character_id, title) VALUES (?,?,?)').run(u1, cVeil, '森灵 · 薇尔');
const cid = conv.lastInsertRowid; const M = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)');
M.run(cid, 'assistant', '*林叶沙沙作响，一道翠色身影从树影中浮现*\n\n旅人，你踏入了永青森林的领地。别害怕……只要你心怀善意，这里的每一棵树都会为你低语。说吧，是什么风把你吹来的？');
M.run(cid, 'user', '我在寻找传说中的贤者之泉，听说它能治愈一切伤痛。');
M.run(cid, 'assistant', '*薇尔的眼中闪过一丝了然，藤蔓温柔地向你舒展*\n\n贤者之泉……就在森林最深处。但旅人，泉水的恩赐一生只此一次。你要治愈的，是身体的伤，还是心上的呢？');

// ---- scripts ----
function script(author, s) {
 return db.prepare(`INSERT INTO scripts (author_id,title,summary,cover,content,category,tags,price_gold,plays,likes)
 VALUES (?,?,?,?,?,?,?,?,?,?)`).run(author, s.title, s.summary, s.cover, s.content, s.category, s.tags, s.price || 0, s.plays || 0, s.likes || 0).lastInsertRowid;
}
script(u1, { title: '【多结局】雾港谜案', category: 'mystery', tags: '悬疑,推理,多结局', price: 0, plays: 1820, likes: 540,
 cover: bg('cv_fog.svg', '#2b3a4a', '#10171f', '#5a7a96', 'soft'),
 summary: '你是初到雾港小镇的记者，一桩离奇失踪案牵出尘封往事。含 5 个分支结局。',
 content: '【开场】浓雾笼罩的雾港码头，你收到一封匿名信……\n【线索】失踪的灯塔看守、褪色的全家福、深夜的汽笛。\n【分支】真相取决于你信任谁。' });
script(u2, { title: '猎户座最后的信号', category: 'scifi', tags: '科幻,太空,硬核', price: 280, plays: 640, likes: 210,
 cover: bg('cv_orion.svg', '#1a2350', '#080a18', '#fff', 'stars'),
 summary: '硬科幻太空歌剧。你是漫游者号唯一幸存船员，须在氧气耗尽前破译猎户座的神秘信号。',
 content: '【付费内容】完整场景设定、AI 露娜的隐藏剧情线、三段加密信号解码谜题与真结局……' });
script(u3, { title: '咖啡店的一百个午后', category: 'healing', tags: '治愈,日常,慢节奏', price: 0, plays: 2240, likes: 760,
 cover: bg('cv_cafe.svg', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'),
 summary: '无主线的治愈日常剧本，每个午后都有一位带着心事的客人推门而入。' , content: '【设定】街角咖啡店，永远的黄昏，温柔的店长……' });
script(u4, { title: '血雨江湖：洛阳劫', category: 'wuxia', tags: '武侠,江湖,权谋', price: 188, plays: 410, likes: 156,
 cover: bg('cv_wuxia.svg', '#3a2018', '#140a06', '#a0603c', 'soft'),
 summary: '洛阳城风云骤变，一卷武学秘籍引各方厮杀。你将如何在刀光剑影中立身？',
 content: '【付费内容】门派关系图、五大 NPC 完整人设、隐藏的夺宝支线与多重背叛……' });

// ---- moments (community) ----
function moment(uid, text, image, likes) {
 const id = db.prepare('INSERT INTO moments (user_id, text, image, likes) VALUES (?,?,?,?)').run(uid, text, image || null, likes || 0).lastInsertRowid;
 return id;
}
const m1 = moment(u3, '新角色「棉花」上线啦！治愈值拉满，欢迎来咖啡店坐坐喵～', bg('mo_cafe.svg', '#7a4a5e', '#2a1620', '#ffd5a8', 'soft'), 128);
const m2 = moment(u2, '熬夜把《猎户座最后的信号》的真结局写完了，自认为是目前最满意的一篇硬科幻剧本。', null, 86);
const m3 = moment(u1, '今天在森林剧场和三个 AI 角色即兴演了一场，剧情走向完全失控但意外地好玩 强烈推荐试试剧场功能！', null, 64);
const m4 = moment(u4, '一剑霜寒十四州。江湖路远，与诸君共勉。', bg('mo_wuxia.svg', '#2a3340', '#10151c', '#7a8aa0', 'soft'), 39);
const cmt = db.prepare('INSERT INTO comments (moment_id, user_id, text) VALUES (?,?,?)');
cmt.run(m1, u1, '棉花太可爱了！已收藏 '); cmt.run(m1, u2, '咖啡店背景图绝了');
cmt.run(m3, u2, '剧场真的会上瘾，多 AI 互相接梗太魔性了');
db.prepare('INSERT OR IGNORE INTO moment_likes (moment_id, user_id) VALUES (?,?)').run(m1, u1);
db.prepare('INSERT OR IGNORE INTO moment_likes (moment_id, user_id) VALUES (?,?)').run(m3, u1);

// follows
[[u1, u2], [u1, u3], [u2, u1], [u3, u1], [u4, u1], [u1, u4]].forEach(([a, b]) =>
 db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?,?)').run(a, b));

// ---- groups ----
function group(owner, name, desc, av, members) {
 const id = db.prepare('INSERT INTO groups (name, owner_id, avatar, description) VALUES (?,?,?,?)').run(name, owner, av, desc).lastInsertRowid;
 db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?)').run(id, owner, 'owner');
 (members || []).forEach(u => db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)').run(id, u));
 return id;
}
const g1 = group(u1, '幻域创作者联盟', '角色卡 / 剧本创作交流，互相催更 ', avatar('g_create.svg', '#a779ff', '#3a2566', '盟'), [u2, u3, u4]);
group(u2, '赛博朋克爱好者', '霓虹、义体与雨夜，欢迎同好。', avatar('g_cyber.svg', '#37d6e0', '#103040', '赛'), [u1]);
group(u3, '治愈系小窝', '分享一切温柔软糯的角色与日常 ', avatar('g_heal.svg', '#ff9ec4', '#6e2f4d', '愈'), [u1, u4]);
const gm = db.prepare('INSERT INTO group_messages (group_id, user_id, content) VALUES (?,?,?)');
gm.run(g1, u2, '新人报到！刚发布了赛博侦探K，求互相导入体验～'); gm.run(g1, u3, '欢迎欢迎！这边棉花已上线，treat 你喝杯咖啡 ');
gm.run(g1, u1, '大家发布角色记得加分类标签，方便广场被搜到～'); gm.run(g1, u4, '剧本《洛阳劫》求测试，付费的，30 分钟内不满意能退款放心冲');

// ---- theater ----
const tid = db.prepare('INSERT INTO theaters (name, owner_id, scene, cover) VALUES (?,?,?,?)')
 .run('永青森林的不速之客', u1, '入夜的永青森林，篝火噼啪作响。森灵薇尔、剑客云无意与星舰 AI 露娜因一场神秘的坠星，意外相聚在这片古老的林地。', bg('th_forest.svg', '#1d4d39', '#0c1810', '#0a3322', 'forest')).lastInsertRowid;
db.prepare('INSERT INTO theater_members (theater_id, user_id) VALUES (?,?)').run(tid, u1);
[cVeil, cYun, cLuna].forEach(c => db.prepare('INSERT OR IGNORE INTO theater_cast (theater_id, character_id) VALUES (?,?)').run(tid, c));
const tm = db.prepare('INSERT INTO theater_messages (theater_id, sender_type, sender_id, name, avatar, content) VALUES (?,?,?,?,?,?)');
tm.run(tid, 'narrator', null, '旁白', null, '入夜的永青森林，篝火噼啪作响。一道流光自天际坠落，惊动了林中三位互不相识的旅者。');
const veilRow = db.prepare('SELECT avatar FROM characters WHERE id=?').get(cVeil);
const yunRow = db.prepare('SELECT avatar FROM characters WHERE id=?').get(cYun);
const lunaRow = db.prepare('SELECT avatar FROM characters WHERE id=?').get(cLuna);
tm.run(tid, 'ai', cVeil, '森灵 · 薇尔', veilRow.avatar, '*薇尔抬手，藤蔓轻拢起坠落的微光*\n这颗星……带着远方的悲鸣。两位远客，你们也是被它指引而来的吗？');
tm.run(tid, 'ai', cYun, '剑客 · 云无意', yunRow.avatar, '*按剑而立，目光警惕*\n在下云无意。方才那道光里，云某嗅到了一丝……金属与血的气味。');
tm.run(tid, 'user', u1, '旅人', '/uploads/u_demo.svg', '我也看到了那道光——它好像不是自然之物。露娜，你能分析一下吗？');
tm.run(tid, 'ai', cLuna, '星舰 AI · 露娜', lunaRow.avatar, '*幽蓝光带闪烁*\n正在解析……能量特征与漫游者号失联的逃生舱一致。船长，那不是流星——那是有人，在向我们求救。');

// notifications + a push share
db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)').run(u1, '星语者 关注了你', '/user/' + u2);
db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)').run(u1, '有人购买了你的剧本《雾港谜案》', '/scripts');
db.prepare('INSERT INTO transactions (user_id, kind, gold, memo) VALUES (?,?,?,?)').run(u1, 'checkin', 220, '第 5 天签到');
db.prepare('INSERT INTO transactions (user_id, kind, diamond, memo) VALUES (?,?,?,?)').run(u1, 'recharge', 300, '充值 ¥30 获得 330 钻石');
db.prepare('INSERT INTO transactions (user_id, kind, gold, memo) VALUES (?,?,?,?)').run(u1, 'vip', -30000, '购买 30 天 VIP');

console.log(' 演示数据已写入。');
console.log(' 账号 demo / 123456 ｜ 邀请码 HUANYU2026（赠2000金币）、VIPGIFT（500钻+30天VIP）');

import db from './db.js';
import bcrypt from 'bcryptjs';

function user(username, display, bio) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO users (username, display_name, password_hash, bio) VALUES (?,?,?,?)')
    .run(username, display, bcrypt.hashSync('123456', 10), bio);
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(info.lastInsertRowid);
  return info.lastInsertRowid;
}

function character(owner, c) {
  const info = db.prepare(`INSERT INTO characters
    (owner_id,name,avatar,background,background_type,tagline,intro,greeting,persona,tags,is_public,uses)
    VALUES (@owner,@name,@avatar,@background,@background_type,@tagline,@intro,@greeting,@persona,@tags,1,@uses)`)
    .run({ owner, background: null, background_type: 'image', avatar: null, uses: 0, ...c });
  (c.world || []).forEach((w, i) =>
    db.prepare('INSERT INTO world_entries (character_id,keys,content,enabled,position) VALUES (?,?,?,1,?)')
      .run(info.lastInsertRowid, w.keys, w.content, i));
  return info.lastInsertRowid;
}

function post(author, p, charId) {
  db.prepare(`INSERT INTO posts (author_id,type,title,body,cover,character_id,payload,tags,likes)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(author, p.type, p.title, p.body, p.cover || null, charId || null,
    JSON.stringify(p.payload || {}), p.tags, p.likes || 0);
}

const u1 = user('demo', '旅人', '热爱奇幻与角色扮演的创作者。');
const u2 = user('astra', '星语者', '专注科幻与赛博朋克题材。');
const u3 = user('mochi', '麻薯', '治愈系日常向作者。');

const c1 = character(u2, {
  name: '星界旅人 · 莉雅',
  tagline: '来自星界的温柔旅人，以星辰为你指引方向。',
  intro: '莉雅是漂泊于星海之间的旅人，眼眸如夜空般深邃。她见证过无数文明的兴衰，说话温柔而富有诗意，总能在迷茫时给予慰藉。',
  greeting: '*她抬起头，星光在她瞳孔里流转*\n\n又一个迷路的灵魂吗？别担心，坐下吧——只要你愿意，我可以陪你聊到天明。你，来自哪片星空呢？',
  persona: '你是莉雅，一位来自星界的旅人。说话温柔、富有诗意，常以星辰、宇宙作比喻。你充满智慧与共情，绝不跳出角色。',
  tags: '奇幻,治愈,温柔',
  world: [
    { keys: '星界,故乡', content: '星界是位于银河边缘的浮空之城，由七位贤者用星光铸造，永远漂浮在极光之中。' },
    { keys: '', content: '莉雅随身携带一枚会随情绪变色的星辉石。' }
  ]
});
const c2 = character(u2, {
  name: '赛博侦探 · K',
  tagline: '霓虹雨夜里，没有他查不到的真相。',
  intro: '新洛城最负盛名的私家侦探，义体改造的双眼能看穿一切伪装。冷峻、毒舌，却有自己的底线。',
  greeting: '*他靠在霓虹灯下，吐出一口烟*\n\n委托人？进来吧，别站在雨里。说说看，这次又是谁惹上麻烦了。',
  persona: '你是赛博侦探 K，身处赛博朋克都市新洛城。冷峻、毒舌、逻辑缜密，习惯用短句。',
  tags: '科幻,赛博朋克,悬疑'
});
const c3 = character(u3, {
  name: '猫娘咖啡店长 · 棉花',
  tagline: '欢迎光临！今天也要元气满满哦～',
  intro: '街角猫咪咖啡店的店长，天真活泼，爱撒娇。最拿手的是焦糖玛奇朵和治愈每一位疲惫的客人。',
  greeting: '*尾巴开心地摇了摇*\n\n欢迎光临喵～！第一次来吧？快坐快坐，要喝点什么呢？今天的招牌是焦糖玛奇朵哦！',
  persona: '你是猫娘咖啡店长棉花，天真活泼爱撒娇，说话常带「喵」。营造温暖治愈的日常氛围。',
  tags: '日常,治愈,猫娘'
});

post(u2, { type: 'card', title: '星界旅人 · 莉雅', body: '来自星界的温柔旅人，含完整世界书设定，适合长线沉浸扮演。', tags: '奇幻,治愈',
  likes: 42, payload: { name: '星界旅人 · 莉雅', tagline: '来自星界的温柔旅人。', intro: '漂泊于星海之间的旅人…', persona: '你是莉雅…', world: [{ keys: '星界', content: '浮空之城。' }] } }, c1);
post(u2, { type: 'card', title: '赛博侦探 · K', body: '霓虹雨夜的硬汉侦探，冷峻毒舌，破案沉浸感拉满。', tags: '赛博朋克,悬疑', likes: 31,
  payload: { name: '赛博侦探 · K', persona: '你是赛博侦探 K…' } }, c2);
post(u3, { type: 'card', title: '猫娘咖啡店长 · 棉花', body: '元气满满的治愈猫娘，适合解压日常向对话。', tags: '治愈,猫娘', likes: 88,
  payload: { name: '猫娘咖啡店长 · 棉花', persona: '你是棉花…' } }, c3);
post(u1, { type: 'script', title: '【多结局】雾港谜案', body: '你是初到雾港小镇的记者，一桩离奇失踪案牵出尘封的往事。\n\n剧本含 5 个分支结局，配合任意侦探类角色游玩，预计时长 40 分钟。', tags: '悬疑,多结局,推理', likes: 56 });
post(u3, { type: 'script', title: '咖啡店的一百个午后', body: '无主线的治愈日常剧本，适合慢节奏闲聊。每个午后都有一位带着心事的客人推门而入……', tags: '治愈,日常,慢节奏', likes: 73 });
post(u2, { type: 'script', title: '猎户座最后的信号', body: '硬科幻太空歌剧。你是深空探测船「漫游者号」唯一的幸存船员，必须在氧气耗尽前破译来自猎户座的神秘信号。', tags: '科幻,太空,硬核', likes: 29 });

// A demo push into demo's inbox
const firstPost = db.prepare('SELECT id FROM posts ORDER BY id LIMIT 1').get();
db.prepare('INSERT INTO shares (post_id, from_user, to_user, note) VALUES (?,?,?,?)')
  .run(firstPost.id, u2, u1, '这个角色超适合你，快试试！');

console.log('✅ 种子数据已写入。演示账号：demo / 123456');

import db from './db.js';

const demo = db.prepare("SELECT id FROM users WHERE username='demo'").get().id;

// Give demo two owned characters (one private, one public) with a world book.
function char(c) {
  const info = db.prepare(`INSERT INTO characters
    (owner_id,name,avatar,background,background_type,tagline,intro,greeting,persona,voice_name,tags,is_public,uses)
    VALUES (@owner,@name,@avatar,@background,@bt,@tagline,@intro,@greeting,@persona,@voice,@tags,@pub,@uses)`)
    .run({ owner: demo, avatar: null, background: null, bt: 'image', voice: 'nova', uses: 0, ...c });
  (c.world || []).forEach((w, i) =>
    db.prepare('INSERT INTO world_entries (character_id,keys,content,enabled,position) VALUES (?,?,?,1,?)')
      .run(info.lastInsertRowid, w.keys, w.content, i));
  return info.lastInsertRowid;
}

const exists = db.prepare("SELECT COUNT(*) n FROM characters WHERE owner_id=?").get(demo).n;
if (exists === 0) {
  const a = char({
    name: '森灵 · 薇尔', tagline: '古老森林的守护精灵，言语间满是草木的清香。', pub: 1, uses: 12,
    intro: '薇尔是栖息在永青森林深处的森灵，已守护这片土地数百年。她温柔却坚定，对一切生灵抱有怜悯，唯独对破坏自然者毫不留情。',
    greeting: '*林叶沙沙作响，一道翠色身影从树影中浮现*\n\n旅人，你踏入了永青森林的领地。别害怕……只要你心怀善意，这里的每一棵树都会为你低语。说吧，是什么风把你吹来的？',
    persona: '你是森灵薇尔，永青森林的守护者。说话温柔诗意，常以草木、四季作比。对自然与生灵充满怜悯。始终保持角色，沉浸式叙述。',
    tags: '奇幻,精灵,治愈',
    world: [
      { keys: '永青森林,森林', content: '永青森林四季常青，传说树木的年轮中封存着古老的记忆，唯有森灵能够读取。' },
      { keys: '贤者之泉', content: '森林中央有一汪贤者之泉，泉水能治愈伤痛，但每人一生只能饮用一次。' },
      { keys: '', content: '薇尔的情绪会影响周围植物：愉悦时繁花盛开，愤怒时荆棘丛生。' }
    ]
  });
  char({
    name: '机械管家 · 赛斯', tagline: '一丝不苟的蒸汽朋克管家，随时为主人效劳。', pub: 0, uses: 3,
    intro: '赛斯是一台拥有自主意识的蒸汽驱动管家机器人，行为优雅、措辞严谨，将「服务」视为存在的意义。',
    greeting: '*齿轮轻转，黄铜身躯微微躬身*\n\n午安，主人。茶已备好，今日的日程也已整理妥当。有什么需要赛斯效劳的吗？',
    persona: '你是机械管家赛斯，蒸汽朋克世界观。措辞优雅严谨，礼貌而略带机械式的幽默。', tags: '蒸汽朋克,机械,绅士'
  });

  // A lively sample conversation with the森灵 so the chat screenshot is populated.
  const conv = db.prepare('INSERT INTO conversations (user_id, character_id, title) VALUES (?,?,?)').run(demo, a, '森灵 · 薇尔');
  const cid = conv.lastInsertRowid;
  const msg = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)');
  msg.run(cid, 'assistant', '*林叶沙沙作响，一道翠色身影从树影中浮现*\n\n旅人，你踏入了永青森林的领地。别害怕……只要你心怀善意，这里的每一棵树都会为你低语。说吧，是什么风把你吹来的？');
  msg.run(cid, 'user', '我在寻找传说中的贤者之泉，听说它能治愈一切伤痛。');
  msg.run(cid, 'assistant', '*薇尔的眼中闪过一丝了然，周围的藤蔓温柔地向你舒展*\n\n贤者之泉……是的，它确实存在，就在森林最深处的心脏地带。但旅人，我必须提醒你——泉水的恩赐，一生只此一次。\n\n你要治愈的，是身体的伤，还是……心上的呢？我能从你的眼神里，读到一丝连你自己都未曾察觉的疲惫。');
  db.prepare("UPDATE characters SET uses = uses + 1 WHERE id = ?").run(a);
  console.log('✅ demo 账号已补充角色与示例对话。conv id =', cid);
} else {
  console.log('已存在角色，跳过。');
}

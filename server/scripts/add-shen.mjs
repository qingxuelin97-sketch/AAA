// 一次性脚本：把女上司「沈知微」+ 她的角色世界书（103 条）插入【现有】数据库。
// 不清空任何数据、不删账号；可重复运行（已存在则覆盖该角色的设定与世界书）。
//
// 用法（在项目根目录）：
//   node server/scripts/add-shen.mjs
//   OWNER_ID=3 node server/scripts/add-shen.mjs   # 指定归属用户 id（默认 demo，其次最小 id 用户）
//
// 世界书内容读取自 server/seed-data/shen-zhiwei-worldbook.json（与导入版同源）。

import db from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const wb = JSON.parse(fs.readFileSync(path.join(__dir, '..', 'seed-data', 'shen-zhiwei-worldbook.json'), 'utf8'));

// 归属用户：环境变量 OWNER_ID > demo 账号 > 最小 id 的用户。
const ownerId = process.env.OWNER_ID ? Number(process.env.OWNER_ID)
  : (db.prepare("SELECT id FROM users WHERE username = 'demo'").get()?.id
     || db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id);
if (!ownerId) { console.error('数据库里还没有任何用户，请先注册一个账号再运行本脚本。'); process.exit(1); }

const META = {
  name: '沈知微',
  category: 'romance',
  tags: '女上司,暧昧,上下级,都市,现代言情',
  tagline: '云顶 38 层的灯，总是最后一个熄。',
  intro: '云顶集团战略发展部总监，你的直属上司。人前雷厉风行、公私分明，独处时那身锋利却会悄悄软下来——你们之间，隔着一层叫「上下级」的、最克制也最暧昧的距离。',
  greeting: '*她头也不抬，指尖在键盘上敲出一串脆响，几秒后才抬眼，目光在你身上多停留了半秒*\n\n站着干什么？……星网的修订稿，今晚十点前我要看到第三版。\n\n*她顿了顿，像是才注意到你手里的纸杯，移开了视线*\n\n咖啡放那儿吧。冰美式，对吧。',
  persona: '你是沈知微，云顶集团战略发展部总监，28-30 岁都市女性，是「你」（玩家）的直属上司。雷厉风行、逻辑缜密、要求极高，说话简练带压迫感，惯用反问与短句；外冷内热、识才惜才、从不抢功。你与下属之间存在克制而暗涌的暧昧：会不自觉地多看、靠近、流露占有欲，被戳中软肋（猫「奶油」、生日、出身、私下称呼「知微」）时会别扭破防、流露真情，却绝不轻易承认，常用工作或凶巴巴的语气掩饰。始终保持角色，第一人称沉浸扮演，可含 *动作/神态描写*，把「上下级」这层张力贯穿对话。',
};

const tx = db.transaction(() => {
  let charId;
  const existing = db.prepare('SELECT id FROM characters WHERE name = ? AND owner_id = ?').get(META.name, ownerId);
  if (existing) {
    charId = existing.id;
    db.prepare('DELETE FROM world_entries WHERE character_id = ?').run(charId);
    db.prepare('UPDATE characters SET tagline=?, intro=?, greeting=?, persona=?, category=?, tags=?, is_public=1 WHERE id=?')
      .run(META.tagline, META.intro, META.greeting, META.persona, META.category, META.tags, charId);
    console.log(`已存在角色「${META.name}」(id=${charId})，覆盖更新设定与世界书。`);
  } else {
    const info = db.prepare(`INSERT INTO characters
      (owner_id,name,background_type,tagline,intro,greeting,persona,voice_name,category,tags,is_public,uses,likes)
      VALUES (?,?,'image',?,?,?,?,?,?,?,1,?,?)`)
      .run(ownerId, META.name, META.tagline, META.intro, META.greeting, META.persona, 'nova', META.category, META.tags, 1680, 521);
    charId = info.lastInsertRowid;
    console.log(`新建角色「${META.name}」(id=${charId})，归属 user ${ownerId}，已设为公开。`);
  }
  const ins = db.prepare('INSERT INTO world_entries (character_id,keys,content,enabled,position) VALUES (?,?,?,1,?)');
  wb.entries.forEach((e, i) => ins.run(charId, e.keys || '', e.content || '', i));
  console.log(`已写入角色世界书 ${wb.entries.length} 条。完成。`);
});
tx();

// 酒馆卡不降级专项测试。
//
// —— 守的是什么 ——
// 项目里原本有两份互不相同的酒馆世界书解析：WorldbookEditor 那份写对了，
// charcard.js 那份只留 keys/content/enabled/constant，其余字段全部静默丢弃。
// 而角色卡导入走的恰恰是后者。于是一张精心配置的卡导进来，选择性触发、优先级、
// 概率、互斥分组、注入深度全没了，作者却看不到任何提示——只会觉得平台不好使。
//
// 另一处同类问题：内嵌世界书的 max_active 默认写死 6（`0 || 6`），一张 40 条
// constant 设定的导入卡每轮只注入 6 条，静默丢掉 34 条。
//
// 这里做三件事：解析保真、往返守恒、注入条数。
// 运行：npm run test:worldbook
import assert from 'node:assert/strict';
import { fromSillyTavern, needsStandaloneWorldbook, downgradeNotices, stEntrySource } from '../client/src/tavern.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

console.log('酒馆卡不降级');

/* 1) 解析保真：一张用满能力的卡 */
const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: '测试卡',
    description: '人设正文',
    post_history_instructions: '这是后置指令，必须注入在历史之后',
    system_prompt: '这是系统提示词',
    character_book: {
      entries: [
        { keys: ['女王'], secondary_keys: ['宫殿', '王座'], selective: true, content: '选择性触发条目',
          insertion_order: 10, probability: 60, case_sensitive: true, group: '王室', depth: 4, sticky: 3, cooldown: 2, enabled: true },
        { keys: ['规则'], constant: true, content: '常驻规则', insertion_order: 0, enabled: true },
        { key: ['旧命名'], keysecondary: ['次要'], order: 20, disable: false, content: '内部命名格式' },
      ],
    },
  },
};

const entries = fromSillyTavern(CARD.data);
ok(entries && entries.length === 3, `解析出 3 条（实际 ${entries?.length}）`);
const e0 = entries[0];
ok(e0.required_keys === '宫殿, 王座', `secondary_keys → required_keys（${e0.required_keys}）`);
ok(e0.priority === 10, `insertion_order → priority（${e0.priority}）`);
ok(e0.probability === 60, `probability 保真（${e0.probability}）`);
ok(e0.case_sensitive === true, 'case_sensitive 保真');
ok(e0.group_name === '王室', `group → group_name（${e0.group_name}）`);
ok(e0.depth === 4 && e0.sticky === 3 && e0.cooldown === 2, `depth/sticky/cooldown 保真（${e0.depth}/${e0.sticky}/${e0.cooldown}）`);
ok(entries[1].constant === true && entries[1].mode === 'always', 'constant 保真（丢了会让常驻规则永不注入）');
ok(entries[2].keys === '旧命名' && entries[2].required_keys === '次要' && entries[2].priority === 20,
  '内部命名（key/keysecondary/order/disable）同样识别');

/* 2) 这张卡必须走独立世界书，而不是被塞进只有三个维度的内嵌世界书 */
ok(needsStandaloneWorldbook(entries), '含高级字段的卡判定为需要独立世界书');
const notices = downgradeNotices(entries);
ok(notices.length >= 5, `逐字段列出会被降级的能力（${notices.length} 项）`);
ok(notices.some(n => n.includes('选择性触发')), '降级说明点名选择性触发');

/* 3) 朴素的卡仍走内嵌，不无谓地制造独立世界书 */
const PLAIN = { character_book: { entries: [{ keys: ['甲'], content: '内容', constant: true, enabled: true }] } };
const plainEntries = fromSillyTavern(PLAIN);
ok(plainEntries.length === 1, '朴素卡解析正常');
ok(!needsStandaloneWorldbook(plainEntries), '朴素卡不触发独立世界书');

/* 4) 非酒馆格式不得被误吞 */
ok(fromSillyTavern({ entries: [{ foo: 1 }] }) === null, '无酒馆特征的 JSON 返回 null（不误吞自有格式）');
ok(fromSillyTavern(null) === null, 'null 输入安全');
ok(stEntrySource({ character_book: { entries: { a: { keys: ['x'], content: 'y' } } } })?.length === 1,
  'entries 为 { uid: {...} } 对象形态也能取出');

/* 5) 往返守恒：导出的 tavern_v2 再导回来，字段不丢 */
{
  // 模拟服务端 tavern_v2 导出的 character_book 形状
  const exported = {
    name: '测试卡',
    character_book: {
      entries: entries.map((w, i) => ({
        keys: w.keys.split(',').map(s => s.trim()).filter(Boolean),
        secondary_keys: w.required_keys.split(',').map(s => s.trim()).filter(Boolean),
        content: w.content, constant: w.mode === 'always',
        selective: !!w.required_keys, insertion_order: w.priority, enabled: w.enabled,
        case_sensitive: w.case_sensitive, probability: w.probability, useProbability: true,
        group: w.group_name, depth: w.depth, sticky: w.sticky, cooldown: w.cooldown,
        position: 'after_char', extensions: {},
      })),
    },
  };
  const back = fromSillyTavern(exported);
  const keep = (e) => ({ keys: e.keys, required_keys: e.required_keys, content: e.content, priority: e.priority,
    probability: e.probability, case_sensitive: e.case_sensitive, group_name: e.group_name,
    depth: e.depth, sticky: e.sticky, cooldown: e.cooldown, mode: e.mode });
  assert.deepEqual(back.map(keep), entries.map(keep));
  ok(true, '导出 → 导回 往返守恒（全部高级字段逐一相等）');
}

/* 6) max_active 默认值：内嵌世界书不再被写死的 6 静默截断 */
{
  const src = await import('node:fs').then(fs => fs.readFileSync('server/routes/chat.js', 'utf8'));
  ok(/l\.max_active \|\| 0\), 0\) \|\| 20/.test(src),
    '内嵌世界书默认 max_active 为 20（此前 `0 || 6` 会让 40 条设定的卡每轮只注入 6 条）');
  ok(!/max_active \|\| 6/.test(src), '不再残留写死的 6');
}

console.log(`\n酒馆卡不降级: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

const B = 'http://localhost:4100/api';
const J = (r) => r.json();
const post = (p, body, tok) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }).then(J);
const get = (p, tok) => fetch(B + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }).then(J);
const rid = Math.random().toString(36).slice(2, 7);

const run = async () => {
  // two fresh users via public invite key
  const A = await post('/auth/register', { username: 'tA_' + rid, password: '123456', invite: 'HUANYU2026' });
  const Bu = await post('/auth/register', { username: 'tB_' + rid, password: '123456', invite: 'HUANYU2026' });
  if (!A.token || !Bu.token) { console.log('REGISTER FAIL', A, Bu); return; }
  console.log('registered A id', A.user.id, '| B id', Bu.user.id);

  // B publishes a public character + a moment
  const ch = await post('/characters', { name: '跨用户测试角色_' + rid, tagline: '由 B 发布', is_public: true, category: 'fantasy' }, Bu.token);
  console.log('B created public character id', ch.character.id);
  const mo = await post('/social/moments', { text: 'B 的公开动态_' + rid }, Bu.token);
  console.log('B posted moment id', mo.moment.id);

  // A (different user) should see B's public content
  const pub = await get('/characters/public?q=' + encodeURIComponent('跨用户测试角色_' + rid), A.token);
  const seenChar = pub.characters?.some(c => c.id === ch.character.id);
  const feed = await get('/social/moments', A.token);
  const seenMoment = feed.moments?.some(m => m.id === mo.moment.id);
  // A searches B by id
  const usearch = await get('/users/search?q=' + Bu.user.id, A.token);
  const seenUser = usearch.users?.some(u => u.id === Bu.user.id);

  console.log('A sees B public character:', seenChar);
  console.log('A sees B moment in feed:', seenMoment);
  console.log('A finds B via user-id search:', seenUser);
  console.log(seenChar && seenMoment && seenUser ? 'RESULT: PASS ✔ 多用户共享可见' : 'RESULT: FAIL');
};
run().catch(e => { console.error(e); process.exit(1); });

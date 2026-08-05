// 日志板块回归测试：客户端批量摄入 / level 钳制 / 链路过滤 / 保留策略钳制 /
// 阈值告警 / 导出格式 / 定向清理 / 审计留痕。跑法：npm run test:logs
//
// 为什么单独存在：日志是「排查一切问题的地基」，它自己坏了没有别的系统能
// 发现它 —— 批量上报静默丢失、告警发给全员、fatal 投毒这类回归全部无声。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4197;
const DB_PATH = path.join(__dirname, 'logstest.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const run = (cmd, args, env) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? res() : rej(new Error(cmd + ' exited ' + code))));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('· 灌入临时演示数据…');
await run('node', ['server/seed.js'], { DB_PATH });

console.log('· 启动服务端…');
const srv = spawn('node', ['server/index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH }, stdio: 'ignore' });

let ok = true;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* */ } await sleep(250); }
  // demo 在 seed 里是 GM（admin/logs 全家桶需要 GM 权限）
  const tok = (await (await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: '123456' }),
  })).json()).token;
  const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const j = async (p, init) => (await fetch(BASE + p, { headers: H, ...init })).json();
  const me = await j('/auth/me');
  const uid = me.user.id;
  const db = new Database(DB_PATH);

  /* ── 1. 客户端批量摄入（历史 bug：只解析单条字段，批量整包丢失）── */
  const batchRes = await (await fetch(BASE + '/logs/client', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch: [
        { level: 'info', event: 'logstest_batch_a', message: '批量样本A', session_id: 'sess-logstest-1' },
        { level: 'warn', event: 'logstest_batch_b', message: '批量样本B', session_id: 'sess-logstest-1' },
        { level: 'error', event: 'logstest_batch_c', message: '批量样本C', session_id: 'sess-logstest-1', request_id: 'req-logstest-chain1' },
      ],
    }),
  })).json();
  assert.equal(batchRes.accepted, 3, `批量上报 3 条应全部受理（got ${JSON.stringify(batchRes)}）`);
  const got = await j('/admin/logs?' + new URLSearchParams({ event: 'logstest_batch_b' }));
  assert.equal(got.total, 1, '批量中的每条都必须独立落库');
  assert.equal(got.rows[0].message, '批量样本B');
  assert.equal(got.rows[0].source, 'client');
  console.log('  ✅ 批量摄入：{batch:[...]} 逐条落库');

  /* ── 2. level 钳制：客户端不得自报 fatal（防 GM 告警轰炸/投毒）── */
  await fetch(BASE + '/logs/client', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'fatal', event: 'logstest_poison', message: '投毒样本' }),
  });
  const poisoned = await j('/admin/logs?' + new URLSearchParams({ event: 'logstest_poison' }));
  assert.equal(poisoned.rows[0]?.level, 'error', `客户端 fatal 必须降级为 error（got ${poisoned.rows[0]?.level}）`);
  await fetch(BASE + '/logs/client', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'bogus', event: 'logstest_bogus_level', message: '非法级别' }),
  });
  const bogus = await j('/admin/logs?' + new URLSearchParams({ event: 'logstest_bogus_level' }));
  assert.equal(bogus.rows[0]?.level, 'info', '非法级别必须回落 info');
  console.log('  ✅ level 钳制：fatal→error，非法→info');

  /* ── 3. 去重计数透传：count=5 的汇总条目按 5 计入 ── */
  await fetch(BASE + '/logs/client', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'warn', event: 'logstest_count', message: '重复汇总样本', count: 5 }),
  });
  const counted = await j('/admin/logs?' + new URLSearchParams({ event: 'logstest_count' }));
  assert.equal(counted.rows[0]?.count, 5, `count 透传应为 5（got ${counted.rows[0]?.count}）`);
  console.log('  ✅ 去重计数透传：count=5 落库');

  /* ── 4. 链路过滤：request_id / session_id / fingerprint / status_class ── */
  const chain = await j('/admin/logs?' + new URLSearchParams({ request_id: 'req-logstest-chain1' }));
  assert.ok(chain.total >= 1, 'request_id 精确过滤应命中批量样本C');
  assert.ok(chain.rows.every(r => r.request_id === 'req-logstest-chain1'));
  const sess = await j('/admin/logs?' + new URLSearchParams({ session_id: 'sess-logstest-1' }));
  assert.ok(sess.total >= 3, `session_id 过滤应命中同会话 3 条（got ${sess.total}）`);
  const fp = chain.rows[0].fingerprint;
  const byFp = await j('/admin/logs?' + new URLSearchParams({ fingerprint: fp }));
  assert.ok(byFp.rows.length >= 1 && byFp.rows.every(r => r.fingerprint === fp), '指纹过滤只返回同指纹');
  await fetch(BASE + '/definitely-not-a-route');
  await sleep(300); // 访问日志在 res finish 后写入
  const s4 = await j('/admin/logs?' + new URLSearchParams({ status_class: '4', category: 'api' }));
  assert.ok(s4.total >= 1, '4xx 状态码分档过滤应命中访问日志');
  assert.ok(s4.rows.every(r => r.status >= 400 && r.status < 500));
  console.log('  ✅ 链路过滤：request_id / session_id / fingerprint / status_class');

  /* ── 5. 统计与时序增强 ── */
  const { stats } = await j('/admin/logs/stats');
  assert.ok(stats.api_24h && typeof stats.api_24h.error_rate === 'number', '统计应含 24h 接口聚合与错误率');
  assert.ok(Array.isArray(stats.api_24h.by_status_class), '统计应含状态码分档分布');
  const { series } = await j('/admin/logs/timeseries?window=hour');
  assert.equal(series.length, 24, `24 小时时序必须零填充为 24 桶（got ${series.length}）`);
  assert.ok(series.every(b => typeof b.errors === 'number'), '每桶都要有错误分项计数');
  const { top } = await j('/admin/logs/top?dim=slow');
  assert.ok(Array.isArray(top), '慢接口榜应返回数组');
  console.log('  ✅ 统计/时序：api_24h、24 桶零填充、慢接口榜');

  /* ── 6. 保留策略：GM 可调 + 1–365 钳制 ── */
  const ret = await j('/admin/logs/retention', { method: 'PUT', body: JSON.stringify({ debug: 9999, info: 0 }) });
  assert.equal(ret.retention.debug, 365, '保留天数上限钳制 365');
  assert.equal(ret.retention.info, 1, '保留天数下限钳制 1');
  await j('/admin/logs/retention', { method: 'PUT', body: JSON.stringify({ debug: 3, info: 7 }) });
  console.log('  ✅ 保留策略：可配置且 1–365 钳制');

  /* ── 7. 阈值告警：窗口内错误达标 → 站内通知全体 GM ── */
  await j('/admin/logs/alerts', { method: 'PUT', body: JSON.stringify({ enabled: true, threshold: 3, window_min: 5, cooldown_min: 15 }) });
  await fetch(BASE + '/logs/client', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch: [
        { level: 'error', event: 'logstest_storm_1', message: '风暴样本一' },
        { level: 'error', event: 'logstest_storm_2', message: '风暴样本二' },
        { level: 'error', event: 'logstest_storm_3', message: '风暴样本三' },
      ],
    }),
  });
  await sleep(300);
  const alertNote = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND text LIKE '%日志告警%' ORDER BY id DESC LIMIT 1").get(uid);
  assert.ok(alertNote, '错误达到阈值后 GM 必须收到站内告警通知');
  const fired = await j('/admin/logs?' + new URLSearchParams({ event: 'log_alert_fired' }));
  assert.ok(fired.total >= 1, '告警触发本身要留痕（log_alert_fired）');
  console.log('  ✅ 阈值告警：3 条错误触发 GM 站内通知 + 留痕');

  /* ── 8. 导出：CSV / NDJSON 格式与审计留痕 ── */
  const csvRes = await fetch(BASE + '/admin/logs/export?format=csv', { headers: H });
  assert.equal(csvRes.status, 200);
  assert.ok((csvRes.headers.get('content-type') || '').startsWith('text/csv'), 'CSV 导出 Content-Type');
  const csvText = await csvRes.text();
  assert.ok(csvText.includes('id,ts,level'), 'CSV 首行应为表头');
  const ndRes = await fetch(BASE + '/admin/logs/export?format=ndjson&limit=5', { headers: H });
  const ndText = await ndRes.text();
  assert.ok(ndText.split('\n').every(l => { JSON.parse(l); return true; }), 'NDJSON 每行都是合法 JSON');
  const auditExport = await j('/admin/logs?' + new URLSearchParams({ category: 'admin', event: 'logs_export' }));
  assert.ok(auditExport.total >= 1, '导出行为必须进审计');
  console.log('  ✅ 导出：CSV/NDJSON 格式正确且留审计');

  /* ── 9. 定向清理：level+days ── */
  db.prepare(`INSERT INTO logs (ts, level, source, category, event, message) VALUES (datetime('now', '-40 days'), 'debug', 'server', 'system', 'logstest_old', '过期样本')`).run();
  const purged = await j('/admin/logs/purge', { method: 'POST', body: JSON.stringify({ level: 'debug', days: 30 }) });
  assert.ok(purged.removed >= 1, `定向清理应删除 40 天前的 debug 样本（got ${purged.removed}）`);
  const gone = await j('/admin/logs?' + new URLSearchParams({ event: 'logstest_old' }));
  assert.equal(gone.total, 0, '被清理的日志不应再查得到');
  console.log('  ✅ 定向清理：level=debug & days=30 生效');

  /* ── 10. 敏感配置审计：告警/保留规则修改留痕 ── */
  const auditCfg = await j('/admin/logs?' + new URLSearchParams({ category: 'admin', event: 'logs_alerts' }));
  assert.ok(auditCfg.total >= 1, '告警规则修改必须进审计');
  console.log('  ✅ 审计：日志配置修改留痕');

  db.close();
  console.log('\n日志板块回归：全部通过 ✅');
} catch (e) {
  ok = false;
  console.error('\n❌ 日志板块回归失败：', e);
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
process.exit(ok ? 0 : 1);

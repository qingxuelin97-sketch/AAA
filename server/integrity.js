// 设备完整性评估 —— root / 越狱 / 篡改信号的服务端收敛点。
//
// 两层信号，可信度天差地别（切勿混为一谈）：
//   1) Play Integrity 令牌（Android）：设备完整性判定由 Google 硬件背书、
//      **在这里服务器侧验签**。签名不在客户端手里 → 客户端伪造不了，是
//      唯一的硬信号。需配置 PLAY_INTEGRITY_* 才启用；未配置时此层沉默。
//   2) 客户端自报的被动 root 信号（su 路径 / test-keys 构建 / 已知超级用户
//      管理器包名等）：跑在被检测设备上、由客户端上报 —— 而 root 用户恰恰
//      能改客户端让它永远报「干净」。因此它只拦老实的 root 用户与低成本
//      脚本，是**软信号**，仅作补充，绝不作为安全边界。
//
// assessDevice 归一为三态：
//   · 'tampered'：判定为被篡改/root（硬信号确诊，或软信号自报 rooted）；
//   · 'ok'      ：Play Integrity 确认设备完整（仅硬信号能给出可信 ok）；
//   · 'unknown' ：无任何可用信号（Web 壳、未接原生插件的旧包、iOS 无令牌）。
//     unknown 永不触发拦截 —— 主力场景（浏览器 / 尚未接原生检测的用户）
//     不能被误伤。
//
// 处置策略由 routes/auth.js 按 DEVICE_INTEGRITY_POLICY 决定（enforce 拦注册
// / monitor 仅审计），本模块只负责「判定」，不负责「处置」。

// 请求头 X-Device-Integrity 的解析：客户端上报的紧凑 JSON。
//   { r: 0|1, t: '<play-integrity-jws>' }
//     r —— 客户端被动 root 自报（软信号）
//     t —— Play Integrity 令牌（硬信号，交给 verifyPlayIntegrity 验签）
// 该头本质是客户端自报，只作信号与审计，不承担鉴权；格式不合法即整体丢弃。
export function parseIntegrity(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 8192) return {};
  let obj;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  if (obj.r === 1 || obj.r === true) out.rooted = true;
  else if (obj.r === 0 || obj.r === false) out.rooted = false;
  if (typeof obj.t === 'string' && obj.t.length > 0 && obj.t.length <= 8000) out.token = obj.t;
  return out;
}

// Play Integrity 令牌验签 —— 预留集成点。
//
// 真正启用需要（均为部署侧配置，不入库不硬编码）：
//   · 在 Google Play Console 开启 Play Integrity API，拿到项目号；
//   · 服务端用 google-auth 解密/校验令牌，读取 deviceIntegrity 判定：
//       tampered  ⇐ deviceRecognitionVerdict 不含 MEETS_DEVICE_INTEGRITY
//       ok        ⇐ 含 MEETS_DEVICE_INTEGRITY（且 MEETS_BASIC_INTEGRITY）
//     并校验 nonce / requestHash / packageName 防重放与套壳。
//
// 未配置（PLAY_INTEGRITY_ENABLED 未开或缺依赖）时返回 null（= 判定 unknown），
// 决不伪造判定 —— 宁可缺这层硬信号，也不给「装了就安全」的假象。
// 具体校验实现落地后填充此函数体即可，其余链路（入库/闸门/审计）已就位。
export function verifyPlayIntegrity(token) {
  if (!token) return null;
  if (process.env.PLAY_INTEGRITY_ENABLED !== '1') return null;
  // 集成点：此处接 Google Play Integrity 解密与判定，返回：
  //   { verdict: 'tampered' | 'ok', source: 'play_integrity' }
  // 在验证器接好之前，保守返回 null（视为 unknown，落到软信号兜底）。
  return null;
}

// 汇总判定。硬信号（Play Integrity）优先；缺失时回落到软信号（客户端自报
// rooted）。注意：软信号只认「自报 rooted=true」这一个可行动方向；rooted=false
// 不可信（能被改），一律按 unknown 处理，绝不据此给出可信 ok。
export function assessDevice(sig) {
  const pi = verifyPlayIntegrity(sig.token);
  if (pi && (pi.verdict === 'tampered' || pi.verdict === 'ok')) {
    return { verdict: pi.verdict, source: 'play_integrity' };
  }
  if (sig.rooted === true) return { verdict: 'tampered', source: 'client_signal' };
  return { verdict: 'unknown', source: 'none' };
}

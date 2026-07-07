import nodemailer from 'nodemailer';
import db from './db.js';

// 邮件服务配置（SMTP）。优先级：环境变量 > app_config('mail') > 默认空。
// GM 可在后台「平台 · 邮件」标签页配置；密钥仅存服务端 DB，永不下发明文。
// 注意：ENV 中只有「环境变量显式设置」时字段才非空，否则留空让 DB 接管，
//       避免默认值覆盖 GM 在后台保存的配置。
const ENV = {
  host: process.env.SMTP_HOST || '',
  port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : null,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || '',
  site_name: process.env.SITE_NAME || '',
  code_ttl_min: process.env.MAIL_CODE_TTL_MIN ? Number(process.env.MAIL_CODE_TTL_MIN) : null,
};

const DEFAULTS = {
  host: '', port: 465, secure: true, user: '', pass: '', from: '',
  site_name: '幻域 HUANYU', code_ttl_min: 10,
};

function read() {
  const row = db.prepare("SELECT value FROM app_config WHERE key='mail'").get();
  let cfg = {};
  if (row) { try { cfg = JSON.parse(row.value); } catch { cfg = {}; } }
  // 合并顺序：DEFAULTS < DB(cfg) < ENV（仅当 ENV 显式设置时覆盖）
  const merged = { ...DEFAULTS, ...cfg };
  if (ENV.host) merged.host = ENV.host;
  if (ENV.port != null) merged.port = ENV.port;
  if (ENV.secure != null) merged.secure = ENV.secure;
  if (ENV.user) merged.user = ENV.user;
  if (ENV.pass) merged.pass = ENV.pass;
  if (ENV.from) merged.from = ENV.from;
  if (ENV.site_name) merged.site_name = ENV.site_name;
  if (ENV.code_ttl_min != null) merged.code_ttl_min = ENV.code_ttl_min;
  return merged;
}

function write(cfg) {
  db.prepare("INSERT INTO app_config (key, value) VALUES ('mail', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(cfg));
}

export function getMail() {
  const c = read();
  return {
    host: c.host, port: c.port, secure: !!c.secure,
    user: c.user, from: c.from, site_name: c.site_name, code_ttl_min: c.code_ttl_min,
    // 密钥脱敏：仅返回是否已设置 + 掩码
    pass_set: !!c.pass, pass_masked: c.pass ? c.pass.slice(0, 2) + '••••' + c.pass.slice(-2) : '',
    ready: !!(c.host && c.user && c.pass && c.from),
    from_env: !!(ENV.host && ENV.user && ENV.pass && ENV.from),
  };
}

export function updateMail(body = {}) {
  const c = read();
  // 环境变量已配置的字段不允许在 DB 中改写（保持环境变量优先级）
  if (!ENV.host && typeof body.host === 'string') c.host = body.host.trim();
  if (ENV.port == null && typeof body.port === 'number') c.port = body.port;
  if (ENV.secure == null && typeof body.secure === 'boolean') c.secure = body.secure;
  if (!ENV.user && typeof body.user === 'string') c.user = body.user.trim();
  if (!ENV.pass && typeof body.pass === 'string' && body.pass.trim()) c.pass = body.pass.trim();
  if (!ENV.from && typeof body.from === 'string') c.from = body.from.trim();
  if (!ENV.site_name && typeof body.site_name === 'string') c.site_name = body.site_name.trim();
  if (ENV.code_ttl_min == null && typeof body.code_ttl_min === 'number') c.code_ttl_min = body.code_ttl_min;
  write(c);
  return getMail();
}

// 构建可复用的 transport（每次发信时按当前配置重建；配置变化后立即生效）。
function transporter() {
  const c = read();
  if (!c.host || !c.user || !c.pass) return null;
  return nodemailer.createTransport({
    host: c.host,
    port: c.port || 465,
    secure: c.secure !== false,
    auth: { user: c.user, pass: c.pass },
  }, { from: c.from || c.user });
}

// 发送验证码邮件。返回 { ok, error? }。
export async function sendVerifyCode(email, code) {
  const c = read();
  if (!c.host || !c.user || !c.pass || !c.from) {
    return { ok: false, error: '邮件服务未配置，请联系管理员' };
  }
  const tp = transporter();
  if (!tp) return { ok: false, error: '邮件服务不可用' };
  const ttl = c.code_ttl_min || 10;
  const site = c.site_name || '幻域';
  const html = `
<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#191917;background:#faf9f5;border-radius:14px;overflow:hidden;border:1px solid #e8e5db">
  <div style="padding:22px 26px;background:linear-gradient(135deg,#e0885f,#c25a38 58%,#a04a48);color:#fff">
    <div style="font-size:18px;font-weight:700;letter-spacing:0.5px">${site}</div>
    <div style="font-size:12.5px;opacity:0.92;margin-top:2px">邮箱验证码</div>
  </div>
  <div style="padding:26px">
    <div style="font-size:14px;line-height:1.7;color:#3a3833">你好！你正在 <b>${site}</b> 注册账号。请使用下面的验证码完成注册：</div>
    <div style="margin:22px 0;text-align:center">
      <span style="display:inline-block;font-size:30px;font-weight:700;letter-spacing:8px;color:#c25a38;background:#f7e8e1;border:1px dashed #d97757;border-radius:12px;padding:14px 28px;font-family:'Courier New',monospace">${code}</span>
    </div>
    <div style="font-size:12.5px;color:#6b6760;line-height:1.7">
      · 验证码 ${ttl} 分钟内有效，请尽快使用。<br/>
      · 若非你本人操作，请忽略此邮件，无需任何处理。<br/>
      · 请勿将验证码泄露给任何人，${site} 工作人员绝不会向你索取验证码。
    </div>
  </div>
  <div style="padding:14px 26px;background:#f1efe8;font-size:11.5px;color:#a39d90;text-align:center;border-top:1px solid #e8e5db">
    © ${new Date().getFullYear()} ${site} · 本邮件由系统自动发送，请勿直接回复
  </div>
</div>`;
  const text = `【${site}】你的注册验证码是：${code}，${ttl} 分钟内有效。如非本人操作请忽略。`;
  try {
    await tp.sendMail({
      from: c.from, to: email,
      subject: `【${site}】注册验证码 ${code}`,
      text, html,
    });
    return { ok: true };
  } catch (e) {
    console.error('[mail] 发送验证码失败：', e.message);
    return { ok: false, error: '邮件发送失败：' + (e.message || '未知错误') };
  }
}

// SMTP 连通性自检（GM 后台「测试连接」按钮调用）。
export async function testMailConn(body = {}) {
  const cur = read();
  const cfg = {
    host: body.host || cur.host,
    port: body.port || cur.port,
    secure: body.secure !== undefined ? !!body.secure : !!cur.secure,
    auth: { user: body.user || cur.user, pass: (body.pass && body.pass.trim()) ? body.pass.trim() : cur.pass },
  };
  if (!cfg.host || !cfg.auth.user || !cfg.auth.pass) return { ok: false, message: '请先填写 SMTP 主机 / 账号 / 密码' };
  const t0 = Date.now();
  try {
    const tp = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.auth });
    await tp.verify();
    return { ok: true, message: '连接成功，SMTP 配置可用', latency_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: '连接失败：' + (e.message || '未知错误'), latency_ms: Date.now() - t0 };
  }
}

// 是否启用环境变量模式（环境变量配置后，后台相关字段不可改）
export const mailFromEnv = () => !!(ENV.host && ENV.user && ENV.pass);

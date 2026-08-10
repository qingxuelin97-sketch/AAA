import { getPlatform } from './platform.js';
import { safeFetch } from './safeUrl.js';

// 一次性（非流式）补全。原本只存在于 routes/novels.js 内部，摘要功能同样需要，
// 与其复制第二份不如收敛到这里——SSRF 防护的写法一旦分叉，第二份多半会写漏。
//
// 用户自填 base_url 不可信：safeFetch 做 DNS 复检 + 逐跳重定向复检 + 超时，
// 防止「域名解析到内网 / 公网 302 跳内网」绕过同步校验。平台配置由 GM 控制台
// 设置、视为可信，走原生 fetch（可能部署在内网）。
export async function llmOnce(eff, system, user, { maxTokens = 1200, temperature, timeoutMs = 60000 } = {}) {
  const doFetch = eff.platform ? fetch : (u, o) => safeFetch(u, o, { timeoutMs });
  const url = `${String(eff.base_url || '').split('?')[0].replace(/\/$/, '')}/chat/completions`;
  const r = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
    body: JSON.stringify({
      model: eff.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: temperature ?? eff.temperature ?? 0.8, max_tokens: maxTokens, stream: false,
    }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`模型服务返回 ${r.status}：${t.slice(0, 160)}`); }
  const d = await r.json().catch(() => ({}));
  return (d.choices?.[0]?.message?.content || '').trim();
}

// 统一「本次请求用哪套 LLM 凭据」的判定：用户自带 Key（免费）优先，否则回退
// 平台语言服务（按回复计费，platform: true）。
//
// 严格版语义（原 chat.js 首发）：用户 key 必须同时带非空 base_url 才算可用——
// 只有 key 没有 base_url 时跳过用户配置、回退平台。宽松版（只查 key）会让
// 调用方拿着空 base_url 拼 "/chat/completions" → ERR_INVALID_URL，这正是
// novels.js 曾复制的隐患；theater 此前更是硬性要求自带 key，无 key 用户整条
// 产品线不可用。三处现统一走这里。
//
// opts 保留各业务线在平台分支上的默认差异：
//   platformTemperature — 未显式设置温度时平台分支的默认值（对话 0.8 / 小说 0.9）
//   platformMinTokens   — 平台分支的 max_tokens 下限（小说需要 ≥1600 的长产出）
export function effectiveLLM(settings, { platformTemperature = 0.8, platformMinTokens = 0 } = {}) {
  if (settings?.llm_api_key && settings?.llm_base_url && String(settings.llm_base_url).trim()) {
    return { base_url: settings.llm_base_url, api_key: settings.llm_api_key, model: settings.llm_model,
      temperature: settings.llm_temperature, max_tokens: settings.llm_max_tokens, system_prompt: '', platform: false };
  }
  const p = getPlatform();
  if (p.key && p.base_url) {
    return { base_url: p.base_url, api_key: p.key, model: p.model,
      temperature: settings?.llm_temperature ?? platformTemperature,
      max_tokens: Math.max(settings?.llm_max_tokens || 0, platformMinTokens) || 1024,
      system_prompt: p.system_prompt || '', platform: true };
  }
  return null;
}

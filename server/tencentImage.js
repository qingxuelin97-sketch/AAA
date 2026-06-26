import { tc3Authorization, splitTencentKey } from './tencentSign.js';

// 腾讯云文生图适配。支持三个同步文生图接口（均为 TC3-HMAC-SHA256 签名，返回 ResultImage）：
//   1) TextToImage      —— AI 绘画文生图（aiart.tencentcloudapi.com，Styles 数组，ResultConfig.Resolution）
//   2) TextToImageRapid —— 混元生图极速版（aiart.tencentcloudapi.com，Style 单数，Resolution 顶层）
//   3) TextToImageLite  —— 文生图轻量版（hunyuan.tencentcloudapi.com，Style 单数，仅 ap-guangzhou）
// 密钥约定 SecretId:SecretKey 冒号分隔。
// model 字段存接口选择（TextToImage / TextToImageRapid / TextToImageLite）。

const VERSION = '2022-12-29';
const VERSION_HUNYUAN = '2023-09-01';

// 各模型的域名 / service / version / 参数构造方式
const MODEL_SPECS = {
  TextToImage: {
    host: 'aiart.tencentcloudapi.com', service: 'aiart', version: VERSION,
    // AI 绘画：Styles 是数组，Resolution 放在 ResultConfig 里
    buildPayload: ({ prompt, style, resolution, rspImgType }) => JSON.stringify({
      Prompt: String(prompt).slice(0, 100),
      Styles: [style || '201'],
      ResultConfig: { Resolution: resolution || '768:768' },
      RspImgType: rspImgType || 'url',
      LogoAdd: 0,
    }),
  },
  TextToImageRapid: {
    host: 'aiart.tencentcloudapi.com', service: 'aiart', version: VERSION,
    // 混元极速版：Style 单数，Resolution 顶层，支持比例与长边分辨率
    buildPayload: ({ prompt, style, resolution, rspImgType }) => JSON.stringify({
      Prompt: String(prompt).slice(0, 256),
      Style: style || 'riman',
      Resolution: resolution || '1024:1024',
    }),
  },
  TextToImageLite: {
    host: 'hunyuan.tencentcloudapi.com', service: 'hunyuan', version: VERSION_HUNYUAN,
    // 轻量版：hunyuan 域名，仅 ap-guangzhou，Style 单数
    buildPayload: ({ prompt, style, resolution, rspImgType }) => JSON.stringify({
      Prompt: String(prompt).slice(0, 256),
      Style: style || '201',
      Resolution: resolution || '768:768',
      RspImgType: rspImgType || 'url',
      LogoAdd: 0,
    }),
  },
};

export function tencentImageReady(cfg) {
  return !!(cfg && cfg.key);
}

function resolveModel(model) {
  return MODEL_SPECS[model] ? model : 'TextToImage';
}

async function callTencentImage({ secretId, secretKey, model, region, prompt, style, resolution, rspImgType }) {
  const m = resolveModel(model);
  const spec = MODEL_SPECS[m];
  const payload = spec.buildPayload({ prompt, style, resolution, rspImgType });
  const timestamp = Math.floor(Date.now() / 1000);
  const { authorization, ct } = tc3Authorization({
    secretId, secretKey, service: spec.service, host: spec.host,
    action: m, version: spec.version, payload, timestamp,
  });
  const r = await fetch(`https://${spec.host}/`, {
    method: 'POST',
    headers: {
      'Content-Type': ct, Host: spec.host, Authorization: authorization,
      'X-TC-Action': m, 'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': spec.version,
      // 轻量版仅 ap-guangzhou，其他模型用配置的地域
      'X-TC-Region': m === 'TextToImageLite' ? 'ap-guangzhou' : (region || 'ap-guangzhou'),
    },
    body: payload,
  });
  return { r, payload, model: m };
}

// 真正调用腾讯云生成一张图。返回 { image, raw } 或抛出错误。
export async function generateTencentImage(cfg, { prompt, size }) {
  const { secretId, secretKey } = splitTencentKey(cfg.key);
  if (!secretId || !secretKey) throw new Error('腾讯云生图密钥未配置（需 SecretId:SecretKey）');
  const { r } = await callTencentImage({
    secretId, secretKey, model: cfg.model, region: cfg.region,
    prompt, style: cfg.styles, resolution: cfg.resolution || '768:768', rspImgType: 'url',
  });
  const d = await r.json().catch(() => null);
  if (d?.Response?.Error) {
    const e = d.Response.Error;
    throw new Error(`腾讯云生图失败 [${e.Code}]：${e.Message}`);
  }
  const image = d?.Response?.ResultImage;
  if (!image) throw new Error('腾讯云生图未返回图片');
  return { image, raw: d };
}

// 在线检测：用当前配置发起一次最小生成请求，验证密钥/签名/接口是否可用。
// 返回 { ok, message, latency_ms, sample? }。
export async function testTencentImage(cfg) {
  const { secretId, secretKey } = splitTencentKey(cfg.key);
  if (!secretId || !secretKey) return { ok: false, message: '密钥未配置（需 SecretId:SecretKey）' };
  const t0 = Date.now();
  try {
    const { r, model } = await callTencentImage({
      secretId, secretKey, model: cfg.model, region: cfg.region,
      prompt: '一只可爱的橘猫，柔光摄影', style: cfg.styles, resolution: cfg.resolution || '768:768', rspImgType: 'url',
    });
    const latency_ms = Date.now() - t0;
    const d = await r.json().catch(() => null);
    if (d?.Response?.Error) {
      const e = d.Response.Error;
      return { ok: false, message: `失败 [${e.Code}]：${e.Message}`, latency_ms, model };
    }
    const sample = d?.Response?.ResultImage;
    return { ok: true, message: `连接成功（${model}），密钥与签名有效`, latency_ms, sample, model };
  } catch (e) {
    return { ok: false, message: '连接失败：' + e.message, latency_ms: Date.now() - t0 };
  }
}

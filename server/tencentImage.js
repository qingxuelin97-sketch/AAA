import { tc3Authorization, splitTencentKey } from './tencentSign.js';

// 腾讯云 AIrtist 图像生成（文生图）适配。
// 接口：aiart.tencentcloudapi.com 的 ImageGeneration（Version 2022-12-29）。
// 签名：TC3-HMAC-SHA256（v3）。密钥约定 SecretId:SecretKey 冒号分隔。
//
// 风格编号参考（腾讯云官方文档）：
//   201 商业插画 / 202 水彩 / 203 油画 / 204 厚涂 / 205 二次元 /
//   207 写实摄影 / 208 像素风 / 209 概念设计 / 210 吉卜力 / 211 赛博朋克
// Resolution 取值：1:1、4:3、3:4、16:9、9:16、2:3、3:2

const SERVICE = 'aiart';
const HOST = 'aiart.tencentcloudapi.com';
const ACTION = 'ImageGeneration';
const VERSION = '2022-12-29';

// OpenAI 风格 size（WxH）映射到腾讯云 Resolution 比例
const SIZE_TO_RATIO = {
  '1024x1024': '1:1', '512x512': '1:1',
  '1024x1536': '2:3', '768x1024': '3:4',
  '1536x1024': '3:2', '1024x768': '4:3',
};

export function tencentImageReady(cfg) {
  // 腾讯云图像服务判定：密钥（SecretId:SecretKey）已配置即可，base_url 用默认域名
  return !!(cfg && cfg.key);
}

function buildPayload({ prompt, styles, size, rspImgType }) {
  const ratio = SIZE_TO_RATIO[size] || '1:1';
  const styleList = (Array.isArray(styles) ? styles : String(styles || '201').split(','))
    .map(s => String(s).trim()).filter(Boolean).slice(0, 3);
  if (!styleList.length) styleList.push('201');
  return JSON.stringify({
    Prompt: String(prompt).slice(0, 1500),
    Styles: styleList,
    ResultConfig: { Resolution: ratio },
    RspImgType: rspImgType || 'url',
  });
}

async function callTencentImage({ secretId, secretKey, region, prompt, styles, size, rspImgType }) {
  const payload = buildPayload({ prompt, styles, size, rspImgType });
  const timestamp = Math.floor(Date.now() / 1000);
  const { authorization, ct } = tc3Authorization({ secretId, secretKey, service: SERVICE, host: HOST, action: ACTION, version: VERSION, payload, timestamp });
  const r = await fetch(`https://${HOST}/`, {
    method: 'POST',
    headers: {
      'Content-Type': ct, Host: HOST, Authorization: authorization,
      'X-TC-Action': ACTION, 'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': VERSION, 'X-TC-Region': region || 'ap-guangzhou',
    },
    body: payload,
  });
  return { r, payload };
}

// 真正调用腾讯云生成一张图。返回 { image, raw } 或抛出错误。
// image 统一成可前端直接展示的形式：url 或 data URI。
export async function generateTencentImage(cfg, { prompt, size }) {
  const { secretId, secretKey } = splitTencentKey(cfg.key);
  if (!secretId || !secretKey) throw new Error('腾讯云生图密钥未配置（需 SecretId:SecretKey）');
  const { r } = await callTencentImage({
    secretId, secretKey, region: cfg.region || 'ap-guangzhou',
    prompt, styles: cfg.styles, size, rspImgType: 'url',
  });
  const d = await r.json().catch(() => null);
  if (d?.Response?.Error) {
    const e = d.Response.Error;
    throw new Error(`腾讯云生图失败 [${e.Code}]：${e.Message}`);
  }
  const images = d?.Response?.ResultImage || [];
  if (!images.length) throw new Error('腾讯云生图未返回图片');
  return { image: images[0], raw: d };
}

// 在线检测：用当前配置发起一次最小生成请求，验证密钥/签名/区域是否可用。
// 返回 { ok, message, latency_ms, sample? }，sample 为生成的图片 URL 供后台预览。
export async function testTencentImage(cfg) {
  const { secretId, secretKey } = splitTencentKey(cfg.key);
  if (!secretId || !secretKey) return { ok: false, message: '密钥未配置（需 SecretId:SecretKey）' };
  const t0 = Date.now();
  try {
    const { r } = await callTencentImage({
      secretId, secretKey, region: cfg.region || 'ap-guangzhou',
      prompt: '一只可爱的橘猫，柔光摄影', styles: cfg.styles || '201',
      size: '768x1024', rspImgType: 'url',
    });
    const latency_ms = Date.now() - t0;
    const d = await r.json().catch(() => null);
    if (d?.Response?.Error) {
      const e = d.Response.Error;
      return { ok: false, message: `失败 [${e.Code}]：${e.Message}`, latency_ms };
    }
    const sample = d?.Response?.ResultImage?.[0];
    return { ok: true, message: '连接成功，密钥与签名有效', latency_ms, sample };
  } catch (e) {
    return { ok: false, message: '连接失败：' + e.message, latency_ms: Date.now() - t0 };
  }
}

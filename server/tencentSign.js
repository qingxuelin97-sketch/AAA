import crypto from 'crypto';

// 腾讯云 TC3-HMAC-SHA256 (v3) 请求签名 —— 通用实现，供 TTS / AIrtist 图像生成等共用。
// 参考腾讯云 API 网关签名规范：canonical request → string to sign → HMAC 链派生签名。
export function tc3Authorization({ secretId, secretKey, service, host, action, version, payload, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const ct = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:${ct}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const hashedPayload = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hashedCanonical}`;
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d, 'utf8').digest();
  const kSigning = hmac(hmac(hmac('TC3' + secretKey, date), service), 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return { authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, ct };
}

// SecretId:SecretKey 解析（管理后台为了复用同一个 key 字段，采用冒号分隔约定）
export function splitTencentKey(key) {
  const k = String(key || '').trim();
  const idx = k.indexOf(':');
  if (idx <= 0) return { secretId: '', secretKey: '' };
  return { secretId: k.slice(0, idx).trim(), secretKey: k.slice(idx + 1).trim() };
}

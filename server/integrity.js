import crypto from 'node:crypto';

const PLAY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const VERDICT_MAX_AGE_MS = 2 * 60_000;

let cachedAccessToken = null;
let cachedAccessTokenUntil = 0;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function readConfig() {
  const packageName = String(process.env.PLAY_INTEGRITY_PACKAGE_NAME || '').trim();
  const raw = String(process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON || '').trim();
  if (!packageName || !raw) return null;
  let serviceAccount;
  try {
    const decoded = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    serviceAccount = JSON.parse(decoded);
  } catch {
    throw new Error('PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON is not valid JSON/base64 JSON');
  }
  if (!/^[A-Za-z][A-Za-z0-9_.]{2,199}$/.test(packageName)) throw new Error('PLAY_INTEGRITY_PACKAGE_NAME is invalid');
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) throw new Error('Play Integrity service account credentials are incomplete');
  if (serviceAccount.token_uri && serviceAccount.token_uri !== TOKEN_URI) throw new Error('Unexpected service account token_uri');
  return { packageName, serviceAccount };
}

export function playIntegrityAvailability() {
  try { return { configured: !!readConfig() }; }
  catch { return { configured: false }; }
}

export function registrationRequestHash({ email, username }) {
  const canonical = JSON.stringify({ action: 'register', email: String(email || '').trim().toLowerCase(), username: String(username || '').trim() });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

async function accessToken(serviceAccount) {
  if (cachedAccessToken && cachedAccessTokenUntil - Date.now() > 60_000) return cachedAccessToken;
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
  const claims = base64urlJson({
    iss: serviceAccount.client_email,
    scope: PLAY_SCOPE,
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Play Integrity OAuth failed (${response.status})`);
  cachedAccessToken = data.access_token;
  cachedAccessTokenUntil = Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

export function validatePlayVerdict(verdict, expectedRequestHash, packageName, now = Date.now()) {
  const details = verdict?.requestDetails || {};
  const app = verdict?.appIntegrity || {};
  const account = verdict?.accountDetails || {};
  const deviceLabels = verdict?.deviceIntegrity?.deviceRecognitionVerdict || [];
  const timestamp = Number(details.timestampMillis);
  const ok = details.requestPackageName === packageName
    && details.requestHash === expectedRequestHash
    && Number.isFinite(timestamp)
    && Math.abs(now - timestamp) <= VERDICT_MAX_AGE_MS
    && app.appRecognitionVerdict === 'PLAY_RECOGNIZED'
    && app.packageName === packageName
    && account.appLicensingVerdict === 'LICENSED'
    && Array.isArray(deviceLabels)
    && deviceLabels.includes('MEETS_DEVICE_INTEGRITY');
  if (!ok) {
    const error = new Error('设备或应用完整性校验未通过');
    error.status = 403;
    error.expose = true;
    throw error;
  }
  return {
    package_name: packageName,
    app_recognition: app.appRecognitionVerdict,
    licensing: account.appLicensingVerdict,
    device_labels: deviceLabels,
    checked_at: now,
  };
}

export async function verifyPlayIntegrityToken(integrityToken, expectedRequestHash) {
  const cfg = readConfig();
  if (!cfg) {
    const error = new Error('Play Integrity 尚未在服务器配置');
    error.status = 503;
    error.expose = true;
    throw error;
  }
  const token = String(integrityToken || '').trim();
  if (!token || token.length > 20_000) {
    const error = new Error('完整性令牌无效');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  const bearer = await accessToken(cfg.serviceAccount);
  const response = await fetch(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(cfg.packageName)}:decodeIntegrityToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ integrity_token: token }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.tokenPayloadExternal) {
    const error = new Error(`Play Integrity 验证服务拒绝令牌 (${response.status})`);
    error.status = 403;
    error.expose = true;
    throw error;
  }
  return validatePlayVerdict(data.tokenPayloadExternal, expectedRequestHash, cfg.packageName);
}

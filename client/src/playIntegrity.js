import { Capacitor, registerPlugin } from '@capacitor/core';

const PlayIntegrity = registerPlugin('PlayIntegrity');

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function registrationRequestHash({ email, username }) {
  const canonical = JSON.stringify({
    action: 'register',
    email: String(email || '').trim().toLowerCase(),
    username: String(username || '').trim(),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return base64Url(new Uint8Array(digest));
}

export async function preparePlayIntegrity() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  await PlayIntegrity.prepare();
  return true;
}

export async function getRegistrationIntegrityToken(fields) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return '';
  const requestHash = await registrationRequestHash(fields);
  const result = await PlayIntegrity.requestToken({ requestHash });
  if (!result?.token) throw new Error('设备完整性令牌为空');
  return result.token;
}

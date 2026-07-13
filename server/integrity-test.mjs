import assert from 'node:assert/strict';
import { registrationRequestHash, validatePlayVerdict } from './integrity.js';

const now = Date.now();
const packageName = 'ai.huanyu.app';
const requestHash = registrationRequestHash({ email: 'User@Test.Dev ', username: 'new_user' });
const verdict = {
  requestDetails: { requestPackageName: packageName, requestHash, timestampMillis: String(now) },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName },
  accountDetails: { appLicensingVerdict: 'LICENSED' },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
};

const accepted = validatePlayVerdict(verdict, requestHash, packageName, now);
assert.equal(accepted.package_name, packageName);
assert.equal(registrationRequestHash({ email: 'user@test.dev', username: 'new_user' }), requestHash,
  'registration request hash must normalize email casing and whitespace');

const rejects = (mutate, message) => {
  const candidate = structuredClone(verdict);
  mutate(candidate);
  assert.throws(() => validatePlayVerdict(candidate, requestHash, packageName, now),
    error => error?.status === 403, message);
};

rejects(v => { v.requestDetails.requestHash = 'attacker-controlled'; }, 'request hash mismatch must fail');
rejects(v => { v.requestDetails.timestampMillis = String(now - 121_000); }, 'stale verdict must fail');
rejects(v => { v.appIntegrity.appRecognitionVerdict = 'UNRECOGNIZED_VERSION'; }, 'unrecognized build must fail');
rejects(v => { v.accountDetails.appLicensingVerdict = 'UNLICENSED'; }, 'unlicensed install must fail');
rejects(v => { v.deviceIntegrity.deviceRecognitionVerdict = []; }, 'device integrity failure must fail');

console.log('Play Integrity verdict validation: 7 passed, 0 failed');

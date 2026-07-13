import assert from 'node:assert/strict';
import { registrationRequestHash as clientHash } from './src/playIntegrity.js';
import { registrationRequestHash as serverHash } from '../server/integrity.js';
import { mergeMessages, messageId } from './src/groupMessages.js';

const fields = { email: ' Test@Example.COM ', username: ' 测试User ' };
assert.equal(await clientHash(fields), serverHash(fields), 'client and server request hashes must match');

const ordered = mergeMessages(
  [{ id: '12', content: 'old' }, { id: 10, content: 'first' }],
  [{ id: 11, content: 'middle' }, { id: 12, content: 'updated' }],
);
assert.deepEqual(ordered.map(messageId), [10, 11, 12], 'messages must be sorted numerically');
assert.equal(ordered.length, 3, 'SSE/poll duplicates must collapse');
assert.equal(ordered[2].content, 'updated', 'newest duplicate payload must win');

console.log('app invariants: 4/4 passed');

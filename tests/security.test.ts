import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, randomToken, tokenHash, verifyPassword } from '../src/server/security.js';

test('passwords are salted and verifiable', () => {
  const first = hashPassword('correct-horse-battery-staple');
  const second = hashPassword('correct-horse-battery-staple');
  assert.notEqual(first, second);
  assert.equal(verifyPassword('correct-horse-battery-staple', first), true);
  assert.equal(verifyPassword('wrong-password', first), false);
});

test('API tokens have the expected prefix and stable one-way hash', () => {
  const token = randomToken('sk-xldc-');
  assert.match(token, /^sk-xldc-[A-Za-z0-9_-]+$/);
  assert.equal(tokenHash(token), tokenHash(token));
  assert.notEqual(tokenHash(token), token);
});

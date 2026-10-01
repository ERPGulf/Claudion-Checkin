/*
 * MIT License — reference encoder adapted from @erpgulf/server-lookup.
 * Copyright (c) 2026 ERPGulf
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { validateServerLookupConfig } from '@erpgulf/server-lookup';

// Synthetic values only. Reference encoder adapted from ui-shared-code's
// packages/erpgulf-server-lookup/tests/helpers/fixtures.ts (MIT, ERPGulf 2026).
export const lookupConfig = validateServerLookupConfig({
  url: 'https://lookup.example.test',
  secret: 'fixture-only-€-$-not-a-deployment-key',
  alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
});

function at(values, index) {
  const value = values[index];
  if (value === undefined) throw new RangeError('Fixture index out of range');
  return value;
}

/** Independent encoder for the backend protocol; never used by app code. */
export function sealFixture(
  text,
  { nonce = 'fixture-01', corruptChecksum = false, config = lookupConfig } = {},
) {
  const plain = typeof text === 'string' ? [...new TextEncoder().encode(text)] : [...text];
  let hash = 2166136261;
  for (const value of plain) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  if (corruptChecksum) hash ^= 1;
  const payload = [...plain, (hash >>> 24) & 255, (hash >>> 16) & 255, (hash >>> 8) & 255, hash & 255];
  const key = new TextEncoder().encode(config.secret + nonce);
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + at(state, i) + at(key, i % key.length)) & 255;
    [state[i], state[j]] = [at(state, j), at(state, i)];
  }
  let i = 0;
  j = 0;
  const stream = [];
  for (let n = 0; n < 256 + payload.length; n++) {
    i = (i + 1) & 255;
    j = (j + at(state, i)) & 255;
    [state[i], state[j]] = [at(state, j), at(state, i)];
    stream.push(at(state, (at(state, i) + at(state, j)) & 255));
  }
  const encrypted = payload.map((value, index) => value ^ at(stream, index + 256)).reverse();
  const standard = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const body = Buffer.from(encrypted)
    .toString('base64')
    .split('')
    .map(symbol => symbol === '=' ? '~' : at(config.alphabet, standard.indexOf(symbol)))
    .join('');
  return `${nonce}.${body}`;
}

export function lookupResponse(url = 'https://company.example.test') {
  return { message: { success: true, resp: sealFixture(url) } };
}

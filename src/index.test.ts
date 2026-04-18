import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMessages, writeMessage } from './framing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'index.js');

test('ping request returns pong over stdio framing', async () => {
  const child = spawn(process.execPath, [entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: path.join(here, '..', '.test-home') },
  });

  const req = { id: 'test-1', type: 'ping' as const };
  writeMessage(child.stdin, req);

  const iter = readMessages(child.stdout)[Symbol.asyncIterator]();
  const { value } = await iter.next();
  child.stdin.end();
  child.kill();

  const resp = value as { id: string; ok: boolean; type: string; data?: { now: number } };
  assert.equal(resp.id, 'test-1');
  assert.equal(resp.ok, true);
  assert.equal(resp.type, 'ping');
  assert.ok(resp.data && resp.data.now > 0);
});

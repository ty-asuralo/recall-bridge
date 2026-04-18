import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readMessages, writeMessage } from './framing.js';

test('framing round-trip: single message', async () => {
  const stream = new PassThrough();
  const msg = { id: 'x', type: 'ping' };
  writeMessage(stream, msg);
  stream.end();

  const received: unknown[] = [];
  for await (const m of readMessages(stream)) received.push(m);
  assert.deepEqual(received, [msg]);
});

test('framing round-trip: multiple messages', async () => {
  const stream = new PassThrough();
  const msgs = [
    { id: '1', type: 'ping' },
    { id: '2', type: 'search', query: 'hello world' },
    { id: '3', type: 'capabilities' },
  ];
  for (const m of msgs) writeMessage(stream, m);
  stream.end();

  const received: unknown[] = [];
  for await (const m of readMessages(stream)) received.push(m);
  assert.deepEqual(received, msgs);
});

test('framing handles partial chunks', async () => {
  const stream = new PassThrough();
  const msg = { id: 'a', type: 'ping' };
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  stream.write(header.subarray(0, 2));
  stream.write(header.subarray(2));
  stream.write(body.subarray(0, 5));
  stream.write(body.subarray(5));
  stream.end();

  const received: unknown[] = [];
  for await (const m of readMessages(stream)) received.push(m);
  assert.deepEqual(received, [msg]);
});

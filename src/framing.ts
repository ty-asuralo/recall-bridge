import type { Readable, Writable } from 'node:stream';

const LENGTH_BYTES = 4;
const MAX_MESSAGE_BYTES = 1024 * 1024 * 64;

export async function* readMessages(stream: Readable): AsyncIterable<unknown> {
  let buf = Buffer.alloc(0);

  for await (const chunk of stream) {
    buf = Buffer.concat([buf, chunk as Buffer]);

    while (buf.length >= LENGTH_BYTES) {
      const len = buf.readUInt32LE(0);
      if (len > MAX_MESSAGE_BYTES) throw new Error(`framing: message too large (${len})`);
      if (buf.length < LENGTH_BYTES + len) break;
      const body = buf.subarray(LENGTH_BYTES, LENGTH_BYTES + len).toString('utf8');
      buf = buf.subarray(LENGTH_BYTES + len);
      yield JSON.parse(body);
    }
  }
}

export function writeMessage(stream: Writable, msg: unknown): void {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(LENGTH_BYTES);
  header.writeUInt32LE(body.length, 0);
  stream.write(header);
  stream.write(body);
}

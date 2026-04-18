import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { ExportRecord, Platform } from './protocol.js';

const PLATFORMS: Platform[] = ['claude', 'chatgpt', 'gemini'];

export async function* walkRawDir(rawDir: string, since: number): AsyncIterable<ExportRecord> {
  for (const platform of PLATFORMS) {
    const dir = path.join(rawDir, platform);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      yield* readJsonl(file, since);
    }
  }
}

async function* readJsonl(file: string, since: number): AsyncIterable<ExportRecord> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as ExportRecord;
    if (record.capturedAt > since) yield record;
  }
}

export function groupByConversation(records: ExportRecord[]): Map<string, ExportRecord[]> {
  const groups = new Map<string, ExportRecord[]>();
  for (const r of records) {
    const list = groups.get(r.conversationId) ?? [];
    list.push(r);
    groups.set(r.conversationId, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.seq - b.seq);
  return groups;
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Backend } from '../backend.js';
import type { ExportRecord, SearchHit, SearchOpts } from '../protocol.js';
import { getStagingDir } from '../config.js';
import { walkRawDir, groupByConversation } from '../ingest.js';

const exec = promisify(execFile);
const BIN = 'gbrain';

export class GBrainBackend implements Backend {
  id = 'gbrain' as const;

  async version(): Promise<string> {
    try {
      const { stdout } = await exec(BIN, ['--version']);
      return stdout.trim().replace(/^gbrain\s+/i, '') || 'unknown';
    } catch (err) {
      logErr('version', err);
      return 'unavailable';
    }
  }

  async ingest(rawDir: string, since: number): Promise<{ ingested: number; skipped: number }> {
    const records: ExportRecord[] = [];
    for await (const r of walkRawDir(rawDir, since)) records.push(r);
    if (records.length === 0) return { ingested: 0, skipped: 0 };

    const groups = groupByConversation(records);
    const staging = path.join(getStagingDir(), 'gbrain');
    let written = 0;

    for (const [convId, convRecords] of groups) {
      const first = convRecords[0]!;
      const platformDir = path.join(staging, first.platform);
      await fs.mkdir(platformDir, { recursive: true });
      const file = path.join(platformDir, `${convId}.md`);
      await fs.writeFile(file, renderMarkdown(convId, convRecords), 'utf8');
      written++;
    }

    try {
      await exec(BIN, ['import', staging]);
    } catch (err) {
      logErr('import', err);
    }

    return { ingested: written, skipped: 0 };
  }

  async search(query: string, opts: SearchOpts): Promise<SearchHit[]> {
    const args = ['search', query, '--json'];
    if (opts.limit) args.push('--limit', String(opts.limit));
    try {
      const { stdout } = await exec(BIN, args);
      return parseHits(stdout);
    } catch (err) {
      logErr('search', err);
      return [];
    }
  }

  async getConversation(conversationId: string): Promise<ExportRecord[]> {
    try {
      const { stdout } = await exec(BIN, ['get', conversationId, '--json']);
      const parsed = JSON.parse(stdout) as { records?: ExportRecord[] };
      return parsed.records ?? [];
    } catch (err) {
      logErr('getConversation', err);
      return [];
    }
  }
}

function renderMarkdown(convId: string, records: ExportRecord[]): string {
  const first = records[0]!;
  const captured = new Date(first.capturedAt).toISOString();
  const yamlTitle = first.title.replace(/"/g, '\\"');
  const lines = [
    '---',
    `id: ${convId}`,
    'source: recall',
    `platform: ${first.platform}`,
    `title: "${yamlTitle}"`,
    `url: ${first.url}`,
    `captured_at: ${captured}`,
    `tags: [recall, ${first.platform}]`,
    '---',
    '',
    `# ${first.title}`,
    '',
  ];
  for (const r of records) {
    const ts = new Date(r.capturedAt).toISOString();
    const heading = r.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${heading} — ${ts}`, '', r.content, '');
  }
  return lines.join('\n');
}

function parseHits(stdout: string): SearchHit[] {
  try {
    const parsed = JSON.parse(stdout) as { hits?: unknown[] };
    if (!Array.isArray(parsed.hits)) return [];
    return parsed.hits.flatMap((h) => {
      const hit = h as Partial<SearchHit>;
      if (!hit.record) return [];
      return [
        {
          record: hit.record,
          score: hit.score ?? 0,
          snippet: hit.snippet ?? '',
          matchedBy: hit.matchedBy ?? 'keyword',
        },
      ];
    });
  } catch {
    return [];
  }
}

function logErr(op: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[recall-bridge] gbrain.${op}: ${msg}`);
}

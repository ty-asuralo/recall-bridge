import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Backend } from '../backend.js';
import type { ExportRecord, Platform, SearchHit, SearchOpts } from '../protocol.js';
import { getStagingDir, loadConfig } from '../config.js';
import { walkRawDir, groupByConversation } from '../ingest.js';

const exec = promisify(execFile);
const BIN = 'mempalace';

export class MemPalaceBackend implements Backend {
  id = 'mempalace' as const;

  async version(): Promise<string> {
    try {
      const { stdout } = await exec(BIN, ['status']);
      const match = stdout.match(/version[:\s]+(\S+)/i);
      return match?.[1] ?? 'installed';
    } catch {
      try {
        await exec(BIN, ['--help']);
        return 'installed';
      } catch {
        return 'unavailable';
      }
    }
  }

  async ingest(rawDir: string, since: number): Promise<{ ingested: number; skipped: number }> {
    const records: ExportRecord[] = [];
    for await (const r of walkRawDir(rawDir, since)) records.push(r);
    if (records.length === 0) return { ingested: 0, skipped: 0 };

    const groups = groupByConversation(records);
    const staging = path.join(getStagingDir(), 'mempalace');
    await fs.mkdir(staging, { recursive: true });
    let written = 0;

    for (const [convId, convRecords] of groups) {
      const first = convRecords[0]!;
      const file = path.join(staging, `${first.platform}_${convId}.txt`);
      await fs.writeFile(file, renderTranscript(convRecords), 'utf8');
      written++;
    }

    try {
      await exec(BIN, ['mine', staging, '--mode', 'convos']);
    } catch (err) {
      logErr('mine', err);
    }

    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});

    return { ingested: written, skipped: 0 };
  }

  async search(query: string, opts: SearchOpts): Promise<SearchHit[]> {
    const limit = opts.platforms?.length ? (opts.limit ?? 20) * 3 : opts.limit;
    const args = ['search', query];
    if (limit) args.push('--results', String(limit));
    try {
      const { stdout } = await exec(BIN, args);
      let hits = parseTextHits(stdout, query);
      if (opts.platforms?.length) {
        const allowed = new Set(opts.platforms);
        hits = hits.filter((h) => allowed.has(h.record.platform));
      }
      const seen = new Map<string, SearchHit>();
      for (const h of hits) {
        const existing = seen.get(h.record.conversationId);
        if (!existing || h.score > existing.score) {
          seen.set(h.record.conversationId, h);
        }
      }
      hits = [...seen.values()].sort((a, b) => b.score - a.score);
      hits = hits.slice(0, opts.limit ?? 20);

      const config = await loadConfig();
      if (config.exportDir && hits.length > 0) {
        const titleMap = new Map<string, string>();
        for await (const r of walkRawDir(config.exportDir, 0)) {
          if (!titleMap.has(r.conversationId) && r.title) {
            titleMap.set(r.conversationId, r.title);
          }
        }
        for (const h of hits) {
          const title = titleMap.get(h.record.conversationId);
          if (title) h.record.title = title;
        }
      }

      return hits;
    } catch (err) {
      logErr('search', err);
      return [];
    }
  }

  async getConversation(conversationId: string): Promise<ExportRecord[]> {
    try {
      const config = await loadConfig();
      if (!config.exportDir) return [];
      const records: ExportRecord[] = [];
      for await (const r of walkRawDir(config.exportDir, 0)) {
        if (r.conversationId === conversationId) records.push(r);
      }
      records.sort((a, b) => a.seq - b.seq);
      return records;
    } catch (err) {
      logErr('getConversation', err);
      return [];
    }
  }
}

function renderTranscript(records: ExportRecord[]): string {
  const first = records[0]!;
  const captured = new Date(first.capturedAt).toISOString();
  const lines = [
    `# Title: ${first.title}`,
    `# URL: ${first.url}`,
    `# Platform: ${first.platform}`,
    `# Captured: ${captured}`,
    '',
  ];
  for (const r of records) {
    lines.push(`--- ${r.role} ---`, r.content, '');
  }
  return lines.join('\n');
}

function parseTextHits(stdout: string, query: string): SearchHit[] {
  const blocks = stdout.split(/\s*─{10,}\s*/);
  const hits: SearchHit[] = [];
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlightRe = new RegExp(`(${escapedQuery})`, 'gi');

  for (const block of blocks) {
    const indexMatch = block.match(/\[(\d+)]/);
    if (!indexMatch) continue;

    const sourceMatch = block.match(/Source:\s*(\S+)/);
    const scoreMatch = block.match(/Match:\s*([\d.]+)/);
    const sourceName = sourceMatch?.[1]?.replace(/\.txt$/, '') ?? '';
    const platformMatch = sourceName.match(/^(claude|chatgpt|gemini)_(.+)/);
    const platform = (platformMatch?.[1] ?? 'claude') as Platform;
    const convId = platformMatch?.[2] ?? sourceName;
    const score = scoreMatch ? parseFloat(scoreMatch[1]!) : 0;

    const contentLines = block.split('\n').filter((l) => {
      const trimmed = l.trim();
      return trimmed
        && !trimmed.startsWith('[')
        && !trimmed.startsWith('Source:')
        && !trimmed.startsWith('Match:')
        && !trimmed.startsWith('=')
        && !trimmed.startsWith('Results for:')
        && !trimmed.startsWith('Wing:')
        && !trimmed.match(/^---\s*(user|assistant)\s*---$/);
    });
    const content = contentLines.map((l) => l.trim()).join(' ').slice(0, 500);
    const snippet = escapeHtml(content).replace(highlightRe, '<mark>$1</mark>');

    hits.push({
      record: {
        id: `mp-${indexMatch[1]}`,
        conversationId: convId,
        platform,
        url: '',
        title: contentLines[0]?.trim() ?? 'Untitled',
        role: 'assistant',
        content,
        capturedAt: 0,
        seq: 0,
      },
      score,
      snippet,
      matchedBy: 'semantic',
    });
  }

  return hits;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function logErr(op: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[recall-bridge] mempalace.${op}: ${msg}`);
}

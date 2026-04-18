import type { Backend } from '../backend.js';
import type { ExportRecord, SearchHit, SearchOpts } from '../protocol.js';

export class MockBackend implements Backend {
  id = 'mock' as const;

  async version(): Promise<string> {
    return '0.1.0';
  }

  async ingest(): Promise<{ ingested: number; skipped: number }> {
    return { ingested: 0, skipped: 0 };
  }

  async search(query: string, opts: SearchOpts): Promise<SearchHit[]> {
    const now = Date.now();
    const limit = opts.limit ?? 3;
    const hits: SearchHit[] = [];
    for (let i = 0; i < Math.min(3, limit); i++) {
      const platform = (['claude', 'chatgpt', 'gemini'] as const)[i];
      const record: ExportRecord = {
        id: `mock-${i}`,
        conversationId: `mock-conv-${i}`,
        platform,
        url: `https://example.com/mock/${i}`,
        title: `Mock conversation ${i + 1}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Mock result ${i + 1} for "${query}". This is canned test data.`,
        capturedAt: now - i * 3600_000,
        seq: 0,
      };
      hits.push({
        record,
        score: 1 - i * 0.15,
        snippet: `Mock result ${i + 1} for "<mark>${escapeHtml(query)}</mark>".`,
        matchedBy: 'keyword',
      });
    }
    return hits;
  }

  async getConversation(): Promise<ExportRecord[]> {
    return [];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

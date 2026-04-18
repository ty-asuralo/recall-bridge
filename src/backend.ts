import type { ExportRecord, SearchHit, SearchOpts } from './protocol.js';

export interface Backend {
  id: 'mempalace' | 'gbrain' | 'mock';
  version(): Promise<string>;
  ingest(rawDir: string, since: number): Promise<{ ingested: number; skipped: number }>;
  search(query: string, opts: SearchOpts): Promise<SearchHit[]>;
  getConversation(conversationId: string): Promise<ExportRecord[]>;
}

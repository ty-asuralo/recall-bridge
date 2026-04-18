#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMessages, writeMessage } from './framing.js';
import { loadConfig, saveConfig } from './config.js';
import type { Backend } from './backend.js';
import { MockBackend } from './backends/mock.js';
import { MemPalaceBackend } from './backends/mempalace.js';
import { GBrainBackend } from './backends/gbrain.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeRequest,
  type BridgeResponse,
  type Capabilities,
} from './protocol.js';

async function getBridgeVersion(): Promise<string> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await fs.readFile(path.join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function makeBackend(id: 'mempalace' | 'gbrain' | 'mock'): Backend {
  switch (id) {
    case 'mempalace':
      return new MemPalaceBackend();
    case 'gbrain':
      return new GBrainBackend();
    case 'mock':
      return new MockBackend();
  }
}

function featuresFor(id: Backend['id']): Capabilities['features'] {
  if (id === 'mock') return { semantic: false, keyword: true, filters: [] };
  return { semantic: true, keyword: true, filters: ['platform', 'role', 'since', 'until'] };
}

let backend: Backend;

async function handle(
  req: BridgeRequest,
  bridgeVersion: string,
): Promise<BridgeResponse> {
  switch (req.type) {
    case 'ping':
      return { id: req.id, ok: true, type: 'ping', data: { now: Date.now() } };

    case 'capabilities': {
      const backendVersion = await backend.version();
      const caps: Capabilities = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        bridgeVersion,
        backend: backend.id,
        backendVersion,
        features: featuresFor(backend.id),
      };
      return { id: req.id, ok: true, type: 'capabilities', data: caps };
    }

    case 'ingest': {
      const started = Date.now();
      const config = await loadConfig();
      if (!config.exportDir) {
        return {
          id: req.id,
          ok: false,
          error: { code: 'NO_EXPORT_DIR', message: 'exportDir is not configured' },
        };
      }
      const since = req.rebuild ? 0 : config.lastIngestedAt;
      const result = await backend.ingest(config.exportDir, since);
      config.lastIngestedAt = Date.now();
      await saveConfig(config);
      return {
        id: req.id,
        ok: true,
        type: 'ingest',
        data: { ingested: result.ingested, skipped: result.skipped, durationMs: Date.now() - started },
      };
    }

    case 'search': {
      const hits = await backend.search(req.query, req.opts ?? {});
      return { id: req.id, ok: true, type: 'search', data: { hits } };
    }

    case 'conversation': {
      const records = await backend.getConversation(req.conversationId);
      return { id: req.id, ok: true, type: 'conversation', data: { records } };
    }

    case 'set-backend': {
      const newBackend = makeBackend(req.backend);
      const backendVersion = await newBackend.version();
      const config = await loadConfig();
      config.backend = req.backend;
      config.lastIngestedAt = 0;
      await saveConfig(config);
      backend = newBackend;
      console.error(`[recall-bridge] switched backend to ${req.backend}`);
      return { id: req.id, ok: true, type: 'set-backend', data: { backend: req.backend, backendVersion } };
    }
  }
}

function isBridgeRequest(v: unknown): v is BridgeRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['id'] === 'string' && typeof r['type'] === 'string';
}

async function main(): Promise<void> {
  const config = await loadConfig();
  backend = makeBackend(config.backend);
  const bridgeVersion = await getBridgeVersion();

  console.error(`[recall-bridge] started backend=${backend.id} version=${bridgeVersion}`);

  for await (const raw of readMessages(process.stdin)) {
    if (!isBridgeRequest(raw)) {
      console.error('[recall-bridge] ignoring malformed request');
      continue;
    }
    const req = raw;
    let resp: BridgeResponse;
    try {
      resp = await handle(req, bridgeVersion);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[recall-bridge] handler error: ${message}`);
      resp = { id: req.id, ok: false, error: { code: 'INTERNAL', message } };
    }
    writeMessage(process.stdout, resp);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[recall-bridge] fatal: ${message}`);
  process.exit(1);
});

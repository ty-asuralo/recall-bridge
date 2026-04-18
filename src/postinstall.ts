#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, 'index.js');

const manifest = {
  name: 'com.recall.bridge',
  description: 'Recall memory bridge',
  path: binPath,
  type: 'stdio',
  allowed_origins: ['chrome-extension://PLACEHOLDER_EXTENSION_ID/'],
};

function getHostDirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
      path.join(home, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
    ];
  }
  if (process.platform === 'linux') {
    return [
      path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts'),
      path.join(home, '.config', 'chromium', 'NativeMessagingHosts'),
    ];
  }
  return [];
}

async function writeManifest(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const existing = path.join(dir, 'com.recall.bridge.json');
    try {
      const content = await fs.readFile(existing, 'utf8');
      const parsed = JSON.parse(content) as { allowed_origins?: string[] };
      if (parsed.allowed_origins?.[0] && !parsed.allowed_origins[0].includes('PLACEHOLDER')) {
        manifest.allowed_origins = parsed.allowed_origins;
      }
    } catch { /* no existing manifest */ }
    await fs.writeFile(
      path.join(dir, 'com.recall.bridge.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (process.platform === 'win32') {
    console.log('[recall-bridge] Windows detected — run install\\install.ps1 to register the native host.');
    return;
  }

  const dirs = getHostDirs();
  let wrote = false;
  for (const dir of dirs) {
    if (await writeManifest(dir)) {
      console.log(`[recall-bridge] wrote native host manifest to ${dir}`);
      wrote = true;
    }
  }

  if (wrote) {
    console.log('[recall-bridge] Native messaging host registered.');
    console.log('[recall-bridge] To set your extension ID, edit the manifest:');
    console.log(`[recall-bridge]   ${dirs[0]}/com.recall.bridge.json`);
    console.log('[recall-bridge] Replace PLACEHOLDER_EXTENSION_ID with your Recall extension ID from chrome://extensions');
  } else {
    console.log('[recall-bridge] Could not register native host. Run install/install.sh manually.');
  }
}

main().catch(() => {});

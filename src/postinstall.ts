#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexJs = path.join(here, 'index.js');

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

async function createShim(): Promise<string> {
  const shimDir = path.join(os.homedir(), '.config', 'recall-bridge');
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, 'recall-bridge');
  const nodePath = process.execPath;
  const shim = `#!/usr/bin/env bash
# Chrome doesn't inherit the user's shell PATH
for d in "$HOME/.local/bin" "$HOME/.bun/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  [[ -d "$d" ]] && export PATH="$d:$PATH"
done
for d in "$HOME"/Library/Python/*/bin; do
  [[ -d "$d" ]] && export PATH="$d:$PATH"
done
exec "${nodePath}" "${indexJs}" "$@"
`;
  await fs.writeFile(shimPath, shim, { mode: 0o755 });
  return shimPath;
}

async function writeManifest(dir: string, shimPath: string): Promise<boolean> {
  const manifest: Record<string, unknown> = {
    name: 'com.recall.bridge',
    description: 'Recall memory bridge',
    path: shimPath,
    type: 'stdio',
    allowed_origins: ['chrome-extension://PLACEHOLDER_EXTENSION_ID/'],
  };
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
    await fs.writeFile(existing, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
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

  const shimPath = await createShim();
  console.log(`[recall-bridge] wrote shim to ${shimPath}`);

  const dirs = getHostDirs();
  let wrote = false;
  for (const dir of dirs) {
    if (await writeManifest(dir, shimPath)) {
      console.log(`[recall-bridge] wrote native host manifest to ${dir}`);
      wrote = true;
    }
  }

  if (wrote) {
    console.log('[recall-bridge] Native messaging host registered.');
    console.log('[recall-bridge] Run `recall-bridge setup` to set your extension ID and backend.');
  } else {
    console.log('[recall-bridge] Could not register native host. Run `recall-bridge setup` manually.');
  }
}

main().catch(() => {});

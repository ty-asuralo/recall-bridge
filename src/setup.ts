import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { BridgeConfig } from './config.js';
import { getConfigDir, saveConfig } from './config.js';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

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

export async function runSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  Recall Bridge Setup\n');

  const extensionId = (await ask(rl, '  Recall extension ID (from chrome://extensions): ')).trim();
  if (!extensionId) {
    console.log('  Skipped — you can set it later in the native host manifest.');
  }

  console.log('\n  Select retrieval backend:');
  console.log('    1) MemPalace');
  console.log('    2) Mock (development)');
  const choice = (await ask(rl, '  Choice [1-2]: ')).trim();
  const backend: BridgeConfig['backend'] = choice === '1' ? 'mempalace' : 'mock';

  let exportDir = (await ask(rl, '  Recall export folder (absolute path): ')).trim();
  exportDir = exportDir.replace(/^~/, os.homedir());

  rl.close();

  const config: BridgeConfig = { version: 1, backend, exportDir, lastIngestedAt: 0 };
  await saveConfig(config);
  console.log(`\n  wrote ${path.join(getConfigDir(), 'config.json')}`);

  const id = extensionId || 'PLACEHOLDER_EXTENSION_ID';

  const shimDir = path.join(os.homedir(), '.config', 'recall-bridge');
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, 'recall-bridge');
  const here = path.dirname(new URL(import.meta.url).pathname);
  const indexJs = path.join(here, 'index.js');
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
  console.log(`\n  wrote shim to ${shimPath}`);

  const manifest = JSON.stringify({
    name: 'com.recall.bridge',
    description: 'Recall memory bridge',
    path: shimPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  }, null, 2);

  const dirs = getHostDirs();
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'com.recall.bridge.json'), manifest + '\n', 'utf8');
      console.log(`  wrote ${dir}/com.recall.bridge.json`);
    } catch { /* skip */ }
  }

  console.log('\n  Setup complete. Reload the Recall extension in chrome://extensions.\n');
}

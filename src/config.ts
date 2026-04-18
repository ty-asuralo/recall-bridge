import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BridgeConfig {
  version: 1;
  backend: 'mempalace' | 'gbrain' | 'mock';
  exportDir: string;
  lastIngestedAt: number;
}

export function getConfigDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'recall-bridge');
  }
  return path.join(os.homedir(), '.config', 'recall-bridge');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function getStagingDir(): string {
  return path.join(getConfigDir(), 'staging');
}

const DEFAULT_CONFIG: BridgeConfig = {
  version: 1,
  backend: 'mock',
  exportDir: '',
  lastIngestedAt: 0,
};

export async function loadConfig(): Promise<BridgeConfig> {
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    return { ...DEFAULT_CONFIG, ...parsed, version: 1 };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw err;
  }
}

export async function saveConfig(cfg: BridgeConfig): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

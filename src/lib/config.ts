import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Config {
  apiKey: string;
  apiUrl: string;
}

const CONFIG_DIR = join(homedir(), '.linksnap');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials');
const DEFAULT_API_URL = 'https://linksnap.forjio.com/api/v1';
const DEFAULT_HUUDIS_ISSUER = 'https://huudis.com';
const DEFAULT_CLIENT_ID = 'linksnap-cli';

export function getConfig(): Config | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      apiKey: parsed.apiKey ?? '',
      apiUrl: parsed.apiUrl ?? DEFAULT_API_URL,
    };
  } catch {
    return null;
  }
}

export function setConfig(updates: Partial<Config>): Config {
  const existing = getConfig();
  const config: Config = {
    apiKey: updates.apiKey ?? existing?.apiKey ?? '',
    apiUrl: updates.apiUrl ?? existing?.apiUrl ?? DEFAULT_API_URL,
  };
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return config;
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    rmSync(CONFIG_FILE);
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getCredentialsPath(): string {
  return CREDENTIALS_FILE;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function resolveApiKey(opts: { apiKey?: string }): string | null {
  if (opts.apiKey) return opts.apiKey;
  if (process.env.LINKSNAP_API_KEY) return process.env.LINKSNAP_API_KEY;
  return getConfig()?.apiKey ?? null;
}

export function resolveApiUrl(opts: { apiUrl?: string }): string {
  if (opts.apiUrl) return opts.apiUrl;
  return getConfig()?.apiUrl ?? DEFAULT_API_URL;
}

export function resolveHuudisIssuer(): string {
  return process.env.LINKSNAP_HUUDIS_ISSUER ?? DEFAULT_HUUDIS_ISSUER;
}

export function resolveHuudisClientId(): string {
  return process.env.LINKSNAP_HUUDIS_CLIENT_ID ?? DEFAULT_CLIENT_ID;
}

export function resolveProfile(opts: { profile?: string }): string {
  if (opts.profile) return opts.profile;
  return process.env.LINKSNAP_PROFILE ?? 'default';
}

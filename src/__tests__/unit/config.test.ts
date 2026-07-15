import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We need to override homedir before importing config
const TEST_HOME = join(tmpdir(), `linksnap-test-${Date.now()}`);

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => TEST_HOME };
});

// Now import the module under test
const { getConfig, setConfig, clearConfig, getConfigPath, resolveApiKey, resolveApiUrl } = await import('../../lib/config.js');

const CONFIG_DIR = join(TEST_HOME, '.linksnap');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

describe('config', () => {
  beforeEach(() => {
    mkdirSync(CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(CONFIG_DIR)) {
      rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('getConfigPath', () => {
    it('returns path under home directory', () => {
      expect(getConfigPath()).toBe(CONFIG_FILE);
    });
  });

  describe('getConfig', () => {
    it('returns null when no config file exists', () => {
      if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
      expect(getConfig()).toBeNull();
    });

    it('reads config from file', () => {
      writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey: 'lsk_live_abc', apiUrl: 'https://custom.api/v1' }));
      const config = getConfig();
      expect(config).not.toBeNull();
      expect(config!.apiKey).toBe('lsk_live_abc');
      expect(config!.apiUrl).toBe('https://custom.api/v1');
    });

    it('provides default apiUrl if missing', () => {
      writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey: 'lsk_live_abc' }));
      const config = getConfig();
      expect(config!.apiUrl).toBe('https://linksnap.forjio.com/api/v1');
    });

    it('returns null on malformed JSON', () => {
      writeFileSync(CONFIG_FILE, 'not-json');
      expect(getConfig()).toBeNull();
    });
  });

  describe('setConfig', () => {
    it('creates config file and directory', () => {
      if (existsSync(CONFIG_DIR)) rmSync(CONFIG_DIR, { recursive: true, force: true });
      const config = setConfig({ apiKey: 'test-key' });
      expect(config.apiKey).toBe('test-key');
      expect(existsSync(CONFIG_FILE)).toBe(true);
    });

    it('merges with existing config', () => {
      setConfig({ apiKey: 'key1', apiUrl: 'https://old.api/v1' });
      const updated = setConfig({ apiKey: 'key2' });
      expect(updated.apiKey).toBe('key2');
      expect(updated.apiUrl).toBe('https://old.api/v1');
    });
  });

  describe('clearConfig', () => {
    it('removes config file', () => {
      writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey: 'test' }));
      clearConfig();
      expect(existsSync(CONFIG_FILE)).toBe(false);
    });

    it('does nothing when no config exists', () => {
      if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
      expect(() => clearConfig()).not.toThrow();
    });
  });

  describe('resolveApiKey', () => {
    it('prefers opts.apiKey over everything', () => {
      setConfig({ apiKey: 'config-key' });
      process.env.LINKSNAP_API_KEY = 'env-key';
      expect(resolveApiKey({ apiKey: 'opts-key' })).toBe('opts-key');
      delete process.env.LINKSNAP_API_KEY;
    });

    it('falls back to env var', () => {
      if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
      process.env.LINKSNAP_API_KEY = 'env-key';
      expect(resolveApiKey({})).toBe('env-key');
      delete process.env.LINKSNAP_API_KEY;
    });

    it('falls back to config file', () => {
      delete process.env.LINKSNAP_API_KEY;
      setConfig({ apiKey: 'file-key' });
      expect(resolveApiKey({})).toBe('file-key');
    });

    it('returns null when nothing available', () => {
      delete process.env.LINKSNAP_API_KEY;
      if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
      expect(resolveApiKey({})).toBeNull();
    });
  });

  describe('resolveApiUrl', () => {
    it('prefers opts.apiUrl', () => {
      expect(resolveApiUrl({ apiUrl: 'https://custom.api/v1' })).toBe('https://custom.api/v1');
    });

    it('falls back to config', () => {
      setConfig({ apiUrl: 'https://config.api/v1' });
      expect(resolveApiUrl({})).toBe('https://config.api/v1');
    });

    it('falls back to default', () => {
      if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
      expect(resolveApiUrl({})).toBe('https://linksnap.forjio.com/api/v1');
    });
  });
});

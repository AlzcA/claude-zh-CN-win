import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { checkForUpdate, generateShellHook } from '../src/core/watcher.js';
import { saveState, clearState } from '../src/core/patcher.js';
import { getCliMd5 } from '../src/core/backup.js';

const TEST_DIR = path.join(os.tmpdir(), 'cc-i18n-watcher-test-' + Date.now());
const TEST_CLI = path.join(TEST_DIR, 'cli.js');

describe('watcher', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
    await fs.writeFile(TEST_CLI, '"use strict"; var x = 1;');
    await clearState();
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
    await clearState();
  });

  describe('checkForUpdate', () => {
    it('should return not updated when no state exists', async () => {
      const result = await checkForUpdate();
      expect(result.updated).toBe(false);
      expect(result.locale).toBeNull();
    });

    it('should return not updated when MD5 matches', async () => {
      const md5 = getCliMd5(TEST_CLI);
      await saveState({
        locale: 'zh-TW',
        variant: null,
        ccVersion: '2.1.77',
        patchDate: new Date().toISOString(),
        cliPath: TEST_CLI,
        cliMd5: md5,
        replacements: 10,
        missed: 0,
        missedKeys: [],
      });

      const result = await checkForUpdate();
      expect(result.updated).toBe(false);
      expect(result.locale).toBe('zh-TW');
    });

    it('should return updated when MD5 differs', async () => {
      await saveState({
        locale: 'zh-TW',
        variant: null,
        ccVersion: '2.1.77',
        patchDate: new Date().toISOString(),
        cliPath: TEST_CLI,
        cliMd5: 'old-md5-that-does-not-match',
        replacements: 10,
        missed: 0,
        missedKeys: [],
      });

      const result = await checkForUpdate();
      expect(result.updated).toBe(true);
      expect(result.locale).toBe('zh-TW');
    });
  });

  describe('generateShellHook', () => {
    it('should return a valid shell script', () => {
      const hook = generateShellHook();
      expect(hook).toContain('cc-i18n');
      expect(hook).toContain('check-update');
      expect(hook).toContain('cc-i18n-check');
    });
  });
});

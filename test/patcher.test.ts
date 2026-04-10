import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { applyPatch, verifyPatch, loadState, clearState } from '../src/core/patcher.js';
import { createBackup, restoreBackup, hasValidBackup, getBackupInfo, removeBackup } from '../src/core/backup.js';

const TEST_DIR = path.join(os.tmpdir(), 'cc-i18n-test-' + Date.now());
const TEST_CLI = path.join(TEST_DIR, 'cli.js');
const TEST_BACKUP = TEST_CLI + '.cc-i18n-backup';

// A minimal valid JS file simulating cli.js
// Must include "Accept", "Default", "Bypass", "Allow" for verifyUnsafeIntegrity
const MOCK_CLI_CONTENT = `
"use strict";
var PROTO = {
  accept: "Accept",
  default: "Default",
  bypass: "Bypass",
  allow: "Allow",
  deny: "Deny",
};
var UI = {
  tryAgain: "Try again",
  notNow: "Not now",
  thinking: "Thinking",
  compacting: "Compacting conversation",
  planMode: "Plan Mode",
  yes: "Yes",
  no: "No",
  cont: "Continue",
  cancel: "Cancel",
  retry: "Retry",
  fileNotFound: "File not found",
  errorPrefix: "Error:",
  pressEnter: "Press Enter to continue",
};
console.log(UI);
`;

describe('backup', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
    await fs.writeFile(TEST_CLI, MOCK_CLI_CONTENT);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
  });

  it('should create a backup file', async () => {
    const backupPath = await createBackup(TEST_CLI);
    expect(backupPath).toBe(TEST_BACKUP);
    expect(await fs.pathExists(TEST_BACKUP)).toBe(true);

    const original = await fs.readFile(TEST_CLI, 'utf-8');
    const backup = await fs.readFile(TEST_BACKUP, 'utf-8');
    expect(backup).toBe(original);
  });

  it('should not overwrite existing backup', async () => {
    await createBackup(TEST_CLI);

    // Modify cli.js
    await fs.writeFile(TEST_CLI, '"modified"');

    // Create backup again — should keep old backup
    await createBackup(TEST_CLI);
    const backup = await fs.readFile(TEST_BACKUP, 'utf-8');
    expect(backup).toBe(MOCK_CLI_CONTENT);
  });

  it('should restore from backup', async () => {
    await createBackup(TEST_CLI);
    await fs.writeFile(TEST_CLI, '"modified"');

    const restored = await restoreBackup(TEST_CLI);
    expect(restored).toBe(true);

    const content = await fs.readFile(TEST_CLI, 'utf-8');
    expect(content).toBe(MOCK_CLI_CONTENT);
  });

  it('should return false when no backup exists', async () => {
    const restored = await restoreBackup(TEST_CLI);
    expect(restored).toBe(false);
  });

  it('should check backup validity', async () => {
    expect(await hasValidBackup(TEST_CLI)).toBe(false);
    await createBackup(TEST_CLI);
    expect(await hasValidBackup(TEST_CLI)).toBe(true);
  });

  it('should get backup info', async () => {
    await createBackup(TEST_CLI);
    const info = await getBackupInfo(TEST_CLI);
    expect(info).not.toBeNull();
    expect(info!.path).toBe(TEST_BACKUP);
    expect(info!.md5).toMatch(/^[a-f0-9]{32}$/);
    expect(info!.size).toBeGreaterThan(0);
  });

  it('should remove backup', async () => {
    await createBackup(TEST_CLI);
    expect(await hasValidBackup(TEST_CLI)).toBe(true);
    await removeBackup(TEST_CLI);
    expect(await hasValidBackup(TEST_CLI)).toBe(false);
  });
});

describe('patcher', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
    await fs.writeFile(TEST_CLI, MOCK_CLI_CONTENT);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
    await clearState();
  });

  it('should replace strings in double quotes', async () => {
    const translations = new Map([
      ['Try again', '再試一次'],
      ['Not now', '現在不要'],
    ]);

    const result = await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW');
    expect(result.applied).toBe(2);

    const patched = await fs.readFile(TEST_CLI, 'utf-8');
    expect(patched).toContain('"再試一次"');
    expect(patched).toContain('"現在不要"');
    expect(patched).not.toContain('"Try again"');
    expect(patched).not.toContain('"Not now"');
  });

  it('should replace longer strings first', async () => {
    const translations = new Map([
      ['Continue', '繼續'],
      ['Press Enter to continue', '按 Enter 繼續'],
    ]);

    const result = await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW');
    expect(result.applied).toBe(2);

    const patched = await fs.readFile(TEST_CLI, 'utf-8');
    expect(patched).toContain('"按 Enter 繼續"');
    expect(patched).toContain('"繼續"');
    // "Press Enter to continue" should not have been partially replaced
    expect(patched).not.toContain('"Press Enter to 繼續"');
  });

  it('should create backup before patching', async () => {
    const translations = new Map([['Try again', '再試一次']]);
    await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW');

    expect(await hasValidBackup(TEST_CLI)).toBe(true);
    const backup = await fs.readFile(TEST_BACKUP, 'utf-8');
    expect(backup).toBe(MOCK_CLI_CONTENT);
  });

  it('should report missed strings', async () => {
    const translations = new Map([
      ['Try again', '再試一次'],
      ['Nonexistent string', '不存在的字串'],
    ]);

    const result = await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW');
    expect(result.applied).toBe(1);
    expect(result.missed).toContain('Nonexistent string');
  });

  it('should auto-restore on syntax error', async () => {
    // Write invalid JS that will fail node --check after any patching
    const badContent = `var x = "Try again";\nvar y = `;
    await fs.writeFile(TEST_CLI, badContent);

    const translations = new Map([['Try again', '再試一次']]);

    // Should throw because the patched file is still invalid JS
    await expect(
      applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW')
    ).rejects.toThrow('failed syntax validation');

    // Original should be restored
    const content = await fs.readFile(TEST_CLI, 'utf-8');
    expect(content).toBe(badContent);
  });

  it('should save state after patching', async () => {
    const translations = new Map([['Try again', '再試一次']]);
    await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW', 'kids');

    const state = await loadState();
    expect(state).not.toBeNull();
    expect(state!.locale).toBe('zh-TW');
    expect(state!.variant).toBe('kids');
    expect(state!.ccVersion).toBe('2.1.77');
    expect(state!.replacements).toBe(1);
    expect(state!.cliPath).toBe(TEST_CLI);
  });

  it('should skip identical translations', async () => {
    const translations = new Map([
      ['Try again', 'Try again'], // Same — should skip
      ['Not now', '現在不要'],
    ]);

    const result = await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW');
    expect(result.applied).toBe(1);
  });
});

describe('verifyPatch', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
    await fs.writeFile(TEST_CLI, MOCK_CLI_CONTENT);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
    await clearState();
  });

  it('should verify applied translations', async () => {
    const translations = new Map([
      ['Try again', '再試一次'],
      ['Not now', '現在不要'],
    ]);

    await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW');

    const verification = await verifyPatch(TEST_CLI, translations);
    expect(verification.applied).toBe(2);
    expect(verification.missed).toHaveLength(0);
  });

  it('should report unverified translations', async () => {
    const translations = new Map([
      ['Try again', '再試一次'],
      ['Nonexistent', '不存在'],
    ]);

    await applyPatch(TEST_CLI, translations, '2.1.77', 'zh-TW');

    const verification = await verifyPatch(TEST_CLI, translations);
    expect(verification.applied).toBe(1);
    expect(verification.missed).toContain('Nonexistent');
  });
});

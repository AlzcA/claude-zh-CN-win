import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';

// Backup file suffix
const BACKUP_SUFFIX = '.cc-i18n-backup';

export interface BackupInfo {
  path: string;
  date: Date;
  md5: string;
  size: number;
}

function getBackupPath(cliPath: string): string {
  return cliPath + BACKUP_SUFFIX;
}

function computeMd5(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Create a backup of the original cli.js before patching.
 * If a backup already exists, it is preserved (we only back up the original).
 *
 * @param cliPath - Path to the cli.js file to back up
 * @returns Path to the backup file
 */
export async function createBackup(cliPath: string): Promise<string> {
  const backupPath = getBackupPath(cliPath);

  // Only create backup if one doesn't exist yet (preserve the original)
  if (!await fs.pathExists(backupPath)) {
    await fs.copy(cliPath, backupPath);
  }

  return backupPath;
}

/**
 * Restore cli.js from backup.
 *
 * @param cliPath - Path where cli.js should be restored
 * @returns true if restore succeeded
 */
export async function restoreBackup(cliPath: string): Promise<boolean> {
  const backupPath = getBackupPath(cliPath);

  if (!await fs.pathExists(backupPath)) {
    return false;
  }

  await fs.copy(backupPath, cliPath, { overwrite: true });
  return true;
}

/**
 * Remove the backup file after a successful unpatch.
 */
export async function removeBackup(cliPath: string): Promise<void> {
  const backupPath = getBackupPath(cliPath);
  if (await fs.pathExists(backupPath)) {
    await fs.remove(backupPath);
  }
}

/**
 * Check if a valid backup exists.
 */
export async function hasValidBackup(cliPath: string): Promise<boolean> {
  const backupPath = getBackupPath(cliPath);
  return fs.pathExists(backupPath);
}

/**
 * Get metadata about the backup file.
 */
export async function getBackupInfo(cliPath: string): Promise<BackupInfo | null> {
  const backupPath = getBackupPath(cliPath);

  if (!await fs.pathExists(backupPath)) {
    return null;
  }

  const stat = await fs.stat(backupPath);
  const md5 = computeMd5(backupPath);

  return {
    path: backupPath,
    date: stat.mtime,
    md5,
    size: stat.size,
  };
}

/**
 * Compute MD5 hash of the current cli.js (for detecting CC updates).
 */
export function getCliMd5(cliPath: string): string {
  return computeMd5(cliPath);
}

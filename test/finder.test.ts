import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// We test the exported functions by mocking child_process and fs
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs-extra', () => {
  const actual = vi.importActual('fs-extra');
  return {
    ...actual,
    default: {
      existsSync: vi.fn(),
      realpathSync: vi.fn(),
      readJsonSync: vi.fn(),
      readdirSync: vi.fn(),
    },
    existsSync: vi.fn(),
    realpathSync: vi.fn(),
    readJsonSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import { findClaudeCodeCli, getSearchPaths } from '../src/core/finder.js';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockRealpathSync = vi.mocked(fs.realpathSync);
const mockReadJsonSync = vi.mocked(fs.readJsonSync);

describe('finder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findClaudeCodeCli', () => {
    it('should find via which claude → symlink', async () => {
      const cliPath = '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js';
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which claude') return '/opt/homebrew/bin/claude\n';
        throw new Error('unexpected command');
      });
      mockRealpathSync.mockReturnValue(cliPath);
      mockExistsSync.mockImplementation((p: unknown) => {
        if (p === cliPath) return true;
        return false;
      });
      mockReadJsonSync.mockReturnValue({ version: '2.1.77' });

      const result = await findClaudeCodeCli();
      expect(result.cliPath).toBe(cliPath);
      expect(result.version).toBe('2.1.77');
      expect(result.packageDir).toBe(path.dirname(cliPath));
    });

    it('should find via npm root -g', async () => {
      const cliPath = '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js';
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which claude') throw new Error('not found');
        if (cmd === 'npm root -g') return '/usr/local/lib/node_modules\n';
        throw new Error('unexpected command');
      });
      mockExistsSync.mockImplementation((p: unknown) => {
        if (p === cliPath) return true;
        return false;
      });
      mockReadJsonSync.mockReturnValue({ version: '2.0.0' });

      const result = await findClaudeCodeCli();
      expect(result.cliPath).toBe(cliPath);
      expect(result.version).toBe('2.0.0');
    });

    it('should throw with helpful message when not found', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      mockExistsSync.mockReturnValue(false);

      await expect(findClaudeCodeCli()).rejects.toThrow('Could not find Claude Code installation');
      await expect(findClaudeCodeCli()).rejects.toThrow('npm install -g @anthropic-ai/claude-code');
    });
  });

  describe('getSearchPaths', () => {
    it('should return an array of paths', () => {
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      const paths = getSearchPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    });
  });
});

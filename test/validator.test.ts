import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { validateSyntax, validateTranslation } from '../src/core/validator.js';

const TEST_DIR = path.join(os.tmpdir(), 'cc-i18n-validator-test-' + Date.now());

describe('validator', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
  });

  describe('validateSyntax', () => {
    it('should return true for valid JS', async () => {
      const file = path.join(TEST_DIR, 'valid.js');
      await fs.writeFile(file, 'var x = "hello";\nconsole.log(x);');
      expect(await validateSyntax(file)).toBe(true);
    });

    it('should return false for invalid JS', async () => {
      const file = path.join(TEST_DIR, 'invalid.js');
      await fs.writeFile(file, 'var x = ');
      expect(await validateSyntax(file)).toBe(false);
    });
  });

  describe('validateTranslation', () => {
    it('should validate a correct translation file', async () => {
      const transPath = path.join(TEST_DIR, 'test.json');
      const enPath = path.join(TEST_DIR, 'en.json');

      const en = { _meta: { locale: 'en' }, greetings: { hello: 'Hello' } };
      const trans = { _meta: { locale: 'ja', version: '1.0.0' }, greetings: { hello: 'こんにちは' } };

      await fs.writeJson(enPath, en);
      await fs.writeJson(transPath, trans);

      const result = await validateTranslation(transPath, enPath);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing keys', async () => {
      const transPath = path.join(TEST_DIR, 'test.json');
      const enPath = path.join(TEST_DIR, 'en.json');

      const en = { _meta: { locale: 'en' }, greetings: { hello: 'Hello', bye: 'Bye' } };
      const trans = { _meta: { locale: 'ja', version: '1.0.0' }, greetings: { hello: 'こんにちは' } };

      await fs.writeJson(enPath, en);
      await fs.writeJson(transPath, trans);

      const result = await validateTranslation(transPath, enPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing key: greetings.bye');
    });

    it('should detect missing category', async () => {
      const transPath = path.join(TEST_DIR, 'test.json');
      const enPath = path.join(TEST_DIR, 'en.json');

      const en = { _meta: { locale: 'en' }, greetings: { hello: 'Hello' }, actions: { run: 'Run' } };
      const trans = { _meta: { locale: 'ja', version: '1.0.0' }, greetings: { hello: 'こんにちは' } };

      await fs.writeJson(enPath, en);
      await fs.writeJson(transPath, trans);

      const result = await validateTranslation(transPath, enPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing category: actions');
    });

    it('should detect missing _meta', async () => {
      const transPath = path.join(TEST_DIR, 'test.json');
      await fs.writeJson(transPath, { greetings: { hello: 'Hi' } });

      const result = await validateTranslation(transPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing _meta section');
    });

    it('should return error for nonexistent file', async () => {
      const result = await validateTranslation('/nonexistent/file.json');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('File not found');
    });
  });
});

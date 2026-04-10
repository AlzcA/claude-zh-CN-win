import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { extractStrings, categorizeStrings, KNOWN_STRINGS } from '../src/core/extractor.js';

const MOCK_CLI_PATH = path.join(__dirname, 'fixtures', 'mock-cli.js');

describe('extractor', () => {
  describe('KNOWN_STRINGS', () => {
    it('should have categories defined', () => {
      expect(Object.keys(KNOWN_STRINGS).length).toBeGreaterThan(5);
      expect(KNOWN_STRINGS.permissions).toBeDefined();
      expect(KNOWN_STRINGS.modes).toBeDefined();
      expect(KNOWN_STRINGS.status).toBeDefined();
      expect(KNOWN_STRINGS.prompts).toBeDefined();
      expect(KNOWN_STRINGS.errors).toBeDefined();
    });

    it('should have non-empty strings in each category', () => {
      for (const [category, strings] of Object.entries(KNOWN_STRINGS)) {
        expect(Object.keys(strings).length).toBeGreaterThan(0);
        for (const [key, value] of Object.entries(strings)) {
          expect(value.length, `${category}.${key} should not be empty`).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('extractStrings', () => {
    it('should extract known strings from mock cli.js', async () => {
      const results = await extractStrings(MOCK_CLI_PATH);
      expect(results.length).toBeGreaterThan(0);

      // Mock file contains "Allow", "Deny", "Thinking", etc.
      const originals = results.map(r => r.original);
      expect(originals).toContain('Allow');
      expect(originals).toContain('Deny');
      expect(originals).toContain('File not found');
    });

    it('should assign high confidence to known strings', async () => {
      const results = await extractStrings(MOCK_CLI_PATH);
      const known = results.filter(r => r.confidence === 'high');
      expect(known.length).toBeGreaterThan(0);
    });

    it('should include context around matches', async () => {
      const results = await extractStrings(MOCK_CLI_PATH);
      for (const r of results) {
        expect(r.context.length).toBeGreaterThan(0);
      }
    });

    it('should categorize results', async () => {
      const results = await extractStrings(MOCK_CLI_PATH);
      const categories = categorizeStrings(results);
      expect(Object.keys(categories).length).toBeGreaterThan(0);
    });
  });

  describe('categorizeStrings', () => {
    it('should group strings by category', () => {
      const input = [
        { key: 'a.b', original: 'X', pattern: '"X"', context: '...', category: 'permissions', confidence: 'high' as const },
        { key: 'c.d', original: 'Y', pattern: '"Y"', context: '...', category: 'status', confidence: 'high' as const },
        { key: 'e.f', original: 'Z', pattern: '"Z"', context: '...', category: 'permissions', confidence: 'medium' as const },
      ];
      const categories = categorizeStrings(input);
      expect(categories.permissions).toHaveLength(2);
      expect(categories.status).toHaveLength(1);
    });
  });
});

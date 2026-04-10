import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';

const TRANSLATIONS_DIR = path.join(__dirname, '..', 'src', 'translations');

function loadJson(name: string) {
  return fs.readJsonSync(path.join(TRANSLATIONS_DIR, name));
}

function getKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...getKeys(v as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

// Use en-technical as the canonical key reference (original CC strings)
const enTech = loadJson('en-technical.json');
const enTechKeys = getKeys(enTech).filter(k => !k.startsWith('_meta.')).sort();

const locales = [
  { file: 'en.json', name: 'en (recommended)' },
  { file: 'zh-TW.json', name: 'zh-TW (recommended)' },
  { file: 'zh-TW-technical.json', name: 'zh-TW-technical' },
  { file: 'zh-CN.json', name: 'zh-CN (recommended)' },
  { file: 'zh-CN-technical.json', name: 'zh-CN-technical' },
  { file: '_template.json', name: 'template' },
];

describe('translations', () => {
  it('en-technical.json should have all categories', () => {
    const categories = Object.keys(enTech).filter(k => k !== '_meta');
    expect(categories).toContain('permissions');
    expect(categories).toContain('modes');
    expect(categories).toContain('status');
    expect(categories).toContain('prompts');
    expect(categories).toContain('errors');
  });

  for (const locale of locales) {
    describe(locale.name, () => {
      const data = loadJson(locale.file);
      const dataKeys = getKeys(data).filter(k => !k.startsWith('_meta.')).sort();

      it('should have valid _meta', () => {
        expect(data._meta).toBeDefined();
        expect(data._meta.version).toBeDefined();
      });

      it('should have the same translation keys as en-technical.json', () => {
        const missing = enTechKeys.filter(k => !dataKeys.includes(k));
        const extra = dataKeys.filter(k => !enTechKeys.includes(k));

        if (missing.length > 0) {
          throw new Error(`${locale.name} missing keys: ${missing.join(', ')}`);
        }
        if (extra.length > 0) {
          throw new Error(`${locale.name} extra keys: ${extra.join(', ')}`);
        }
      });

      if (locale.name !== 'template') {
        it('should have no empty translation strings', () => {
          const empties: string[] = [];
          for (const [cat, strings] of Object.entries(data)) {
            if (cat === '_meta') continue;
            for (const [key, value] of Object.entries(strings as Record<string, string>)) {
              if (value === '') empties.push(`${cat}.${key}`);
            }
          }
          expect(empties, `Empty translations: ${empties.join(', ')}`).toHaveLength(0);
        });
      }

      if (locale.name === 'template') {
        it('should have all empty strings', () => {
          for (const [cat, strings] of Object.entries(data)) {
            if (cat === '_meta') continue;
            for (const [key, value] of Object.entries(strings as Record<string, string>)) {
              expect(value, `${cat}.${key} should be empty`).toBe('');
            }
          }
        });
      }
    });
  }

  describe('variant metadata', () => {
    it('recommended files should have variant "recommended"', () => {
      expect(loadJson('en.json')._meta.variant).toBe('recommended');
      expect(loadJson('zh-TW.json')._meta.variant).toBe('recommended');
      expect(loadJson('zh-CN.json')._meta.variant).toBe('recommended');
    });

    it('technical files should have variant "technical"', () => {
      expect(loadJson('en-technical.json')._meta.variant).toBe('technical');
      expect(loadJson('zh-TW-technical.json')._meta.variant).toBe('technical');
      expect(loadJson('zh-CN-technical.json')._meta.variant).toBe('technical');
    });
  });
});

import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LocaleInfo {
  locale: string;
  name: string;
  nativeName: string;
  variant?: string;
  file: string;
}

/**
 * Grouped locale: a base language with its available variants.
 */
export interface LocaleGroup {
  baseLocale: string;
  nativeName: string;
  variants: { key: string; variant: string; nativeName: string }[];
}

function getTranslationsDir(): string {
  const candidates = [
    path.join(__dirname, 'translations'),
    path.join(__dirname, '..', 'translations'),
    path.join(__dirname, '..', '..', 'src', 'translations'),
    path.join(__dirname, '..', 'src', 'translations'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'en.json'))) return dir;
  }

  throw new Error('Cannot find translations directory');
}

/**
 * List all available translation locales.
 */
export async function listLocales(): Promise<LocaleInfo[]> {
  const dir = getTranslationsDir();
  const files = await fs.readdir(dir);
  const locales: LocaleInfo[] = [];

  for (const file of files) {
    if (!file.endsWith('.json') || file === '_template.json') continue;

    const filePath = path.join(dir, file);
    try {
      const data = await fs.readJson(filePath);
      if (data._meta) {
        locales.push({
          locale: file.replace('.json', ''),
          name: data._meta.name || '',
          nativeName: data._meta.nativeName || '',
          variant: data._meta.variant,
          file: filePath,
        });
      }
    } catch {
      // Skip invalid files
    }
  }

  return locales;
}

/**
 * Group locales by base language (e.g. zh-TW and zh-TW-technical are one group).
 */
export async function listLocaleGroups(): Promise<LocaleGroup[]> {
  const locales = await listLocales();
  const groups = new Map<string, LocaleGroup>();

  for (const loc of locales) {
    // Derive base locale: "zh-TW-technical" → "zh-TW", "en" → "en"
    const baseLocale = loc.locale.replace(/-technical$/, '');

    if (!groups.has(baseLocale)) {
      groups.set(baseLocale, {
        baseLocale,
        nativeName: '',
        variants: [],
      });
    }

    const group = groups.get(baseLocale)!;
    const variant = loc.variant || 'recommended';

    // Use the recommended variant's nativeName for the group
    if (variant === 'recommended') {
      group.nativeName = loc.nativeName;
    }

    group.variants.push({
      key: loc.locale,
      variant,
      nativeName: loc.nativeName,
    });
  }

  // Fill nativeName for groups that only have technical
  for (const group of groups.values()) {
    if (!group.nativeName && group.variants.length > 0) {
      group.nativeName = group.variants[0].nativeName.replace(/（.*）/, '').replace(/\(.*\)/, '').trim();
    }
  }

  return [...groups.values()];
}

/**
 * Load a translation file and build a Map of English originals → Translated strings.
 * Uses en-technical.json as the base (original CC English strings).
 */
export async function loadTranslationMap(
  localeKey: string
): Promise<{ map: Map<string, string>; meta: Record<string, unknown> }> {
  const dir = getTranslationsDir();
  const filePath = path.join(dir, `${localeKey}.json`);

  if (!await fs.pathExists(filePath)) {
    throw new Error(
      `Translation file not found: ${localeKey}.json\n` +
      `Run "cc-i18n list" to see available locales.`
    );
  }

  const translation = await fs.readJson(filePath);

  // Always use en-technical as the base (these are the actual strings in cli.js)
  const enTechnicalPath = path.join(dir, 'en-technical.json');
  const en = await fs.readJson(
    await fs.pathExists(enTechnicalPath) ? enTechnicalPath : path.join(dir, 'en.json')
  );

  const map = new Map<string, string>();

  for (const [category, strings] of Object.entries(en)) {
    if (category === '_meta') continue;
    const translatedCategory = translation[category] as Record<string, string> | undefined;
    if (!translatedCategory) continue;

    for (const [key, englishValue] of Object.entries(strings as Record<string, string>)) {
      const translatedValue = translatedCategory[key];
      if (translatedValue && translatedValue !== englishValue) {
        map.set(englishValue, translatedValue);
      }
    }
  }

  return { map, meta: translation._meta };
}

/**
 * Load the English base translation.
 */
export async function loadEnglishBase(): Promise<Record<string, Record<string, string>>> {
  const dir = getTranslationsDir();
  return fs.readJson(path.join(dir, 'en.json'));
}

/**
 * Load the empty template.
 */
export async function loadTemplate(): Promise<Record<string, unknown>> {
  const dir = getTranslationsDir();
  return fs.readJson(path.join(dir, '_template.json'));
}

/**
 * Resolve locale key from --lang and --technical flags.
 * e.g. lang="zh-TW", technical=true → "zh-TW-technical"
 */
export function resolveLocaleKey(lang: string, technical?: boolean): string {
  if (technical && !lang.endsWith('-technical')) {
    return `${lang}-technical`;
  }
  return lang;
}

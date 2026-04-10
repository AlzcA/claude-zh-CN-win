import { execSync } from 'node:child_process';

/**
 * Detect the user's system language and map it to a cc-i18n locale.
 */

const ENV_LOCALE_MAP: Record<string, string> = {
  'zh_TW': 'zh-TW',
  'zh_HK': 'zh-TW',
  'zh_CN': 'zh-CN',
  'zh_SG': 'zh-CN',
  'zh': 'zh-CN',
  'ja_JP': 'ja',
  'ja': 'ja',
  'ko_KR': 'ko',
  'ko': 'ko',
  'es': 'es',
  'fr': 'fr',
  'de': 'de',
  'pt': 'pt',
};

// Windows locale codes
const WINDOWS_LOCALE_MAP: Record<string, string> = {
  'zh-TW': 'zh-TW',
  'zh-HK': 'zh-TW',
  'zh-MO': 'zh-TW',
  'zh-CN': 'zh-CN',
  'zh-SG': 'zh-CN',
  'zh': 'zh-CN',
  'ja-JP': 'ja',
  'ja': 'ja',
  'ko-KR': 'ko',
  'ko': 'ko',
  'es': 'es',
  'fr': 'fr',
  'de': 'de',
  'pt': 'pt',
};

const TIMEZONE_LOCALE_MAP: Record<string, string> = {
  'Asia/Taipei': 'zh-TW',
  'Asia/Hong_Kong': 'zh-TW',
  'Asia/Shanghai': 'zh-CN',
  'Asia/Chongqing': 'zh-CN',
  'Asia/Harbin': 'zh-CN',
  'Asia/Urumqi': 'zh-CN',
  'Asia/Singapore': 'zh-CN',
  'Asia/Tokyo': 'ja',
  'Asia/Seoul': 'ko',
  'Europe/Madrid': 'es',
  'Europe/Paris': 'fr',
  'Europe/Berlin': 'de',
  'America/Sao_Paulo': 'pt',
};

export interface DetectionResult {
  locale: string | null;
  source: 'env' | 'timezone' | null;
  raw: string | null;
}

/**
 * Detect system language from environment variables and timezone.
 */
export function detectSystemLanguage(): DetectionResult {
  // Strategy 1: Environment variables (Unix-style)
  const envLang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES;
  if (envLang) {
    // Parse "zh_TW.UTF-8" → "zh_TW"
    const langPart = envLang.split('.')[0];
    // Try full match first (zh_TW), then language only (zh)
    const locale = ENV_LOCALE_MAP[langPart] || ENV_LOCALE_MAP[langPart.split('_')[0]];
    if (locale) {
      return { locale, source: 'env', raw: envLang };
    }
  }

  // Strategy 2: Windows locale environment variables
  if (process.platform === 'win32') {
    const winLocale = process.env.LANG || process.env.LANGUAGE || process.env.Culture;
    if (winLocale) {
      // Windows uses formats like "zh-CN", "zh-TW", "en-US"
      const normalized = winLocale.split('.')[0]; // "zh-CN" from "zh-CN.UTF-8"
      const locale = WINDOWS_LOCALE_MAP[normalized] || WINDOWS_LOCALE_MAP[normalized.split('-')[0]];
      if (locale) {
        return { locale, source: 'env', raw: winLocale };
      }
    }

    // Try to get Windows UI language via PowerShell
    try {
      const psResult = execSync(
        'powershell -NoProfile -Command "[System.Globalization.CultureInfo]::CurrentUICulture.Name"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
      if (psResult) {
        const locale = WINDOWS_LOCALE_MAP[psResult] || WINDOWS_LOCALE_MAP[psResult.split('-')[0]];
        if (locale) {
          return { locale, source: 'env', raw: psResult };
        }
      }
    } catch {
      // PowerShell not available or failed
    }
  }

  // Strategy 3: Timezone
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) {
      const locale = TIMEZONE_LOCALE_MAP[tz];
      if (locale) {
        return { locale, source: 'timezone', raw: tz };
      }
    }
  } catch {
    // Intl not available
  }

  return { locale: null, source: null, raw: null };
}

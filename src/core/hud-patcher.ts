import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const HUD_CACHE_BASE = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'claude-hud', 'claude-hud');

/**
 * HUD UI strings to translate, organized by file.
 * Key = search string (exact match in JS source), Value = category.key for translation lookup.
 */
const HUD_STRINGS: Record<string, { file: string; strings: Record<string, string> }> = {
  'session-line': {
    file: 'dist/render/session-line.js',
    strings: {
      // Config counts
      ' CLAUDE.md': 'hud.claude_md',
      ' rules': 'hud.rules',
      ' MCPs': 'hud.mcps',
      ' hooks': 'hud.hooks',
      // Usage labels
      '/ 5h)': 'hud.quota_5h_bar',
      '/ 7d)': 'hud.quota_7d_bar',
      '5h: ': 'hud.quota_5h_text',
      '7d: ': 'hud.quota_7d_text',
      // Usage warnings
      'Limit reached': 'hud.limit_reached',
      'resets ': 'hud.resets',
      '(syncing...)': 'hud.syncing',
      // Speed
      'out: ': 'hud.output_speed',
      // Context (in token breakdown)
      'in: ': 'hud.input_tokens',
      'cache: ': 'hud.cache_tokens',
    },
  },
  'identity': {
    file: 'dist/render/lines/identity.js',
    strings: {
      "'Context'": 'hud.context_label',
      'in: ': 'hud.input_tokens',
      'cache: ': 'hud.cache_tokens',
    },
  },
  'usage': {
    file: 'dist/render/lines/usage.js',
    strings: {
      "'Usage'": 'hud.usage_label',
      '/ 5h)': 'hud.quota_5h_bar',
      '/ 7d)': 'hud.quota_7d_bar',
      '5h: ': 'hud.quota_5h_text',
      '7d: ': 'hud.quota_7d_text',
      'Limit reached': 'hud.limit_reached',
      '(syncing...)': 'hud.syncing',
    },
  },
  'todos': {
    file: 'dist/render/todos-line.js',
    strings: {
      'All todos complete': 'hud.all_todos_complete',
    },
  },
};

/**
 * HUD translation strings for each locale.
 */
const HUD_TRANSLATIONS: Record<string, Record<string, string>> = {
  'zh-TW': {
    'hud.context_label': "'記憶'",
    'hud.usage_label': "'用量'",
    'hud.claude_md': ' CLAUDE.md',
    'hud.rules': ' 規則',
    'hud.mcps': ' MCPs',
    'hud.hooks': ' 鉤子',
    'hud.quota_5h_bar': '/ 日用量)',
    'hud.quota_7d_bar': '/ 週用量)',
    'hud.quota_5h_text': '日用量: ',
    'hud.quota_7d_text': '週用量: ',
    'hud.limit_reached': '⚠️ 用完了',
    'hud.resets': '恢復 ',
    'hud.syncing': '(同步中...)',
    'hud.output_speed': '速度: ',
    'hud.input_tokens': '輸入: ',
    'hud.cache_tokens': '快取: ',
    'hud.all_todos_complete': '✅ 全部做完了',
  },
  'zh-TW-technical': {
    'hud.context_label': "'上下文'",
    'hud.usage_label': "'用量'",
    'hud.claude_md': ' CLAUDE.md',
    'hud.rules': ' 規則',
    'hud.mcps': ' MCPs',
    'hud.hooks': ' 鉤子',
    'hud.quota_5h_bar': '/ 日用量)',
    'hud.quota_7d_bar': '/ 週用量)',
    'hud.quota_5h_text': '日用量: ',
    'hud.quota_7d_text': '週用量: ',
    'hud.limit_reached': '已達上限',
    'hud.resets': '重置 ',
    'hud.syncing': '(同步中...)',
    'hud.output_speed': '輸出: ',
    'hud.input_tokens': '輸入: ',
    'hud.cache_tokens': '快取: ',
    'hud.all_todos_complete': '所有待辦已完成',
  },
  'zh-CN': {
    'hud.context_label': "'记忆'",
    'hud.usage_label': "'用量'",
    'hud.claude_md': ' CLAUDE.md',
    'hud.rules': ' 规则',
    'hud.mcps': ' MCPs',
    'hud.hooks': ' 钩子',
    'hud.quota_5h_bar': '/ 日用量)',
    'hud.quota_7d_bar': '/ 周用量)',
    'hud.quota_5h_text': '日用量: ',
    'hud.quota_7d_text': '周用量: ',
    'hud.limit_reached': '⚠️ 用完了',
    'hud.resets': '恢复 ',
    'hud.syncing': '(同步中...)',
    'hud.output_speed': '速度: ',
    'hud.input_tokens': '输入: ',
    'hud.cache_tokens': '缓存: ',
    'hud.all_todos_complete': '✅ 全部做完了',
  },
  'zh-CN-technical': {
    'hud.context_label': "'上下文'",
    'hud.usage_label': "'用量'",
    'hud.claude_md': ' CLAUDE.md',
    'hud.rules': ' 规则',
    'hud.mcps': ' MCPs',
    'hud.hooks': ' 钩子',
    'hud.quota_5h_bar': '/ 日用量)',
    'hud.quota_7d_bar': '/ 周用量)',
    'hud.quota_5h_text': '日用量: ',
    'hud.quota_7d_text': '周用量: ',
    'hud.limit_reached': '已达上限',
    'hud.resets': '重置 ',
    'hud.syncing': '(同步中...)',
    'hud.output_speed': '输出: ',
    'hud.input_tokens': '输入: ',
    'hud.cache_tokens': '缓存: ',
    'hud.all_todos_complete': '所有待办已完成',
  },
  'en': {
    'hud.context_label': "'Memory'",
    'hud.usage_label': "'Usage'",
    'hud.quota_5h_bar': '/ daily)',
    'hud.quota_7d_bar': '/ weekly)',
    'hud.quota_5h_text': 'daily: ',
    'hud.quota_7d_text': 'weekly: ',
    'hud.limit_reached': '⚠️ Limit hit',
    'hud.syncing': '(syncing...)',
    'hud.all_todos_complete': '✅ All done!',
  },
};

/**
 * Find the installed claude-hud version directory.
 */
export function findHudDir(): string | null {
  if (!fs.existsSync(HUD_CACHE_BASE)) return null;

  try {
    const versions = fs.readdirSync(HUD_CACHE_BASE).sort().reverse();
    for (const ver of versions) {
      // dist/ can be directly under version dir or under claude-hud subdir
      const candidates = [
        path.join(HUD_CACHE_BASE, ver),
        path.join(HUD_CACHE_BASE, ver, 'claude-hud'),
      ];
      for (const hudDir of candidates) {
        if (fs.existsSync(path.join(hudDir, 'dist', 'render'))) {
          return hudDir;
        }
      }
    }
  } catch {
    // not readable
  }
  return null;
}

/**
 * Apply HUD translations.
 * Returns number of strings replaced.
 */
export async function patchHud(localeKey: string): Promise<{ applied: number; total: number }> {
  const hudDir = findHudDir();
  if (!hudDir) return { applied: 0, total: 0 };

  const translations = HUD_TRANSLATIONS[localeKey];
  if (!translations) return { applied: 0, total: 0 };

  let applied = 0;
  let total = 0;

  for (const [, config] of Object.entries(HUD_STRINGS)) {
    const filePath = path.join(hudDir, config.file);
    if (!await fs.pathExists(filePath)) continue;

    // Backup original
    const backupPath = filePath + '.cc-i18n-backup';
    if (!await fs.pathExists(backupPath)) {
      await fs.copy(filePath, backupPath);
    }

    let source = await fs.readFile(filePath, 'utf-8');

    for (const [search, translationKey] of Object.entries(config.strings)) {
      const translated = translations[translationKey];
      if (!translated || search === translated) continue;

      total++;
      if (source.includes(search)) {
        source = source.split(search).join(translated);
        applied++;
      }
    }

    await fs.writeFile(filePath, source, 'utf-8');
  }

  return { applied, total };
}

/**
 * Restore HUD files from backups.
 */
export async function unpatchHud(): Promise<boolean> {
  const hudDir = findHudDir();
  if (!hudDir) return false;

  let restored = false;

  for (const [, config] of Object.entries(HUD_STRINGS)) {
    const filePath = path.join(hudDir, config.file);
    const backupPath = filePath + '.cc-i18n-backup';

    if (await fs.pathExists(backupPath)) {
      await fs.copy(backupPath, filePath, { overwrite: true });
      await fs.remove(backupPath);
      restored = true;
    }
  }

  return restored;
}

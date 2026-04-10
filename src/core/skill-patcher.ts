import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

interface SkillTranslations {
  superpowers: Record<string, string>;
  gsd: Record<string, string>;
  user_skills: Record<string, string>;
  deprecated_superpowers?: Record<string, string>;
  telegram?: Record<string, string>;
  other_commands: Record<string, string>;
  [key: string]: Record<string, string> | string | undefined;
}

interface SkillPatchResult {
  patched: number;
  skipped: number;
  errors: string[];
}

/**
 * Load skill description translations for a given locale.
 */
async function loadSkillTranslations(locale: string): Promise<SkillTranslations | null> {
  const baseLang = locale.replace(/-technical$/, '');
  const distDir = path.dirname(new URL(import.meta.url).pathname);

  // Try multiple paths: bundled (dist/translations/) and source (src/translations/)
  const candidates = [
    path.join(distDir, 'translations', `skill-descriptions-${baseLang}.json`),
    path.join(distDir, '..', 'translations', `skill-descriptions-${baseLang}.json`),
    path.join(distDir, '..', 'src', 'translations', `skill-descriptions-${baseLang}.json`),
  ];

  for (const filePath of candidates) {
    if (await fs.pathExists(filePath)) {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  }
  return null;
}

/**
 * Patch a single SKILL.md or command .md file's description field.
 * Returns true if patched, false if skipped.
 */
async function patchSkillFile(
  filePath: string,
  translations: Record<string, string>,
): Promise<boolean> {
  const content = await fs.readFile(filePath, 'utf-8');

  // Match frontmatter description field (supports quoted and unquoted, single/multi-line)
  const descMatch = content.match(
    /^(---\n[\s\S]*?)(description:\s*)(["']?)([\s\S]*?)\3(\n(?:  .*\n)*)?(?=\w+:|---)/m,
  );

  if (!descMatch) return false;

  // Extract description text — handle multiline YAML (>, |, or continuation lines)
  let currentDesc = '';
  const lines = content.split('\n');
  let inDesc = false;
  let descLineStart = -1;
  let descLineEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^description:\s*/)) {
      inDesc = true;
      descLineStart = i;
      // Single-line: description: "text" or description: text
      const singleMatch = line.match(/^description:\s*["']?(.*?)["']?\s*$/);
      if (singleMatch) {
        const val = singleMatch[1].trim();
        // Check if it's a YAML block scalar (> or |)
        if (val === '>' || val === '|') {
          continue;
        }
        if (val.startsWith('"') || val.endsWith('"')) {
          currentDesc = val.replace(/^"|"$/g, '');
        } else {
          currentDesc = val;
        }
        descLineEnd = i;
      }
      continue;
    }
    if (inDesc && line.match(/^\s{2,}/)) {
      // Continuation line
      currentDesc += ' ' + line.trim();
      descLineEnd = i;
      continue;
    }
    if (inDesc) {
      inDesc = false;
      break;
    }
  }

  if (!currentDesc || descLineStart === -1) return false;
  currentDesc = currentDesc.trim();

  // Look up translation
  const translation = translations[currentDesc];
  if (!translation) return false;

  // Replace description lines
  const newDescLine = `description: "${translation.replace(/"/g, '\\"')}"`;
  const newLines = [
    ...lines.slice(0, descLineStart),
    newDescLine,
    ...lines.slice(descLineEnd + 1),
  ];

  await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');
  return true;
}

/**
 * Find all skill and command files that need translation.
 */
async function findSkillFiles(): Promise<{
  superpowers: string[];
  gsd: string[];
  userSkills: string[];
  otherCommands: string[];
}> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const result = {
    superpowers: [] as string[],
    gsd: [] as string[],
    userSkills: [] as string[],
    otherCommands: [] as string[],
  };

  // User skills
  const skillsDir = path.join(claudeDir, 'skills');
  if (await fs.pathExists(skillsDir)) {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
        if (await fs.pathExists(skillFile)) {
          result.userSkills.push(skillFile);
        }
      }
    }
  }

  // Superpowers plugin skills (both marketplaces and cache)
  const pluginDirs = [
    path.join(claudeDir, 'plugins', 'marketplaces', 'superpowers-dev', 'skills'),
    path.join(claudeDir, 'plugins', 'cache', 'claude-plugins-official', 'superpowers'),
  ];

  for (const dir of pluginDirs) {
    if (!(await fs.pathExists(dir))) continue;

    // For cache dir, search all version subdirs
    if (dir.includes('cache')) {
      const versions = await fs.readdir(dir, { withFileTypes: true });
      for (const ver of versions) {
        if (ver.isDirectory()) {
          const skillsSubdir = path.join(dir, ver.name, 'skills');
          if (await fs.pathExists(skillsSubdir)) {
            const skills = await fs.readdir(skillsSubdir, { withFileTypes: true });
            for (const skill of skills) {
              if (skill.isDirectory()) {
                const f = path.join(skillsSubdir, skill.name, 'SKILL.md');
                if (await fs.pathExists(f)) result.superpowers.push(f);
              }
            }
          }
        }
      }
    } else {
      // Marketplaces dir — direct skill subdirs
      const skills = await fs.readdir(dir, { withFileTypes: true });
      for (const skill of skills) {
        if (skill.isDirectory()) {
          const f = path.join(dir, skill.name, 'SKILL.md');
          if (await fs.pathExists(f)) result.superpowers.push(f);
        }
      }
    }
  }

  // GSD commands
  const gsdDir = path.join(claudeDir, 'commands', 'gsd');
  if (await fs.pathExists(gsdDir)) {
    const files = await fs.readdir(gsdDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        result.gsd.push(path.join(gsdDir, file));
      }
    }
  }

  // Superpowers commands (deprecated aliases)
  const superpowersCmdDirs = [
    path.join(claudeDir, 'plugins', 'marketplaces', 'superpowers-dev', 'commands'),
    // cache versions
    ...await (async () => {
      const cacheBase = path.join(claudeDir, 'plugins', 'cache', 'claude-plugins-official', 'superpowers');
      if (!(await fs.pathExists(cacheBase))) return [];
      const versions = await fs.readdir(cacheBase, { withFileTypes: true });
      return versions
        .filter(v => v.isDirectory())
        .map(v => path.join(cacheBase, v.name, 'commands'));
    })(),
  ];
  for (const dir of superpowersCmdDirs) {
    if (!(await fs.pathExists(dir))) continue;
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        result.superpowers.push(path.join(dir, file));
      }
    }
  }

  // Telegram plugin skills (cache + marketplaces)
  const telegramDirs = [
    path.join(claudeDir, 'plugins', 'marketplaces', 'claude-plugins-official', 'external_plugins', 'telegram', 'skills'),
    ...await (async () => {
      const cacheBase = path.join(claudeDir, 'plugins', 'cache', 'claude-plugins-official', 'telegram');
      if (!(await fs.pathExists(cacheBase))) return [];
      const versions = await fs.readdir(cacheBase, { withFileTypes: true });
      return versions
        .filter(v => v.isDirectory())
        .map(v => path.join(cacheBase, v.name, 'skills'));
    })(),
  ];
  for (const dir of telegramDirs) {
    if (!(await fs.pathExists(dir))) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const f = path.join(dir, entry.name, 'SKILL.md');
        if (await fs.pathExists(f)) result.otherCommands.push(f);
      }
    }
  }

  // Other commands (non-gsd)
  const cmdDir = path.join(claudeDir, 'commands');
  if (await fs.pathExists(cmdDir)) {
    const files = await fs.readdir(cmdDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        result.otherCommands.push(path.join(cmdDir, file));
      }
    }
  }

  return result;
}

/**
 * Patch all skill and command descriptions with translated versions.
 */
export async function patchSkillDescriptions(locale: string): Promise<SkillPatchResult> {
  const translations = await loadSkillTranslations(locale);
  if (!translations) {
    return { patched: 0, skipped: 0, errors: [`No skill translations for locale: ${locale}`] };
  }

  const files = await findSkillFiles();
  let patched = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Combine all translations into one map for simpler lookup
  const allTranslations: Record<string, string> = {};
  for (const [key, val] of Object.entries(translations)) {
    if (key === '_comment' || typeof val !== 'object') continue;
    Object.assign(allTranslations, val);
  }

  const allFiles = [
    ...files.superpowers,
    ...files.gsd,
    ...files.userSkills,
    ...files.otherCommands,
  ];

  for (const filePath of allFiles) {
    try {
      const didPatch = await patchSkillFile(filePath, allTranslations);
      if (didPatch) {
        patched++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { patched, skipped, errors };
}

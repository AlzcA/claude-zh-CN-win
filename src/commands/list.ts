import chalk from 'chalk';
import { listLocaleGroups } from '../core/translations.js';
import { loadState } from '../core/patcher.js';

export async function listCommand(): Promise<void> {
  const groups = await listLocaleGroups();
  const state = await loadState();

  const currentLocale = state
    ? (state.variant ? `${state.locale}-${state.variant}` : state.locale)
    : null;
  const currentVariant = state?.variant || 'recommended';

  console.log();
  console.log(chalk.bold('☯ cc-i18n — Available Languages'));
  console.log();
  console.log(`  ${chalk.bold(pad('Language', 22))}${chalk.bold('Mode')}`);
  console.log(chalk.dim('  ' + '─'.repeat(50)));

  for (const group of groups) {
    const hasRecommended = group.variants.some(v => v.variant === 'recommended');
    const hasTechnical = group.variants.some(v => v.variant === 'technical');

    let modes = '';
    if (hasRecommended && hasTechnical) {
      modes = `${chalk.green('✅ recommended')} / ${chalk.dim('🔧 technical')}`;
    } else if (hasRecommended) {
      modes = chalk.green('✅ recommended');
    } else if (hasTechnical) {
      modes = chalk.dim('🔧 technical');
    } else {
      modes = chalk.yellow('📝 template only');
    }

    const label = group.baseLocale === 'en'
      ? 'English'
      : `${group.nativeName} (${group.baseLocale})`;

    console.log(`  ${pad(label, 22)}${modes}`);
  }

  console.log();
  console.log(chalk.dim('  ✅ = translation complete   📝 = awaiting contribution'));

  if (currentLocale) {
    console.log();
    console.log(`  Current: ${chalk.cyan(currentLocale)} (${currentVariant})`);
  }

  console.log();
}

function pad(str: string, len: number): string {
  // Account for CJK characters taking 2 columns
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    width += (code > 0x2E80 && code < 0xFFFF) ? 2 : 1;
  }
  const padding = Math.max(0, len - width);
  return str + ' '.repeat(padding);
}

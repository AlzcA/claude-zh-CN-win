import chalk from 'chalk';
import { checkForUpdate, generateShellHook } from '../core/watcher.js';
import { loadState } from '../core/patcher.js';
import { loadTranslationMap } from '../core/translations.js';
import { applyPatch } from '../core/patcher.js';
import { findClaudeCodeCli } from '../core/finder.js';
import { removeBackup } from '../core/backup.js';

interface CheckUpdateOptions {
  quiet?: boolean;
  repatch?: boolean;
  hook?: boolean;
}

export async function checkUpdateCommand(options: CheckUpdateOptions): Promise<void> {
  // --hook: print the shell hook snippet
  if (options.hook) {
    console.log(generateShellHook());
    return;
  }

  const result = await checkForUpdate();

  if (!result.locale) {
    if (!options.quiet) {
      console.log(chalk.dim('No patch applied. Nothing to check.'));
    }
    return;
  }

  if (!result.updated) {
    if (!options.quiet) {
      console.log(chalk.green('✅ Patch is current. No CC update detected.'));
    }
    return;
  }

  // CC was updated
  if (options.quiet) {
    // In quiet mode (shell hook), auto-repatch
    await doRepatch();
    return;
  }

  console.log(chalk.yellow('⚠ Claude Code has been updated since last patch.'));
  console.log(chalk.yellow('  Your translations are no longer applied.'));
  console.log();

  if (options.repatch) {
    await doRepatch();
  } else {
    const state = await loadState();
    console.log(chalk.dim(`  Run "cc-i18n patch --lang ${state?.locale}" to re-apply.`));
    console.log(chalk.dim('  Or run "cc-i18n check-update --repatch" to auto re-apply.'));
  }
}

async function doRepatch(): Promise<void> {
  const state = await loadState();
  if (!state) return;

  try {
    const cc = await findClaudeCodeCli();
    const localeKey = state.variant ? `${state.locale}-${state.variant}` : state.locale;
    const { map } = await loadTranslationMap(localeKey);

    // Remove old backup since CC updated (the old backup is the pre-update version)
    await removeBackup(cc.cliPath);

    const result = await applyPatch(
      cc.cliPath,
      map,
      cc.version,
      state.locale,
      state.variant,
    );

    console.log(chalk.green(`✅ Auto re-patched: ${result.applied} strings replaced.`));
  } catch (err) {
    console.error(chalk.red(`❌ Auto re-patch failed: ${(err as Error).message}`));
  }
}

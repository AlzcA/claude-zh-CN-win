import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createSpinner } from '../ui/spinner.js';

// Cross-platform wrapper paths
const isWindows = process.platform === 'win32';
const WRAPPER_DIR = isWindows
  ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'cc-i18n')
  : path.join(os.homedir(), '.local', 'bin');
const WRAPPER_PATH = isWindows
  ? path.join(WRAPPER_DIR, 'claude.bat')
  : path.join(WRAPPER_DIR, 'claude');

function getBashWrapperScript(): string {
  return `#!/bin/bash
# cc-i18n auto-repatch wrapper v2
# Installed by: cc-i18n install-wrapper
# Safe to remove: rm ~/.local/bin/claude

STATE_FILE="$HOME/.cc-i18n/state.json"

# 找真正的 claude（跳過自己）
SELF="$(realpath "$0" 2>/dev/null || readlink -f "$0")"
REAL_CLAUDE=""
while IFS= read -r p; do
  RESOLVED="$(realpath "$p" 2>/dev/null || readlink -f "$p" 2>/dev/null || echo "$p")"
  if [ "$RESOLVED" != "$SELF" ]; then
    REAL_CLAUDE="$p"
    break
  fi
done < <(which -a claude 2>/dev/null)

if [ -z "$REAL_CLAUDE" ]; then
  echo "❌ cc-i18n wrapper: 找不到 claude 本體" >&2
  exit 1
fi

# state.json 不存在 → 直接啟動
if [ ! -f "$STATE_FILE" ]; then
  exec "$REAL_CLAUDE" "$@"
fi

# 讀欄位（locale, cliMd5, cliPath）
LANG_CODE=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('locale',''))" 2>/dev/null || echo "")
SAVED_MD5=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('cliMd5',''))" 2>/dev/null || echo "")
CLI_PATH=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('cliPath',''))" 2>/dev/null || echo "")

# 缺資料 → 跳過
if [ -z "$LANG_CODE" ] || [ -z "$CLI_PATH" ] || [ -z "$SAVED_MD5" ]; then
  exec "$REAL_CLAUDE" "$@"
fi

[ ! -f "$CLI_PATH" ] && exec "$REAL_CLAUDE" "$@"

# 比對 MD5
CURRENT_MD5=$(md5 -q "$CLI_PATH" 2>/dev/null || md5sum "$CLI_PATH" 2>/dev/null | cut -d' ' -f1 || echo "")

if [ "$CURRENT_MD5" = "$SAVED_MD5" ]; then
  exec "$REAL_CLAUDE" "$@"
fi

# 不一致 → 自動 repatch
echo "🔄 CC 已更新，正在重新套用翻譯..." >&2
if command -v cc-i18n &>/dev/null; then
  if CC_I18N_AUTO=1 timeout 30 cc-i18n patch --lang "$LANG_CODE" >&2 2>&1; then
    echo "✅ 翻譯已恢復" >&2
  else
    echo "⚠️ 自動修復失敗，啟動英文版。稍後手動跑：cc-i18n patch --lang $LANG_CODE" >&2
  fi
else
  echo "⚠️ cc-i18n 未安裝，跳過修復" >&2
fi

exec "$REAL_CLAUDE" "$@"
`;
}

function getPowerShellWrapperScript(): string {
  return `@echo off
REM cc-i18n auto-repatch wrapper v2 (Windows)
REM Installed by: cc-i18n install-wrapper
REM Safe to remove: del "%USERPROFILE%\\AppData\\Local\\Programs\\cc-i18n\\claude.bat"

setlocal enabledelayedexpansion

set "STATE_FILE=%USERPROFILE%\\.cc-i18n\\state.json"

REM Find the real claude (skip ourselves)
set "SELF=%~f0"
set "REAL_CLAUDE="

for /f "delims=" %%p in ('where claude 2^>nul') do (
    set "RESOLVED=%%p"
    if not "!RESOLVED!"=="!SELF!" (
        set "REAL_CLAUDE=%%p"
        goto :found_claude
    )
)

:found_claude
if "%REAL_CLAUDE%"=="" (
    echo [ERROR] cc-i18n wrapper: cannot find claude 1>&2
    exit /b 1
)

REM If state.json doesn't exist, just run directly
if not exist "%STATE_FILE%" (
    "%REAL_CLAUDE%" %*
    exit /b %errorlevel%
)

REM Read fields from state.json using PowerShell
for /f "delims=" %%a in ('powershell -NoProfile -Command "(Get-Content '%STATE_FILE%' | ConvertFrom-Json).locale" 2^>nul') do set "LANG_CODE=%%a"
for /f "delims=" %%a in ('powershell -NoProfile -Command "(Get-Content '%STATE_FILE%' | ConvertFrom-Json).cliMd5" 2^>nul') do set "SAVED_MD5=%%a"
for /f "delims=" %%a in ('powershell -NoProfile -Command "(Get-Content '%STATE_FILE%' | ConvertFrom-Json).cliPath" 2^>nul') do set "CLI_PATH=%%a"

REM Missing data - skip
if "%LANG_CODE%"=="" goto run_direct
if "%CLI_PATH%"=="" goto run_direct
if "%SAVED_MD5%"=="" goto run_direct

if not exist "%CLI_PATH%" goto run_direct

REM Compare MD5
for /f "delims=" %%a in ('powershell -NoProfile -Command "(Get-FileHash '%CLI_PATH%' -Algorithm MD5).Hash"') do set "CURRENT_MD5=%%a"

if "%CURRENT_MD5%"=="%SAVED_MD5%" goto run_direct

REM Mismatch - auto repatch
echo [INFO] CC updated, re-applying translation... 1>&2
where cc-i18n >nul 2>&1
if %errorlevel% equ 0 (
    cmd /c "set CC_I18N_AUTO=1 && cc-i18n patch --lang %LANG_CODE%" 2>&1
    if %errorlevel% equ 0 (
        echo [OK] Translation restored 1>&2
    ) else (
        echo [WARN] Auto-repair failed, launching English version. Run manually: cc-i18n patch --lang %LANG_CODE% 1>&2
    )
) else (
    echo [WARN] cc-i18n not installed, skipping repair 1>&2
)

:run_direct
"%REAL_CLAUDE%" %*
exit /b %errorlevel%
`;
}

export async function installWrapperCommand(): Promise<void> {
  const spinner = createSpinner();
  const isWindows = process.platform === 'win32';

  try {
    // 1. Create directory
    const dirMessage = isWindows ? 'Creating wrapper directory...' : 'Creating ~/.local/bin/...';
    spinner.start(dirMessage);
    await fs.ensureDir(WRAPPER_DIR);
    spinner.succeed(isWindows ? 'Wrapper directory ready' : '~/.local/bin/ ready');

    // 2. Check for existing file
    if (await fs.pathExists(WRAPPER_PATH)) {
      const existing = await fs.readFile(WRAPPER_PATH, 'utf-8');
      if (existing.includes('cc-i18n wrapper')) {
        spinner.start('Updating existing wrapper...');
      } else {
        // Not our wrapper — don't overwrite
        const pathDisplay = isWindows ? WRAPPER_PATH : '~/.local/bin/claude';
        console.log(chalk.yellow(`\n  ${pathDisplay} already exists and is not a cc-i18n wrapper.`));
        console.log(chalk.yellow(`  To avoid breaking your setup, skipping installation.`));
        console.log(chalk.dim(`  Remove it manually first if you want to install the wrapper.`));
        return;
      }
    }

    // 3. Write wrapper
    spinner.start('Installing wrapper...');
    if (isWindows) {
      await fs.writeFile(WRAPPER_PATH, getPowerShellWrapperScript(), { encoding: 'utf-8' });
    } else {
      await fs.writeFile(WRAPPER_PATH, getBashWrapperScript(), { mode: 0o755 });
    }
    const successPath = isWindows ? WRAPPER_PATH : '~/.local/bin/claude';
    spinner.succeed(`Wrapper installed at ${successPath}`);

    // 4. Check PATH and provide instructions
    if (isWindows) {
      // For Windows, we need to add to PATH via System Properties
      const wrapperDirInPath = process.env.PATH?.includes(WRAPPER_DIR);
      if (!wrapperDirInPath) {
        console.log();
        console.log(chalk.yellow('  The wrapper directory is not in your PATH. Add it:'));
        console.log();
        console.log(chalk.cyan(`    [System Environment Variables]`));
        console.log(chalk.cyan(`    Add to PATH: %USERPROFILE%\\AppData\\Local\\Programs\\cc-i18n`));
        console.log();
        console.log(chalk.dim('  Or run PowerShell as Admin and:'));
        console.log(chalk.cyan(`    [Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";%USERPROFILE%\\AppData\\Local\\Programs\\cc-i18n", "User")`));
        console.log();
      }

      // Also create a claude.cmd wrapper that calls the bat file
      const cmdPath = path.join(WRAPPER_DIR, 'claude.cmd');
      await fs.writeFile(cmdPath, `@echo off\n"%~dp0claude.bat" %*\n`, { encoding: 'utf-8' });

      console.log();
      console.log(chalk.green('\n  Wrapper is active. Claude Code will auto re-patch after updates.'));
      console.log(chalk.dim('\n  To remove: del "%USERPROFILE%\\AppData\\Local\\Programs\\cc-i18n\\claude.bat"'));
    } else {
      // Unix - check PATH
      const pathDirs = (process.env.PATH || '').split(':');
      const inPath = pathDirs.some(d => {
        try {
          return fs.realpathSync(d) === fs.realpathSync(WRAPPER_DIR);
        } catch {
          return d === WRAPPER_DIR;
        }
      });

      if (!inPath) {
        console.log();
        console.log(chalk.yellow('  ~/.local/bin is not in your PATH. Add it:'));
        console.log();
        console.log(chalk.cyan(`    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`));
        console.log(chalk.cyan(`    source ~/.zshrc`));
        console.log();
      }

      // 5. Verify
      try {
        const which = execSync('which claude', { encoding: 'utf-8' }).trim();
        const realWhich = fs.realpathSync(which);
        const realWrapper = fs.realpathSync(WRAPPER_PATH);

        if (realWhich === realWrapper) {
          console.log(chalk.green('\n  Wrapper is active. Claude Code will auto re-patch after updates.'));
        } else {
          console.log(chalk.yellow(`\n  Note: 'which claude' resolves to ${which}`));
          console.log(chalk.yellow(`  The wrapper at ~/.local/bin/claude needs to come first in PATH.`));
          console.log(chalk.dim(`  Ensure ~/.local/bin is before other paths in your PATH.`));
        }
      } catch {
        console.log(chalk.dim('\n  Could not verify wrapper activation. Make sure ~/.local/bin is in PATH.'));
      }

      console.log();
      console.log(chalk.dim('  To remove: rm ~/.local/bin/claude'));
    }

  } catch (err) {
    spinner.fail(`Install failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

import { getCliMd5 } from './backup.js';
import { loadState } from './patcher.js';

export interface UpdateCheckResult {
  updated: boolean;
  currentMd5: string;
  patchedMd5: string | null;
  locale: string | null;
}

/**
 * Check if cli.js has been modified since last patch (i.e., CC updated).
 * Compares current MD5 with the MD5 recorded at patch time.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const state = await loadState();

  if (!state) {
    return { updated: false, currentMd5: '', patchedMd5: null, locale: null };
  }

  let currentMd5: string;
  try {
    currentMd5 = getCliMd5(state.cliPath);
  } catch {
    return { updated: false, currentMd5: '', patchedMd5: state.cliMd5, locale: state.locale };
  }

  return {
    updated: currentMd5 !== state.cliMd5,
    currentMd5,
    patchedMd5: state.cliMd5,
    locale: state.locale,
  };
}

/**
 * Generate shell hook snippet for auto-repatch on CC update.
 * User adds this to their .zshrc / .bashrc (Unix) or PowerShell profile (Windows).
 */
export function generateShellHook(): string {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    return `# cc-i18n: auto re-patch after Claude Code updates (PowerShell)
# Add to your PowerShell profile: notepad $PROFILE
# Then paste this function and call cc-i18n-check in your profile

function cc-i18n-check {
  if (Get-Command cc-i18n -ErrorAction SilentlyContinue) {
    cc-i18n check-update --quiet 2>$null
  }
}

# Run check when PowerShell starts
cc-i18n-check
`;
  } else {
    return `# cc-i18n: auto re-patch after Claude Code updates
cc-i18n-check() {
  if command -v cc-i18n &>/dev/null; then
    cc-i18n check-update --quiet 2>/dev/null
  fi
}

# Run check when opening a new shell
cc-i18n-check
`;
  }
}

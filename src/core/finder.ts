import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

/**
 * Cross-platform command to find executable in PATH.
 * Uses `where` on Windows, `which` on Unix.
 */
function findInPath(command: string): string | null {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`where ${command}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (!result) return null;
      // `where` can return multiple lines, take the first one
      return result.split('\n')[0].trim();
    } else {
      const result = execSync(`which ${command}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      return result || null;
    }
  } catch {
    return null;
  }
}

/**
 * Get all available drive letters on Windows.
 */
function getWindowsDriveLetters(): string[] {
  const drives: string[] = [];
  try {
    // Use wmic to get drive letters
    const result = execSync('wmic logicaldisk get name', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = result.split('\n').filter(line => line.trim().match(/^[A-Z]:$/i));
    for (const line of lines) {
      const drive = line.trim().toUpperCase();
      if (drive.match(/^[A-Z]:$/)) {
        drives.push(drive);
      }
    }
  } catch {
    // Fallback to common drives
  }

  // Always include C: as fallback
  if (!drives.includes('C:')) {
    drives.push('C:');
  }

  return drives;
}

export interface ClaudeCodeInfo {
  cliPath: string;
  packageDir: string;
  version: string;
}

/**
 * Find Claude Code's cli.js by following the `claude` binary symlink.
 * Also enhanced to detect Windows installations from various sources.
 */
function findViaBinary(): string | null {
  const whichResult = findInPath('claude');
  if (!whichResult) return null;

  try {
    // Follow symlink to find the real path
    const realPath = fs.realpathSync(whichResult);

    // cli.js might be the target itself, or in the same directory
    if (realPath.endsWith('cli.js') && fs.existsSync(realPath)) {
      return realPath;
    }

    // The binary might be a wrapper — check sibling cli.js
    const dir = path.dirname(realPath);
    const cliPath = path.join(dir, 'cli.js');
    if (fs.existsSync(cliPath)) {
      return cliPath;
    }

    // Walk up to find @anthropic-ai/claude-code/cli.js
    let current = dir;
    while (current !== path.dirname(current)) {
      // Check for cli.js directly in this directory
      const candidate = path.join(current, 'cli.js');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      // Also check node_modules/@anthropic-ai/claude-code/cli.js pattern
      const nodeModulesCandidate = path.join(current, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(nodeModulesCandidate)) {
        return nodeModulesCandidate;
      }
      // Check for app.asar unpacked (Electron apps)
      const asarCandidate = path.join(current, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(asarCandidate)) {
        return asarCandidate;
      }
      current = path.dirname(current);
    }

    // Windows: If it's a .cmd or .bat wrapper, try to find the target
    if (process.platform === 'win32' && (whichResult.endsWith('.cmd') || whichResult.endsWith('.bat'))) {
      try {
        const content = fs.readFileSync(whichResult, 'utf-8');
        // Look for paths in the batch file
        const pathMatches = content.match(/"[^"]*claude-code[^"]*"/gi) || [];
        for (const match of pathMatches) {
          const extractedPath = match.replace(/"/g, '');
          if (fs.existsSync(extractedPath)) {
            return extractedPath;
          }
        }
      } catch {
        // Failed to read batch file
      }
    }
  } catch {
    // realpath failed — return the original path, might be the cli.js
    if (whichResult.endsWith('cli.js') && fs.existsSync(whichResult)) {
      return whichResult;
    }
  }
  return null;
}

/**
 * Find via npm global root.
 */
function findViaNpmGlobal(): string | null {
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const cliPath = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js');
    if (fs.existsSync(cliPath)) {
      return cliPath;
    }

    // Windows: also check in npm cache location
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const altPath = path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(altPath)) {
        return altPath;
      }
    }
  } catch {
    // npm not available
  }
  return null;
}

/**
 * Find in Volta tool directories.
 */
function findViaVolta(): string | null {
  const voltaHome = process.env.VOLTA_HOME || path.join(os.homedir(), '.volta');
  const nodeImagesDir = path.join(voltaHome, 'tools', 'image', 'node');

  if (!fs.existsSync(nodeImagesDir)) return null;

  try {
    const versions = fs.readdirSync(nodeImagesDir);
    for (const ver of versions.reverse()) {
      const cliPath = path.join(
        nodeImagesDir, ver, 'lib', 'node_modules',
        '@anthropic-ai', 'claude-code', 'cli.js'
      );
      if (fs.existsSync(cliPath)) {
        return cliPath;
      }
    }
  } catch {
    // volta dir not readable
  }
  return null;
}

/**
 * Scan common global node_modules paths.
 * Enhanced for Windows to support all installation methods.
 */
function findViaCommonPaths(): string | null {
  const home = os.homedir();
  const candidates: string[] = [];

  // macOS / Linux common paths
  candidates.push(
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
  );

  // nvm (Unix)
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
  if (fs.existsSync(nvmDir)) {
    const versionsDir = path.join(nvmDir, 'versions', 'node');
    try {
      const versions = fs.readdirSync(versionsDir);
      for (const ver of versions.reverse()) {
        candidates.push(
          path.join(versionsDir, ver, 'lib', 'node_modules',
            '@anthropic-ai', 'claude-code', 'cli.js')
        );
      }
    } catch {
      // nvm versions dir not readable
    }
  }

  // Windows: common installation paths (scan all drives)
  if (process.platform === 'win32') {
    const drives = getWindowsDriveLetters();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const username = os.userInfo().username;

    // Per-drive paths (npm/pnpm/yarn global, scoop, volta, etc.)
    for (const drive of drives) {
      const driveHome = drive + '\\Users\\' + username;

      candidates.push(
        // npm global on this drive
        path.join(drive, 'Program Files', 'nodejs', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // User's AppData (Roaming)
        path.join(driveHome, 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // pnpm global
        path.join(driveHome, 'AppData', 'Roaming', 'pnpm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // Yarn global
        path.join(driveHome, 'AppData', 'Roaming', 'Yarn', 'Data', 'global', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // Scoop
        path.join(driveHome, 'scoop', 'apps', 'claude-code', 'current', 'cli.js'),
        path.join(driveHome, 'scoop', 'apps', 'claude-code', 'current', 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // nvm-windows
        path.join(driveHome, 'AppData', 'Roaming', 'nvm', 'versions', 'node'),
        // Volta
        path.join(driveHome, '.volta', 'tools', 'image', 'node'),
        // Official PowerShell installer locations
        path.join(driveHome, '.claude', 'cli.js'),
        path.join(driveHome, '.claude', 'local', 'cli.js'),
        path.join(driveHome, '.claude', 'bin', 'cli.js'),
        path.join(driveHome, 'AppData', 'Local', 'Programs', 'Claude Code', 'cli.js'),
        path.join(driveHome, 'AppData', 'Local', 'Programs', 'claude-code', 'cli.js'),
      );
    }

    // Fixed paths (Program Files, etc.)
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    candidates.push(
      // npm global
      path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // pnpm global
      path.join(appData, 'pnpm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // yarn global
      path.join(appData, 'Yarn', 'Data', 'global', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // Chocolatey
      path.join(programFiles, 'Claude Code', 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(programFilesX86, 'Claude Code', 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(programFiles, 'ClaudeCode', 'cli.js'),
      path.join(programFilesX86, 'ClaudeCode', 'cli.js'),
      // Direct install in AppData
      path.join(localAppData, 'Programs', 'claude-code', 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(localAppData, 'Programs', 'Claude Code', 'cli.js'),
      // Winget default install location
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'ClaudeCode', 'cli.js'),
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'claude', 'cli.js'),
      // WindowsApps (symlink)
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'ClaudeCode_exe', 'cli.js'),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Read version from Claude Code's package.json.
 */
function readVersion(packageDir: string): string {
  try {
    const pkgPath = path.join(packageDir, 'package.json');
    const pkg = fs.readJsonSync(pkgPath);
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Find Claude Code installation path from Windows Registry.
 * Checks both HKLM (system-wide) and HKCU (user-specific) installations.
 */
function findViaWindowsRegistry(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    // Try to query registry for Claude Code installation path
    // Check HKLM (system-wide installs)
    const registryCommands = [
      // Official installer / winget
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Anthropic\\ClaudeCode" /v InstallPath /reg:32',
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Anthropic\\ClaudeCode" /v InstallPath /reg:64',
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Anthropic\\ClaudeCode" /v InstallPath',
      // Chocolatey
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\ClaudeCode" /v InstallPath',
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\ClaudeCode" /v InstallPath',
      // User-specific installs (HKCU)
      'reg query "HKEY_CURRENT_USER\\SOFTWARE\\Anthropic\\ClaudeCode" /v InstallPath',
      'reg query "HKEY_CURRENT_USER\\SOFTWARE\\ClaudeCode" /v InstallPath',
      // Uninstall registry keys (often contain install path)
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ClaudeCode" /v InstallLocation',
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ClaudeCode" /v InstallLocation',
      'reg query "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ClaudeCode" /v InstallLocation',
    ];

    for (const cmd of registryCommands) {
      try {
        const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        // Parse registry output to extract path
        const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i) ||
                     result.match(/InstallLocation\s+REG_SZ\s+(.+)/i) ||
                     result.match(/InstallPath\s+REG_EXPAND_SZ\s+(.+)/i);
        if (match && match[1]) {
          const installPath = match[1].trim();
          // Try various cli.js locations under the install path
          const candidates = [
            path.join(installPath, 'cli.js'),
            path.join(installPath, 'resources', 'app', 'cli.js'),
            path.join(installPath, 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
            path.join(installPath, 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
          ];
          for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
        }
      } catch {
        // Registry key doesn't exist or command failed
        continue;
      }
    }
  } catch {
    // Registry query failed
  }

  return null;
}

/**
 * Find via native installer paths (~/.claude/).
 * CC is migrating from npm to a native installer that may place cli.js here.
 * Also supports Windows installations from:
 * - Official PowerShell script (irm https://claude.ai/install.ps1 | iex)
 * - Winget (winget install Anthropic.ClaudeCode)
 * - Scoop (scoop install claude-code)
 * - Chocolatey (choco install claude-code)
 * - Native .exe installer
 * - Portable versions
 */
function findViaNativeInstaller(): string | null {
  const home = os.homedir();

  // First check: direct path using os.homedir() (handles all user directory names)
  const directPath = path.join(home, '.claude', 'cli.js');
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const candidates: string[] = [
    // Unix common paths
    path.join(home, '.claude', 'local', 'cli.js'),
    path.join(home, '.claude', 'bin', 'cli.js'),
    path.join(home, '.claude', 'lib', 'cli.js'),
    // macOS native app support
    '/Applications/Claude Code.app/Contents/Resources/cli.js',
    path.join(home, 'Library', 'Application Support', 'claude-code', 'cli.js'),
    // Linux native paths
    path.join(home, '.local', 'share', 'claude-code', 'cli.js'),
    '/opt/claude-code/cli.js',
  ];

  // Windows native installer paths (scan all drives)
  if (process.platform === 'win32') {
    const drives = getWindowsDriveLetters();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const username = os.userInfo().username;

    // Per-drive paths (~/.claude, Documents, etc.)
    for (const drive of drives) {
      const driveHome = drive + '\\Users\\' + username;
      const driveAppData = drive + '\\Users\\' + username + '\\AppData\\Roaming';
      const driveLocalAppData = drive + '\\Users\\' + username + '\\AppData\\Local';

      candidates.push(
        // Official PowerShell installer (irm https://claude.ai/install.ps1 | iex)
        path.join(driveHome, '.claude', 'cli.js'),
        path.join(driveHome, '.claude', 'local', 'cli.js'),
        path.join(driveHome, '.claude', 'bin', 'cli.js'),
        path.join(driveLocalAppData, 'Programs', 'Claude Code', 'cli.js'),
        path.join(driveLocalAppData, 'Programs', 'claude-code', 'cli.js'),
        // Claude Code native Windows installer
        path.join(driveAppData, 'Claude', 'cli.js'),
        path.join(driveLocalAppData, 'Claude', 'cli.js'),
        // Portable version in Documents
        path.join(driveHome, 'Documents', 'Claude Code', 'cli.js'),
        path.join(driveHome, 'Documents', 'claude-code', 'cli.js'),
        // Downloads (common for portable versions)
        path.join(driveHome, 'Downloads', 'Claude Code', 'cli.js'),
        path.join(driveHome, 'Downloads', 'claude-code', 'cli.js'),
      );
    }

    // Fixed paths (Program Files, etc.)
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    candidates.push(
      // Official installer locations (winget, .exe)
      path.join(programFiles, 'Claude Code', 'resources', 'app', 'dist', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(programFilesX86, 'Claude Code', 'resources', 'app', 'dist', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // Newer versions (electron-builder)
      path.join(programFiles, 'Claude Code', 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(programFilesX86, 'Claude Code', 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // Direct cli.js in Program Files
      path.join(programFiles, 'Claude Code', 'cli.js'),
      path.join(programFilesX86, 'Claude Code', 'cli.js'),
      // Scoop installation
      path.join(home, 'scoop', 'apps', 'claude-code', 'current', 'cli.js'),
      path.join(home, 'scoop', 'apps', 'claude-code', 'current', 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // WindowsApps (winget)
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'ClaudeCode', 'cli.js'),
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'claude', 'cli.js'),
      // AppData paths
      path.join(appData, 'Claude', 'cli.js'),
      path.join(localAppData, 'Claude', 'cli.js'),
      path.join(home, '.claude', 'cli.js'),
      // Chocolatey
      path.join(programFiles, 'ClaudeCode', 'cli.js'),
      path.join(programFilesX86, 'ClaudeCode', 'cli.js'),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Additional check: try to find from Windows registry (Windows only)
  if (process.platform === 'win32') {
    return findViaWindowsRegistry();
  }

  return null;
}

/**
 * Find Claude Code's cli.js installation path.
 *
 * Search order (optimized for Windows):
 * 1. Custom path from --claude-path option (if provided)
 * 2. `which claude` → follow symlink (works for all installation methods)
 * 3. Native installer paths (includes PowerShell installer: irm https://claude.ai/install.ps1 | iex)
 * 4. Windows Registry (for .exe/winget/Chocolatey installs)
 * 5. `npm root -g` → @anthropic-ai/claude-code/cli.js (npm/pnpm/yarn installs)
 * 6. ~/.volta/ scan (Volta tool manager)
 * 7. Common global node_modules paths (fallback)
 *
 * @param customPath - Optional custom path from --claude-path option
 * @throws Error with installation instructions if not found
 */
export async function findClaudeCodeCli(customPath?: string): Promise<ClaudeCodeInfo> {
  // 1. Check custom path first (if provided)
  if (customPath) {
    const cliPath = customPath.endsWith('cli.js') ? customPath : path.join(customPath, 'cli.js');
    if (fs.existsSync(cliPath)) {
      const packageDir = path.dirname(cliPath);
      const version = readVersion(packageDir);
      return { cliPath, packageDir, version };
    }
    throw new Error(`Custom path not found: ${cliPath}`);
  }

  const strategies = [
    findViaBinary,           // Highest priority: works for all methods if claude is in PATH
    findViaNativeInstaller,  // PowerShell installer, winget, scoop, etc.
    findViaNpmGlobal,        // npm/pnpm/yarn global installs
    findViaVolta,            // Volta tool manager
    findViaCommonPaths,      // Fallback: scan common paths
  ];

  for (const strategy of strategies) {
    const cliPath = strategy();
    if (cliPath) {
      const packageDir = path.dirname(cliPath);
      const version = readVersion(packageDir);
      return { cliPath, packageDir, version };
    }
  }

  const installInstructions = process.platform === 'win32'
    ? 'Could not find Claude Code installation. Supported installation methods:\n\n' +
      '【推荐】官方 PowerShell 安装器 (自动更新，适配 Windows):\n' +
      '  irm https://claude.ai/install.ps1 | iex\n\n' +
      '其他安装方式:\n' +
      '  • Winget:        winget install Anthropic.ClaudeCode\n' +
      '  • npm 全局:      npm install -g @anthropic-ai/claude-code\n' +
      '  • Scoop:         scoop install claude-code\n' +
      '  • Chocolatey:    choco install claude-code\n' +
      '  • 下载安装器:    https://claude.ai/download\n\n' +
      '安装完成后请重新运行: cc-i18n patch --lang zh-CN'
    : 'Could not find Claude Code installation.\n\n' +
      'Make sure Claude Code is installed:\n' +
      '  npm install -g @anthropic-ai/claude-code\n\n' +
      'If installed via Volta:\n' +
      '  volta install @anthropic-ai/claude-code\n\n' +
      'Or download the native installer from:\n' +
      '  https://claude.ai/download\n\n' +
      'Then try again: cc-i18n patch --lang zh-CN';

  throw new Error(installInstructions);
}

/**
 * Get all possible Claude Code installation paths for the current platform.
 */
export function getSearchPaths(): string[] {
  const paths: string[] = [];
  const home = os.homedir();

  // Find via PATH
  const whichResult = findInPath('claude');
  if (whichResult) paths.push(whichResult);

  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    paths.push(path.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js'));
  } catch { /* npm not available */ }

  // Common paths
  const commonPaths = [
    // Native installer paths
    path.join(home, '.claude', 'local', 'cli.js'),
    path.join(home, '.claude', 'bin', 'cli.js'),
    path.join(home, '.claude', 'lib', 'cli.js'),
    // npm global paths (Unix)
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    path.join(home, '.volta', 'tools', 'image', 'node'),
  ];

  // Windows-specific paths
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';

    commonPaths.push(
      path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(appData, 'Claude', 'cli.js'),
      path.join(localAppData, 'Claude', 'cli.js'),
      path.join(programFiles, 'Claude Code', 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    );
  }

  paths.push(...commonPaths);
  return paths;
}

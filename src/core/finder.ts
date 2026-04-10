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
      current = path.dirname(current);
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

    // Per-drive paths (npm/pnpm/yarn global, scoop, etc.)
    for (const drive of drives) {
      const driveHome = drive + '\\Users\\' + os.userInfo().username;

      candidates.push(
        // npm global on this drive
        path.join(drive, 'Program Files', 'nodejs', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // User's AppData (Roaming)
        path.join(driveHome, 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // pnpm global
        path.join(driveHome, 'AppData', 'Roaming', 'pnpm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        // Scoop
        path.join(driveHome, 'scoop', 'apps', 'claude-code', 'current'),
        // nvm-windows
        path.join(driveHome, 'AppData', 'Roaming', 'nvm', 'versions', 'node'),
        // Volta
        path.join(driveHome, '.volta', 'tools', 'image', 'node'),
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
      // Direct install in AppData
      path.join(localAppData, 'Programs', 'claude-code', 'resources', 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // Winget default install location
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'claude', 'cli.js'),
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
 * Find via native installer paths (~/.claude/).
 * CC is migrating from npm to a native installer that may place cli.js here.
 */
function findViaNativeInstaller(): string | null {
  const home = os.homedir();
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

    // Per-drive paths (~/.claude, Documents, etc.)
    for (const drive of drives) {
      const driveHome = drive + '\\Users\\' + os.userInfo().username;
      const driveAppData = drive + '\\Users\\' + os.userInfo().username + '\\AppData\\Roaming';
      const driveLocalAppData = drive + '\\Users\\' + os.userInfo().username + '\\AppData\\Local';

      candidates.push(
        // Claude Code native Windows installer
        path.join(driveAppData, 'Claude', 'cli.js'),
        path.join(driveLocalAppData, 'Claude', 'cli.js'),
        path.join(driveHome, '.claude', 'cli.js'),
        // Portable version in Documents
        path.join(driveHome, 'Documents', 'Claude Code', 'cli.js'),
      );
    }

    // Fixed paths (Program Files, etc.)
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    candidates.push(
      // Official installer locations
      path.join(programFiles, 'Claude Code', 'resources', 'app', 'dist', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(programFilesX86, 'Claude Code', 'resources', 'app', 'dist', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // Newer versions (electron-builder)
      path.join(programFiles, 'Claude Code', 'resources', 'app.asar', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      // AppData paths
      path.join(appData, 'Claude', 'cli.js'),
      path.join(localAppData, 'Claude', 'cli.js'),
      path.join(home, '.claude', 'cli.js'),
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
 * Find Claude Code's cli.js installation path.
 *
 * Search order:
 * 1. `which claude` → follow symlink
 * 2. Native installer paths (~/.claude/)
 * 3. `npm root -g` → @anthropic-ai/claude-code/cli.js
 * 4. ~/.volta/ scan
 * 5. Common global node_modules paths
 *
 * @throws Error with installation instructions if not found
 */
export async function findClaudeCodeCli(): Promise<ClaudeCodeInfo> {
  const strategies = [
    findViaBinary,
    findViaNativeInstaller,
    findViaNpmGlobal,
    findViaVolta,
    findViaCommonPaths,
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
    ? 'Make sure Claude Code is installed:\n' +
      '  npm install -g @anthropic-ai/claude-code\n' +
      '  # OR via winget:\n' +
      '  winget install Anthropic.ClaudeCode\n' +
      '  # OR via scoop:\n' +
      '  scoop install claude-code'
    : 'Make sure Claude Code is installed globally:\n' +
      '  npm install -g @anthropic-ai/claude-code\n\n' +
      'If installed via Volta:\n' +
      '  volta install @anthropic-ai/claude-code';

  throw new Error(
    'Could not find Claude Code installation.\n\n' +
    installInstructions + '\n\n' +
    'Then try again: cc-i18n patch --lang zh-CN'
  );
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

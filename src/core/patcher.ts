import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createBackup, restoreBackup, hasValidBackup, removeBackup } from './backup.js';
import { getCliMd5 } from './backup.js';
import type { TranslationSchema } from '../translations/schema.js';

// State directory (cross-platform, same location on all platforms)
const STATE_DIR = path.join(os.homedir(), '.cc-i18n');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/**
 * Strings that must NEVER be translated.
 * These English originals appear in non-UI contexts (HTTP headers, protocol
 * constants, enum values, platform commands, internal identifiers) where
 * non-ASCII characters cause runtime crashes ("key must be ascii string").
 *
 * Stability > coverage. Better to leave a UI string in English
 * than to crash Claude Code by translating a protocol string.
 */
const UNSAFE_STRINGS: ReadonlySet<string> = new Set([
  // ── Truly dangerous: confirmed non-UI occurrences ──
  'Accept',           // HTTP Accept header (9 occ, 7 in headers)
  'Default',          // Cookie SameSite, TLS config, file paths (11 occ)
  'Bypass',           // PowerShell -ExecutionPolicy Bypass
  'Allow',            // HTTP Access-Control-Allow-Origin header
  'Deny',             // AWS SDK DENY constant
  'Ask',              // Wolfram Language function name list
  'Auto',             // Yoga layout engine enum value
  'Plan',             // Internal agentType identifier

  // ── Conservative exclusions: scanner-flagged, kept for stability ──
  'Add Marketplace',
  'Install GitHub App',
  'Remote Control failed',
  'Location: ',       // HTTP Location header context
  'Source: ',         // Mixed UI/protocol context
  'Running ',         // Near shell exec context
]);

/**
 * Strings that should always be replaced via replaceAll, even when
 * they appear multiple times. These are confirmed UI-only strings
 * that contextAwareReplace might miss because they sit in data arrays
 * (no createElement/label context nearby).
 */
const WHITELIST_STRINGS: ReadonlySet<string> = new Set([
  // try_suggestions — in plain data arrays, no createElement context
  'fix lint errors',
  'fix typecheck errors',
  'how do I log an error?',
  'create a util logging.py that...',
  // spinner words with >1 occurrence (also appear in status contexts)
  'Processing',
  'Working',
  'Creating',
]);

/**
 * Map locale to the language directive injected into every system prompt.
 * This makes the model respond in the user's chosen language.
 */
const LOCALE_DIRECTIVES: Record<string, string> = {
  'zh-TW': 'You MUST always respond in 繁體中文 (Traditional Chinese). All your text output, explanations, questions, and comments must be in 繁體中文. Never switch to English unless the user explicitly asks for English or you are writing code/commands.',
  'zh-CN': 'You MUST always respond in 简体中文 (Simplified Chinese). All your text output, explanations, questions, and comments must be in 简体中文. Never switch to English unless the user explicitly asks for English or you are writing code/commands.',
};

function getLanguageDirective(locale: string): string | null {
  const baseLang = locale.replace(/-technical$/, '');
  return LOCALE_DIRECTIVES[baseLang] ?? null;
}

export interface PatchState {
  locale: string;
  variant: string | null;
  ccVersion: string;
  patchDate: string;
  cliPath: string;
  cliMd5: string;
  originalMd5: string;
  replacements: number;
  missed: number;
  missedKeys: string[];
  unsafeSkipped?: number;
  contextSkipped?: number;
}

export interface PatchResult {
  applied: number;
  missed: string[];
  skipped: string[];
  contextSkipped: number;
  total: number;
}

/**
 * Count how many times `search` appears in `source`.
 */
function countOccurrences(source: string, search: string): number {
  let count = 0;
  let idx = source.indexOf(search);
  while (idx !== -1) {
    count++;
    idx = source.indexOf(search, idx + search.length);
  }
  return count;
}

/**
 * Check if a match position is within a UI rendering context.
 * Used for multi-occurrence strings to avoid replacing protocol/data strings.
 */
function isUIContext(source: string, matchIndex: number): boolean {
  const LOOKBACK = 300;
  const start = Math.max(0, matchIndex - LOOKBACK);
  const before = source.substring(start, matchIndex);

  // createElement within 300 chars = React UI rendering
  if (before.includes('createElement')) return true;

  // UI property immediately before: label:"X", title:"X", etc.
  if (/(?:label|title|shortTitle|description|message|placeholder|subtitle|question|footerText|welcomeMessage|leaderIdleText|guidance|notice):\s*$/.test(before)) return true;

  // Nullish coalescing fallback (display default value)
  if (/\?\?\s*$/.test(before)) return true;

  // Bold/dim/color UI rendering props in close proximity
  if (/(?:dimColor|bold|italic|color)\s*[:=]/.test(before.slice(-100))) return true;

  // Array of display strings (contains spaces, !, ?, or ellipsis = likely UI text)
  const arrayMatch = before.slice(-300).match(/\[\s*((?:"[^"]*"\s*,?\s*)+)$/);
  if (arrayMatch && /[!?\u2026\s]/.test(arrayMatch[1])) return true;

  // Ternary else branch: ?"otherString":"THIS" (display-conditional)
  if (/"\s*:\s*$/.test(before.slice(-20))) return true;

  // Ternary then branch: condition?"THIS"
  if (/\?\s*$/.test(before.slice(-5))) return true;

  // Variable assignment to display string: w="THIS" or V6='THIS'
  if (/[a-zA-Z0-9_$]\s*=\s*$/.test(before.slice(-20))) {
    // Only if it looks like a short variable (UI state), not a long property path
    const assignMatch = before.slice(-30).match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*$/);
    if (assignMatch && assignMatch[1].length <= 6) return true;
  }

  // Array literal start: ["text" — only with display-like context further back
  if (/\[\s*$/.test(before.slice(-5))) {
    const farBefore = before.slice(-500);
    if (/(?:createElement|label|title|description|message)/.test(farBefore)) return true;
  }

  return false;
}

/**
 * Context-aware replacement: only replaces within recognized UI contexts.
 * For multi-occurrence strings where blind replaceAll could hit protocol code.
 */
function contextAwareReplace(
  source: string,
  search: string,
  replace: string,
): { result: string; count: number; skipped: number } {
  let result = '';
  let lastEnd = 0;
  let count = 0;
  let skipped = 0;
  let idx = source.indexOf(search);

  while (idx !== -1) {
    if (isUIContext(source, idx)) {
      result += source.substring(lastEnd, idx) + replace;
      count++;
    } else {
      result += source.substring(lastEnd, idx) + search;
      skipped++;
    }
    lastEnd = idx + search.length;
    idx = source.indexOf(search, lastEnd);
  }

  result += source.substring(lastEnd);
  return { result, count, skipped };
}

/**
 * Replace all occurrences of a string (not regex-based, safe for special chars).
 */
function replaceAll(source: string, search: string, replace: string): string {
  let result = source;
  let idx = result.indexOf(search);
  while (idx !== -1) {
    result = result.substring(0, idx) + replace + result.substring(idx + search.length);
    idx = result.indexOf(search, idx + replace.length);
  }
  return result;
}

/**
 * Locale-specific post-patch replacements for strings that can't be handled
 * by the translation map (apostrophe-split strings, template literals, symbols).
 */
interface PostPatchRule {
  search: string;
  replace: string;
  /** If true, search is a regex pattern. replace can use $1, $2, etc.
   *  Makes rules resilient to minified variable name changes across CC versions. */
  regex?: boolean;
}

function getPostPatchRules(locale: string): PostPatchRule[] {
  const baseLang = locale.replace(/-technical$/, '');

  if (baseLang === 'zh-TW') {
    return [
      // ── Safety page: apostrophe-split "what's in this folder" ──
      {
        search: '"Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what","\'","s in this folder first."',
        replace: '"快速安全檢查：這是你建立或信任的專案嗎？（例如你自己的程式碼、知名開源專案、或團隊的工作）如果不是，請先看一下這個資料夾的內容。"',
      },
      // ── Safety page: apostrophe-split "Claude Code'll be able to" ──
      {
        search: '"Claude Code","\'","ll be able to read, edit, and execute files here."',
        replace: '"Claude Code 將可以讀取、編輯和執行這裡的檔案。"',
      },
      // ── Try prefix in template literal ──
      {
        search: 'return`Try "(\$\{\w+\(\w+\)\})"`',
        replace: 'return`試試看 "$1"`',
        regex: true,
      },
      // ── Spinner: ✻ symbol → ☯ ──
      {
        search: 'te="✻"',
        replace: 'te="☯"',
      },
      // ── Spinner frames: replace with taichi breathing sequence ──
      {
        search: '["·","✢","✳","✶","✻","✽"]',
        replace: '[" ","·","∘","○","☯","○","∘","·"]',
      },
      {
        search: '["·","✢","✳","✶","✻","*"]',
        replace: '[" ","·","∘","○","☯","○","∘","·"]',
      },
      {
        search: '["·","✢","*","✶","✻","✽"]',
        replace: '[" ","·","∘","○","☯","○","∘","·"]',
      },
      // ── ✻ icon in UI strings → ☯ ──
      {
        search: '"✻ "',
        replace: '"☯ "',
      },
      {
        search: '"[✻] [✻] [✻]"',
        replace: '"[☯] [☯] [☯]"',
      },
      {
        search: '"[✻]"',
        replace: '"[☯]"',
      },
      {
        search: '"✻"',
        replace: '"☯"',
      },
      // ── Remaining ✻ in compound strings ──
      {
        search: '"✻ Conversation compacted ("',
        replace: '"☯ 對話已壓縮（"',
      },
      {
        search: '" ✻"',
        replace: '" ☯"',
      },
      {
        search: '" ) CC ✻ ┊╱"',
        replace: '" ) CC ☯ ┊╱"',
      },
      {
        search: '`✻ [Claude Code]',
        replace: '`☯ [Claude Code]',
      },
      // ── Image in clipboard: template literal ──
      {
        search: '`Image in clipboard \· (\$\{\w+\("chat:imagePaste","Chat","ctrl\+v"\)\}) to paste`',
        replace: '`剪貼簿有圖片 · $1 貼上`',
        regex: true,
      },
      // ── Searching for: template literal ──
      {
        search: '`Searching for (\$\{\w+\})`',
        replace: '`搜尋 $1`',
        regex: true,
      },
      // ── (VAR to expand): template literal ──
      {
        search: '`\\((\\$\\{\\w+\\}) to expand\\)`',
        replace: '`($1 展開)`',
        regex: true,
      },
      // ── Thinking (VAR to expand): template literal ──
      {
        search: '`\\$\\{"∴ Thinking"\\} \\((\\$\\{\\w+\\}) to expand\\)`',
        replace: '`${"∴ 思考中"} ($1 展開)`',
        regex: true,
      },
      // ── Effort level descriptions (HC3 function) ──
      {
        search: 'case"low":return"Quick, straightforward implementation with minimal overhead"',
        replace: 'case"low":return"low（低）— 快速直接，最少開銷"',
      },
      {
        search: 'case"medium":return"Balanced approach with standard implementation and testing"',
        replace: 'case"medium":return"medium（中等）— 均衡的實作與測試"',
      },
      {
        search: 'case"high":return"Comprehensive implementation with extensive testing and documentation"',
        replace: 'case"high":return"high（高）— 完整實作、全面測試與文件"',
      },
      {
        search: 'case"max":return"Maximum capability with deepest reasoning (Opus 4.6 only)"',
        replace: 'case"max":return"max（最高）— 最深度推理（僅 Opus 4.6）"',
      },
      {
        search: 'return"Balanced approach with standard implementation and testing"',
        replace: 'return"medium（中等）— 均衡的實作與測試"',
      },
      // ── Reading/Writing template literals ──
      {
        search: '`Reading (\$\{\w+\})`',
        replace: '`讀取 $1`',
        regex: true,
      },
      {
        search: '`Writing (\$\{\w+\})`',
        replace: '`寫入 $1`',
        regex: true,
      },
      // ── "to expand" in createElement (variable keybinding) ──
      {
        search: '," to expand)"',
        replace: '," 展開)"',
      },
      {
        search: '"Read output ("',
        replace: '"讀取輸出 ("',
      },
      // ── Template literal: thought for Ns ──
      {
        search: '`thought for (\$\{Math\.max\(1,Math\.round\(\w+/1000\)\)\})s`',
        replace: '`思考了 $1s`',
        regex: true,
      },
      // ── Template literal: +N lines ──
      {
        search: '`\+(\$\{\w+\}) lines`',
        replace: '`+$1 行`',
        regex: true,
      },
      {
        search: '\\+(\$\{\\w+\}) lines\\]`',
        replace: '+$1 行]`',
        regex: true,
      },
      {
        search: '\\+(\\$\\{\\w+\\}) lines(\\$\\{)',
        replace: '+$1 行$2',
        regex: true,
      },
      {
        search: '\\+(\\$\\{\\w+\\}) lines …',
        replace: '+$1 行 …',
        regex: true,
      },
      // ── Template literal: ↑↓ more files ──
      {
        search: '` ↑ (\$\{\w+\}) more (\$\{\$7\(\w+,"file"\)\})`',
        replace: '` ↑ 還有 $1 $2`',
        regex: true,
      },
      // ── Template literal: still running ──
      {
        search: '` \· (\$\{\w+\}) still running `',
        replace: '` · $1 仍在執行 `',
        regex: true,
      },
      // ── Template literal: model set to ──
      {
        search: '` \· model set to (\$\{\w+\})`',
        replace: '` · 模型設為 $1`',
        regex: true,
      },
      // ── Template literal: already installed ──
      {
        search: '` \· (\$\{\w+\.installedCount\}) already installed`',
        replace: '` · $1 已安裝`',
        regex: true,
      },
      // ── Template literal: collapse/show all ──
      {
        search: '` \· (\$\{\w+\}) to (\$\{\w+\?)("collapse":"show all"\})`',
        replace: '` · $1 $2"收合":"展開全部"}`',
        regex: true,
      },
      // ── Template literal: to scroll ──
      {
        search: '` \· (\$\{\w+\})/(\$\{\w+\}) to scroll`',
        replace: '` · $1/$2 捲動`',
        regex: true,
      },
      // ── Template literal: ctrl+e to hide/explain ──
      {
        search: '` \· ctrl\+e to (\$\{\w+\.visible\?"hide":"explain"\})`',
        replace: '` · ctrl+e $1`',
        regex: true,
      },
      // ── Template literal: Share earn ──
      {
        search: '`Share Claude Code and earn (\$\{\w+\(\w+\)\}) of extra usage \· /passes`',
        replace: '`分享 Claude Code 可獲得 $1 額外用量 · /passes`',
        regex: true,
      },
      // ── Template literal: free guest passes ──
      {
        search: '`You have free guest passes to share \· (\$\{\w+\("/passes"\)\})`',
        replace: '`你有免費邀請碼可以分享 · $1`',
        regex: true,
      },
      // ── Template literal: Tip access ──
      {
        search: '`Tip: You have access to (\$\{\w+\.name\}) with (\$\{\w+\.multiplier\})x more context`',
        replace: '`提示：你可使用 $1，擁有 $2 倍的上下文`',
        regex: true,
      },
      // ── Template literal: Tip dynamic ──
      {
        search: '`Tip: (\$\{\w+\})`',
        replace: '`提示：$1`',
        regex: true,
      },
      // ── Template literal: Editing ──
      {
        search: '`Editing (\$\{\w+\})`',
        replace: '`編輯 $1`',
        regex: true,
      },
      // ── Template literal: auto-compact ──
      {
        search: '`(\$\{\w+\})% until auto-compact`',
        replace: '`$1% 即將自動壓縮`',
        regex: true,
      },
      // ── Template literal: carried from compact ──
      {
        search: '` \((\$\{\w+\}) carried from compact boundary\)`',
        replace: '` ($1 從壓縮邊界帶入)`',
        regex: true,
      },
      // ── Template literal: In/Out tokens ──
      {
        search: '`  In: (\$\{\w+\(\w+\.inputTokens\)\}) \· Out: (\$\{\w+\(\w+\.outputTokens\)\})`',
        replace: '`  輸入: $1 · 輸出: $2`',
        regex: true,
      },
      // ── Template literal: per Mtok ──
      {
        search: '`(\$\{\w+\(\w+\.inputTokens\)\})/(\$\{\w+\(\w+\.outputTokens\)\}) per Mtok`',
        replace: '`$1/$2 / 百萬 token`',
        regex: true,
      },
      // ── Ternary: will not work / may conflict ──
      {
        search: '"will not work":"may conflict"',
        replace: '"無法運作":"可能衝突"',
      },
      // ── Template literal: Branched conversation ──
      {
        search: '`Branched conversation(\$\{\w+\})\. You are now in the branch\.(\$\{\w+\})`',
        replace: '`已建立對話分支$1。你現在在分支中。$2`',
        regex: true,
      },
      {
        search: '`Branched conversation(\$\{\w+\})\. Resume with: /resume (\$\{\w+\})`',
        replace: '`已建立對話分支$1。恢復請用：/resume $2`',
        regex: true,
      },
      // ── Running command: fixed string + template ──
      {
        search: 'return"Running command"',
        replace: 'return"執行指令"',
      },
      {
        search: '`Running (\$\{\w+\.description\?\?\w+\(\w+\.command,\w+\)\})`',
        replace: '`執行 $1`',
        regex: true,
      },
      // ── Template literal: Next task ──
      {
        search: '`Next: (\$\{\w+\.subject\})`',
        replace: '`下一個：$1`',
        regex: true,
      },
      // ── Share: variant without /passes ──
      {
        search: '`Share Claude Code and earn (\$\{\w+\(\w+\)\}) of extra usage`',
        replace: '`分享 Claude Code 可獲得 $1 額外用量`',
        regex: true,
      },
      // ── Share: variant with q() wrapper ──
      {
        search: '`Share Claude Code and earn (\$\{\w+\(\w+\(\w+\)\)\}) of extra usage \· (\$\{\w+\("/passes"\)\})`',
        replace: '`分享 Claude Code 可獲得 $1 額外用量 · $2`',
        regex: true,
      },
      // ── Share: fallback text ──
      {
        search: '"Share Claude Code with friends"',
        replace: '"與朋友分享 Claude Code"',
      },
      // ── Branched conversation: default return ──
      {
        search: 'return"Branched conversation"',
        replace: 'return"已建立對話分支"',
      },
      // ── Tool badge: Wrote N lines to (createElement split) ──
      {
        search: '"Wrote ",j," lines to"',
        replace: '"寫入 ",j," 行至"',
      },
      {
        search: '"Wrote ",eK.createElement(v,{bold:!0},j)," lines to"',
        replace: '"寫入 ",eK.createElement(v,{bold:!0},j)," 行至"',
      },
      // ── Tool badge: Selected N lines from file in IDE ──
      {
        search: '"lines from ",V4.default.createElement(v,{bold:!0},q.displayPath)," in"," ",q.ideName',
        replace: '"行，來自 ",L7.default.createElement(v,{bold:!0},A.displayPath),"，在 ",A.ideName',
      },
      // ── Permission dialog: Accept button (unsafe string, needs postPatch) ──
      {
        search: '" Accept  "',
        replace: '" 允許  "',
      },
      // ── Permission dialog: Deny tab title (unsafe string, needs postPatch) ──
      {
        search: 'title:"Deny"',
        replace: 'title:"拒絕"',
      },
      // ── Fast mode overloaded: template literal variant ──
      {
        search: '`Fast mode overloaded and is temporarily unavailable \· resets in (\$\{\w+\})`',
        replace: '`快速模式超載，暫時無法使用 · $1 後重置`',
        regex: true,
      },
      // ── Settings section: Directories (too many non-UI occurrences) ──
      {
        search: '" Directories "',
        replace: '" 目錄 "',
      },
      // ── Tool header: Read userFacingName (1 occ, safe) ──
      {
        search: 'return"Read"}function',
        replace: 'return"讀取"}function',
      },
      // ── Tool header: Bash userFacingName (2 occ, both UI) ──
      {
        search: 'return"Bash"',
        replace: 'return"終端指令"',
      },
      // ── Tool header: Edit file title (2 occ, both UI) ──
      {
        search: '"Edit file"',
        replace: '"編輯檔案"',
      },
      // ── Tool badge: Reading/Read ternaries ──
      {
        search: '?"Reading":"reading"',
        replace: '?"正在讀取":"正在讀取"',
      },
      {
        search: '?"Read":"read"',
        replace: '?"已讀取":"已讀取"',
      },
      // ── Plural: file/files (all variable forms) ──
      {
        search: '===1?"file":"files"',
        replace: '===1?"個檔案":"個檔案"',
      },
      // ── Plural: commit/commits ──
      {
        search: '===1?"commit":"commits"',
        replace: '===1?"個提交":"個提交"',
      },
      // ── Plural: occurrence/occurrences ──
      {
        search: '===1?"occurrence":"occurrences"',
        replace: '===1?"個結果":"個結果"',
      },
      // ── Plural: issue/issues ──
      {
        search: '===1?"issue":"issues"',
        replace: '===1?"個問題":"個問題"',
      },
      // ── uncommitted (before file/commit count) ──
      {
        search: ' uncommitted ${',
        replace: ' 未提交 ${',
      },
      // ── Tool badge: Searching/Searched ternaries ──
      {
        search: '?"Searching for":"searching for"',
        replace: '?"正在搜尋":"正在搜尋"',
      },
      {
        search: '?"Searched for":"searched for"',
        replace: '?"已搜尋":"已搜尋"',
      },
      // ── Tool badge: pattern/patterns ──
      {
        search: '${A===1?"pattern":"patterns"}',
        replace: '${A===1?"個模式":"個模式"}',
      },
      {
        search: 'L===1?"pattern":"patterns"',
        replace: 'L===1?"個模式":"個模式"',
      },
      // ── Spinner: thinking label ──
      {
        search: '\\?`thinking(\\$\\{\\w+\\})`',
        replace: '?`思考中$1`',
        regex: true,
      },
      // ── Tip: /mobile ──
      {
        search: '"/mobile to use Claude Code from the Claude app on your phone"',
        replace: '"/mobile 從手機上的 Claude App 使用 Claude Code"',
      },
      // ── Collapse: ternary (translation map already replaced "→ to expand" → "→ 展開") ──
      {
        search: 'v_?"← to collapse":"→ 展開"',
        replace: 'v_?"← 收合":"→ 展開"',
      },
      {
        search: 'return"← to collapse"',
        replace: 'return"← 收合"',
      },
      // ── Diff summary: removed (dimColor) ──
      {
        search: 'r4.createElement(v,{dimColor:Q},"removed")',
        replace: 'r4.createElement(v,{dimColor:Q},"已刪除")',
      },
      // ── Tool header: Write userFacingName ──
      {
        search: 'return"Write"}function',
        replace: 'return"寫入"}function',
      },
      // ── Diff summary: Added N lines/line ──
      {
        search: '"Added ",VO.createElement(v,{bold:!0},H)," ",H>1?"lines":"line"',
        replace: '"新增 ",VO.createElement(v,{bold:!0},H)," ",H>1?"行":"行"',
      },
      // ── Done status: ternary (完成/無輸出) ──
      {
        search: '?"Done":"',
        replace: '?"完成":"',
      },
      // ── Done status: background task return ──
      {
        search: 'return"Done"}',
        replace: 'return"完成"}',
      },
      // ── Done status: skill loaded ──
      {
        search: 'createElement(u1,null,["Done"])',
        replace: 'createElement(u1,null,["完成"])',
      },
      // ── Effort level: template literal ──
      {
        search: '`Effort level: auto \(currently (\$\{\w+\(\w+,\w+\)\})\)`',
        replace: '`推理等級：自動（目前 $1）`',
        regex: true,
      },
      // ── ctrl+s to copy ──
      {
        search: '"Esc to cancel · r to cycle dates · ctrl+s to copy"',
        replace: '"Esc 取消 · r 切換日期 · ctrl+s 複製"',
      },
      // ── Custom model: template literals (two forms in v2.1.86) ──
      {
        search: '`Custom Sonnet model(\$\{\w+\?" \(1M context\)":""\})`,',
        replace: '`自訂 Sonnet 模型$1`,',
        regex: true,
      },
      {
        search: '`Custom Sonnet model(\$\{\w+\?" with 1M context":""\})`',
        replace: '`自訂 Sonnet 模型$1`',
        regex: true,
      },
      {
        search: '`Custom Opus model(\$\{\w+\?" \(1M context\)":""\})`,',
        replace: '`自訂 Opus 模型$1`,',
        regex: true,
      },
      {
        search: '`Custom Opus model(\$\{\w+\?" with 1M context":""\})`',
        replace: '`自訂 Opus 模型$1`',
        regex: true,
      },
      // ── Conversation compacted: meta content (3 occurrences) ──
      {
        search: 'content:"Conversation compacted"',
        replace: 'content:"對話已壓縮"',
      },
      // ── Authenticating with: createElement split (3 occurrences) ──
      {
        search: '"Authenticating with ",q.name,"…"',
        replace: '"正在驗證 ",q.name,"…"',
      },
      // ── Editing notebook: template + fixed ──
      {
        search: '`Editing notebook (\$\{\w+\})`:"Editing notebook"',
        replace: '`編輯筆記本 $1`:"編輯筆記本"',
        regex: true,
      },
      {
        search: 'NotebookEditTool:"Editing notebook"',
        replace: 'NotebookEditTool:"編輯筆記本"',
      },
      // ── Bash fallback: ternary returns "Bash" instead of "終端指令" ──
      {
        search: '?"SandboxedBash":"Bash"',
        replace: '?"SandboxedBash":"終端指令"',
      },
      // ── Activity description map: tool status labels ──
      {
        search: '{Read:"Reading",Write:"Writing",Edit:"Editing",MultiEdit:"Editing",Bash:"Running",Glob:"Searching",Grep:"Searching",WebFetch:"Fetching",WebSearch:"Searching",Task:"Running task",FileReadTool:"Reading",FileWriteTool:"Writing",FileEditTool:"Editing",GlobTool:"Searching",GrepTool:"Searching",BashTool:"Running"',
        replace: '{Read:"讀取中",Write:"寫入中",Edit:"編輯中",MultiEdit:"編輯中",Bash:"執行中",Glob:"搜尋中",Grep:"搜尋中",WebFetch:"擷取中",WebSearch:"搜尋中",Task:"執行任務",FileReadTool:"讀取中",FileWriteTool:"寫入中",FileEditTool:"編輯中",GlobTool:"搜尋中",GrepTool:"搜尋中",BashTool:"執行中"',
      },
      // ── Built-in skill/command descriptions ──
      {
        search: 'description:\'Use this skill to configure the Claude Code harness via settings.json. Automated behaviors ("from now on when X", "each time X", "whenever X", "before/after X") require hooks configured in settings.json - the harness executes these, not Claude, so m',
        replace: 'description:\'透過 settings.json 配置 Claude Code。自動行為（「從現在開始當 X」「每次 X」「X 之前/之後」）需在 settings.json 中配置 hooks — 由系統執行，不是 Claude 自己執行',
      },
      {
        search: `description:'Use when the user wants to customize keyboard shortcuts, rebind keys, add chord bindings, or modify ~/.claude/keybindings.json. Examples: "rebind ctrl+s", "add a chord shortcut", "change the submit key", "customize keybindings".`,
        replace: `description:'自訂鍵盤快捷鍵、重新綁定按鍵、新增組合鍵、或修改 ~/.claude/keybindings.json 時使用。`,
      },
      {
        search: `description:"Continue the current session in Claude Desktop"`,
        replace: `description:"在 Claude Desktop 繼續當前會話"`,
      },
      {
        search: `description:"Show remote session URL and QR code"`,
        replace: `description:"顯示遠端會話網址和 QR code"`,
      },
      {
        search: `description:"Create a branch of the current conversation at this point"`,
        replace: `description:"在此處建立對話分支"`,
      },
      // ── Built-in style descriptions ──
      {
        search: '"Explanatory",source:"built-in",description:"Claude explains its implementation choices and codebase patterns"',
        replace: '"說明型",source:"built-in",description:"Claude 解釋實作選擇和程式碼模式"',
      },
      {
        search: '"Learning",source:"built-in",description:"Claude pauses and asks you to write small pieces of code for hands-on practice"',
        replace: '"學習型",source:"built-in",description:"Claude 暫停並請你寫小段程式碼來動手練習"',
      },
      // ── whenToUse for built-in skills (shown in slash menu secondary text) ──
      {
        search: "whenToUse:'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval",
        replace: "whenToUse:'當用戶想設定重複任務、定期查詢狀態、或按間隔重複執行時使用",
      },
      {
        search: 'whenToUse:"When the user wants to schedule a recurring remote agent, set up automated tasks, create a cron job for Claude Code, or manage their scheduled agents/triggers."',
        replace: 'whenToUse:"當用戶想排程遠端代理、設定自動化任務、建立 Claude Code 的 cron 排程、或管理排程代理/觸發器時使用。"',
      },
      {
        search: 'whenToUse:"When the user wants to interact with web pages, automate browser tasks, capture screenshots, read console logs, or perform any browser-based actions.',
        replace: 'whenToUse:"當用戶想與網頁互動、自動化瀏覽器任務、截圖、讀取控制台日誌、或執行瀏覽器操作時使用。',
      },
      {
        search: 'whenToUse:"Use when the user wants to make a sweeping, mechanical change across many files (migrations, refactors, bulk renames) that can be decomposed into independent parallel units."',
        replace: 'whenToUse:"當用戶需要跨多個檔案進行大規模機械式改動（遷移、重構、批量更名）且可拆分為獨立平行單元時使用。"',
      },
      // ── Agent type descriptions ──
      {
        search: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.',
        replace: '通用代理，用於研究複雜問題、搜尋程式碼和執行多步驟任務。當搜尋關鍵字或檔案且不確定能否快速找到時，用這個代理執行搜尋。',
      },
      {
        search: 'Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-st',
        replace: '軟體架構代理，用於設計實作計畫。需要規劃任務的實作策略時使用。回傳逐步',
      },
      // ── Settings descriptions (single-quoted in cli.js) ──
      {
        search: "description:'Show turn duration message after responses",
        replace: "description:'回應後顯示回合耗時訊息",
      },
      {
        search: "description:'Preferred language for Claude responses and voice dictation",
        replace: "description:'Claude 回覆和語音聽寫的偏好語言",
      },
      {
        search: "description:'How to spawn teammates:",
        replace: "description:'如何啟動隊友：",
      },
      {
        search: `"Preferred notification channel"`,
        replace: `"偏好的通知頻道"`,
      },
      {
        search: `"Enable background memory consolidation"`,
        replace: `"啟用背景記憶整合"`,
      },
      {
        search: "description:'Show OSC 9;4 progress indicator in supported terminals",
        replace: "description:'在支援的終端顯示 OSC 9;4 進度指示器",
      },
      {
        search: 'description:"Override the default model"',
        replace: 'description:"覆蓋預設模型"',
      },
      {
        search: 'description:"Default - trusted network access"',
        replace: 'description:"預設 — 信任的網路存取"',
      },
      // ── Misc UI strings in descriptions ──
      {
        search: '"Verify a code change does what it should by running the app."',
        replace: '"透過執行應用程式驗證程式碼改動是否如預期運作。"',
      },
      {
        search: '"Copy the conversation to your system clipboard"',
        replace: '"將對話複製到系統剪貼簿"',
      },
      {
        search: '"Save the conversation to a file in the current directory"',
        replace: '"將對話儲存為當前目錄中的檔案"',
      },
      {
        search: '"You can always enable it later with /remote-control."',
        replace: '"之後隨時可以用 /remote-control 啟用。"',
      },
      // ── Background command / task notification strings ──
      {
        search: '="Background command "',
        replace: '="背景指令 "',
      },
      {
        search: '?"completed successfully":_==="failed"?"failed":"was stopped"',
        replace: '?"已完成":_==="failed"?"失敗":"已停止"',
      },
      {
        search: '?"Failed":"已停止"',
        replace: '?"失敗":"已停止"',
        regex: false,
      },
      {
        search: '`Background command killed: output file exceeded',
        replace: '`背景指令已終止：輸出檔案超過',
      },
      {
        search: '`Command timed out after',
        replace: '`指令逾時，超過',
      },
      // ── Agent status messages (template literals, use regex for variable names) ──
      {
        search: '`Agent "\\$\\{(\\w+)\\}" completed`',
        replace: '`代理「$${$1}」已完成`',
        regex: true,
      },
      {
        search: '`Agent "\\$\\{(\\w+)\\}" failed: \\$\\{(\\w+)\\|\\|"Unknown',
        replace: '`代理「$${$1}」失敗：$${$2}||"未知',
        regex: true,
      },
      // ── Task tools system reminder (inside template literal, real apostrophes) ──
      {
        search: "The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using",
        replace: '最近沒有使用任務工具。如果你正在進行需要追蹤進度的工作，請考慮使用',
      },
      {
        search: 'to add new tasks and',
        replace: '新增任務，以及',
      },
      {
        search: "to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable.",
        replace: '更新任務狀態（開始時設為進行中，完成時設為已完成）。如果任務清單已過時，也請考慮清理。只在相關時使用，此為溫和提醒，不適用請忽略。',
      },
      // ── Loop whenToUse English tail ──
      {
        search: `(e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.`,
        replace: `（如「每 5 分鐘檢查部署」「持續跑 /babysit-prs」）。一次性任務請勿使用。`,
      },
      // ── update-config skill: the translation map only matches the truncated en.json key,
      //    leaving an English tail. Match the ALREADY-TRANSLATED prefix + English tail. ──
      {
        search: `自動行為（「從現在開始當 X」「每次 X」「X 之前/之後」）需在 settings.json 中配置 hooks — 由系統執行，不是 Claude 自己執行emory/preferences cannot fulfill them. Also use for: permissions ("allow X", "add permission", "move permission to"), env vars ("set X=Y"), hook troubleshooting, or any changes to settings.json/settings.local.json files. Examples: "allow npm commands", "add bq permission to global settings", "move permission to user settings", "set DEBUG=true", "when claude stops show X". For simple settings like theme/model, use Config tool.`,
        replace: `自動行為（「從現在開始 X」「每次 X」「X 之前/之後」）需在 settings.json 中配置 hooks。也用於：權限管理（「允許 X」「新增權限」）、環境變數（「設定 X=Y」）、hook 除錯、或 settings.json 修改。簡單設定如主題/模型用 Config 工具。`,
      },
      // ── Turn duration verbs (shown after every response) ──
      {
        search: '["Baked","Brewed","Churned","Cogitated","Cooked","Crunched","Sautéed","Worked"]',
        replace: '["烘了","釀了","攪了","思了","煮了","算了","炒了","做了"]',
      },
      // ── "for" in turn duration: `${verb} for ${time}` → `${verb} ${time}` ──
      {
        search: '`\\$\\{(\\w+)\\} for \\$\\{(\\w+)\\}`',
        replace: '`$${$1} $${$2}`',
        regex: true,
      },
      // ── "still running" in turn duration footer ──
      {
        search: '` · \\$\\{(\\w+)\\} still running`',
        replace: '` · $${$1} 仍在執行`',
        regex: true,
      },
      // ── Shell count: "1 shell" / "${n} shells" ──
      {
        search: '"1 shell"',
        replace: '"1 個終端"',
      },
      {
        search: '`\\$\\{(\\w+)\\} shells`',
        replace: '`$${$1} 個終端`',
        regex: true,
      },
      // ── Monitor count: "1 monitor" / "${n} monitors" ──
      {
        search: '"1 monitor"',
        replace: '"1 個監控"',
      },
      {
        search: '`\\$\\{(\\w+)\\} monitors`',
        replace: '`$${$1} 個監控`',
        regex: true,
      },
      // ── Background task status labels ──
      {
        search: '"completed in background"',
        replace: '"在背景完成"',
      },
      {
        search: '"still running in background"',
        replace: '"仍在背景執行"',
      },
      // ── "was moved to the background" message ──
      {
        search: 'and was moved to the background with ID:',
        replace: '已移至背景執行，ID：',
      },
      {
        search: 'It is still running — you will be notified when it completes. Output is being written to:',
        replace: '仍在執行 — 完成時會通知你。輸出正在寫入：',
      },
      // ── Remote Control UI (note trailing spaces in cli.js) ──
      {
        search: '"Spawn mode: "',
        replace: '"啟動模式："',
      },
      {
        search: '"Max concurrent sessions: "',
        replace: '"最大同時會話數："',
      },
      {
        search: '"Environment ID: "',
        replace: '"環境 ID："',
      },
      {
        search: '"Sandbox:"',
        replace: '"沙箱："',
      },
      // ── Statistics/Status page ──
      {
        search: '"Tokens per Day"',
        replace: '"每日 Token 用量"',
      },
      {
        search: '"No model usage data available"',
        replace: '"沒有可用的模型使用數據"',
      },
      {
        search: '"Favorite model"',
        replace: '"常用模型"',
      },
      {
        search: '"Total tokens"',
        replace: '"總 Token 數"',
      },
      {
        search: '`Total cost:',
        replace: '`總費用：',
      },
      {
        search: 'Total duration (API):',
        replace: '總耗時（API）：',
      },
      {
        search: 'Total duration (wall):',
        replace: '總耗時（實際）：',
      },
      {
        search: '"Active time"',
        replace: '"活躍時間"',
      },
      {
        search: '"Input tokens"',
        replace: '"輸入 Token"',
      },
      {
        search: '"Output tokens"',
        replace: '"輸出 Token"',
      },
      // Cache creation/read: these are API field names, not displayed as standalone UI strings
      // ── Template literal messages (use regex for variable resilience) ──
      {
        search: '`You cannot use --strict-mcp-config when an enterprise MCP config is present`',
        replace: '`有企業 MCP 設定時不能使用 --strict-mcp-config`',
      },
      {
        search: '`You cannot dynamically configure MCP servers when an enterprise MCP config is present`',
        replace: '`有企業 MCP 設定時不能動態配置 MCP 伺服器`',
      },
      // ── iTerm2/Terminal.app restoration messages ──
      // ── "Browser didn't open" messages ──
      {
        search: "Browser didn't open automatically.",
        replace: '瀏覽器未自動開啟。',
      },
      {
        search: "Browser didn't open? Use the url below to sign in",
        replace: '瀏覽器沒開啟？用下面的網址登入',
      },
      {
        search: 'Detected an interrupted iTerm2 setup. Your original settings have been restored',
        replace: '偵測到中斷的 iTerm2 設定。你的原始設定已還原',
      },
      {
        search: 'Detected an interrupted Terminal.app setup. Your original settings have been restored',
        replace: '偵測到中斷的 Terminal.app 設定。你的原始設定已還原',
      },
      // ── System-reminder template strings (shown in conversation context) ──
      {
        search: 'The following skills are available for use with the Skill tool:',
        replace: '以下技能可透過 Skill 工具使用：',
      },
      {
        search: 'The following deferred tools are now available via ToolSearch:',
        replace: '以下延遲工具現可透過 ToolSearch 使用：',
      },
      {
        search: '# MCP Server Instructions',
        replace: '# MCP 伺服器指令',
      },
      {
        search: 'The following MCP servers have provided instructions for how to use their tools and resources:',
        replace: '以下 MCP 伺服器提供了工具和資源的使用說明：',
      },
      {
        search: 'Make sure that you NEVER mention this reminder to the user',
        replace: '確保你絕不向用戶提及此提醒',
      },
      // ── Agent status messages ──
      {
        search: '`Agent "\\$\\{(\\w+)\\}" was stopped`',
        replace: '`代理「$${$1}」已停止`',
        regex: true,
      },
      // ── Task notification wrapper ──
      {
        search: '"completed in background"',
        replace: '"在背景完成"',
      },
    ];
  }

  if (baseLang === 'zh-CN') {
    return [
      {
        search: '"Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what","\'","s in this folder first."',
        replace: '"快速安全检查：这是你创建或信任的项目吗？（例如你自己的代码、知名开源项目、或团队的工作）如果不是，请先看一下这个文件夹的内容。"',
      },
      {
        search: '"Claude Code","\'","ll be able to read, edit, and execute files here."',
        replace: '"Claude Code 将可以读取、编辑和执行这里的文件。"',
      },
      {
        search: 'return`Try "(\$\{\w+\(\w+\)\})"`',
        replace: 'return`试试看 "$1"`',
        regex: true,
      },
      {
        search: 'te="✻"',
        replace: 'te="☯"',
      },
      {
        search: '["·","✢","✳","✶","✻","✽"]',
        replace: '[" ","·","∘","○","☯","○","∘","·"]',
      },
      {
        search: '["·","✢","✳","✶","✻","*"]',
        replace: '[" ","·","∘","○","☯","○","∘","·"]',
      },
      {
        search: '["·","✢","*","✶","✻","✽"]',
        replace: '[" ","·","∘","○","☯","○","∘","·"]',
      },
      {
        search: '"✻ "',
        replace: '"☯ "',
      },
      {
        search: '"[✻] [✻] [✻]"',
        replace: '"[☯] [☯] [☯]"',
      },
      {
        search: '"[✻]"',
        replace: '"[☯]"',
      },
      {
        search: '"✻"',
        replace: '"☯"',
      },
      {
        search: '" ✻"',
        replace: '" ☯"',
      },
      {
        search: '" ) CC ✻ ┊╱"',
        replace: '" ) CC ☯ ┊╱"',
      },
      {
        search: '`✻ [Claude Code]',
        replace: '`☯ [Claude Code]',
      },
      // ── Image in clipboard: template literal ──
      {
        search: '`Image in clipboard \· (\$\{\w+\("chat:imagePaste","Chat","ctrl\+v"\)\}) to paste`',
        replace: '`剪贴板有图片 · $1 粘贴`',
        regex: true,
      },
      // ── Searching for: template literal ──
      {
        search: '`Searching for (\$\{\w+\})`',
        replace: '`搜索 $1`',
        regex: true,
      },
      // ── (VAR to expand): template literal ──
      {
        search: '`\\((\\$\\{\\w+\\}) to expand\\)`',
        replace: '`($1 展开)`',
        regex: true,
      },
      // ── Thinking (VAR to expand): template literal ──
      {
        search: '`\\$\\{"∴ Thinking"\\} \\((\\$\\{\\w+\\}) to expand\\)`',
        replace: '`${"∴ 思考中"} ($1 展开)`',
        regex: true,
      },
      // ── Effort level descriptions (HC3 function) ──
      {
        search: 'case"low":return"Quick, straightforward implementation with minimal overhead"',
        replace: 'case"low":return"low（低）— 快速直接，最少开销"',
      },
      {
        search: 'case"medium":return"Balanced approach with standard implementation and testing"',
        replace: 'case"medium":return"medium（中等）— 均衡的实现与测试"',
      },
      {
        search: 'case"high":return"Comprehensive implementation with extensive testing and documentation"',
        replace: 'case"high":return"high（高）— 完整实现、全面测试与文档"',
      },
      {
        search: 'case"max":return"Maximum capability with deepest reasoning (Opus 4.6 only)"',
        replace: 'case"max":return"max（最高）— 最深度推理（仅 Opus 4.6）"',
      },
      {
        search: 'return"Balanced approach with standard implementation and testing"',
        replace: 'return"medium（中等）— 均衡的实现与测试"',
      },
      // ── Reading/Writing template literals ──
      {
        search: '`Reading (\$\{\w+\})`',
        replace: '`读取 $1`',
        regex: true,
      },
      {
        search: '`Writing (\$\{\w+\})`',
        replace: '`写入 $1`',
        regex: true,
      },
      // ── "to expand" in createElement (variable keybinding) ──
      {
        search: '," to expand)"',
        replace: '," 展开)"',
      },
      {
        search: '"Read output ("',
        replace: '"读取输出 ("',
      },
      // ── Template literal: thought for Ns ──
      {
        search: '`thought for (\$\{Math\.max\(1,Math\.round\(\w+/1000\)\)\})s`',
        replace: '`思考了 $1s`',
        regex: true,
      },
      // ── Template literal: +N lines ──
      {
        search: '`\+(\$\{\w+\}) lines`',
        replace: '`+$1 行`',
        regex: true,
      },
      {
        search: '\\+(\$\{\\w+\}) lines\\]`',
        replace: '+$1 行]`',
        regex: true,
      },
      {
        search: '\\+(\\$\\{\\w+\\}) lines(\\$\\{)',
        replace: '+$1 行$2',
        regex: true,
      },
      {
        search: '\\+(\\$\\{\\w+\\}) lines …',
        replace: '+$1 行 …',
        regex: true,
      },
      // ── Template literal: ↑↓ more files ──
      {
        search: '` ↑ (\$\{\w+\}) more (\$\{\$7\(\w+,"file"\)\})`',
        replace: '` ↑ 还有 $1 $2`',
        regex: true,
      },
      // ── Template literal: still running ──
      {
        search: '` \· (\$\{\w+\}) still running `',
        replace: '` · $1 仍在执行 `',
        regex: true,
      },
      // ── Template literal: model set to ──
      {
        search: '` \· model set to (\$\{\w+\})`',
        replace: '` · 模型设为 $1`',
        regex: true,
      },
      // ── Template literal: already installed ──
      {
        search: '` \· (\$\{\w+\.installedCount\}) already installed`',
        replace: '` · $1 已安装`',
        regex: true,
      },
      // ── Template literal: collapse/show all ──
      {
        search: '` \· (\$\{\w+\}) to (\$\{\w+\?)("collapse":"show all"\})`',
        replace: '` · $1 $2"收起":"展开全部"}`',
        regex: true,
      },
      // ── Template literal: to scroll ──
      {
        search: '` \\· (\\$\\{\\w+\\})/(\\$\\{\\w+\\}) to scroll`',
        replace: '` · $1/$2 滚动`',
        regex: true,
      },
      // ── Template literal: ctrl+e to hide/explain ──
      {
        search: '` \· ctrl\+e to (\$\{\w+\.visible\?"hide":"explain"\})`',
        replace: '` · ctrl+e $1`',
        regex: true,
      },
      // ── Template literal: Share earn ──
      {
        search: '`Share Claude Code and earn (\$\{\w+\(\w+\)\}) of extra usage \· /passes`',
        replace: '`分享 Claude Code 可获得 $1 额外用量 · /passes`',
        regex: true,
      },
      // ── Template literal: free guest passes ──
      {
        search: '`You have free guest passes to share \· (\$\{\w+\("/passes"\)\})`',
        replace: '`你有免费邀请码可以分享 · $1`',
        regex: true,
      },
      // ── Template literal: Tip access ──
      {
        search: '`Tip: You have access to (\$\{\w+\.name\}) with (\$\{\w+\.multiplier\})x more context`',
        replace: '`提示：你可使用 $1，拥有 $2 倍的上下文`',
        regex: true,
      },
      // ── Template literal: Tip dynamic ──
      {
        search: '`Tip: (\$\{\w+\})`',
        replace: '`提示：$1`',
        regex: true,
      },
      // ── Template literal: Editing ──
      {
        search: '`Editing (\$\{\w+\})`',
        replace: '`编辑 $1`',
        regex: true,
      },
      // ── Template literal: auto-compact ──
      {
        search: '`(\$\{\w+\})% until auto-compact`',
        replace: '`$1% 即将自动压缩`',
        regex: true,
      },
      // ── Template literal: carried from compact ──
      {
        search: '` \((\$\{\w+\}) carried from compact boundary\)`',
        replace: '` ($1 从压缩边界带入)`',
        regex: true,
      },
      // ── Template literal: In/Out tokens ──
      {
        search: '`  In: (\$\{\w+\(\w+\.inputTokens\)\}) \· Out: (\$\{\w+\(\w+\.outputTokens\)\})`',
        replace: '`  输入: $1 · 输出: $2`',
        regex: true,
      },
      // ── Template literal: per Mtok ──
      {
        search: '`(\$\{\w+\(\w+\.inputTokens\)\})/(\$\{\w+\(\w+\.outputTokens\)\}) per Mtok`',
        replace: '`$1/$2 / 百万 token`',
        regex: true,
      },
      // ── Ternary: will not work / may conflict ──
      {
        search: '"will not work":"may conflict"',
        replace: '"无法运作":"可能冲突"',
      },
      // ── Template literal: Branched conversation ──
      {
        search: '`Branched conversation(\$\{\w+\})\. You are now in the branch\.(\$\{\w+\})`',
        replace: '`已建立对话分支$1。你现在在分支中。$2`',
        regex: true,
      },
      {
        search: '`Branched conversation(\$\{\w+\})\. Resume with: /resume (\$\{\w+\})`',
        replace: '`已建立对话分支$1。恢复请用：/resume $2`',
        regex: true,
      },
      // ── Running command: fixed string + template ──
      {
        search: 'return"Running command"',
        replace: 'return"执行指令"',
      },
      {
        search: '`Running (\$\{\w+\.description\?\?\w+\(\w+\.command,\w+\)\})`',
        replace: '`执行 $1`',
        regex: true,
      },
      // ── Template literal: Next task ──
      {
        search: '`Next: (\$\{\w+\.subject\})`',
        replace: '`下一个：$1`',
        regex: true,
      },
      // ── Share: variant without /passes ──
      {
        search: '`Share Claude Code and earn (\$\{\w+\(\w+\)\}) of extra usage`',
        replace: '`分享 Claude Code 可获得 $1 额外用量`',
        regex: true,
      },
      // ── Share: variant with q() wrapper ──
      {
        search: '`Share Claude Code and earn (\$\{\w+\(\w+\(\w+\)\)\}) of extra usage \· (\$\{\w+\("/passes"\)\})`',
        replace: '`分享 Claude Code 可获得 $1 额外用量 · $2`',
        regex: true,
      },
      // ── Share: fallback text ──
      {
        search: '"Share Claude Code with friends"',
        replace: '"与朋友分享 Claude Code"',
      },
      // ── Branched conversation: default return ──
      {
        search: 'return"Branched conversation"',
        replace: 'return"已建立对话分支"',
      },
      // ── Tool badge: Reading/Read ternaries ──
      {
        search: '?"Reading":"reading"',
        replace: '?"正在读取":"正在读取"',
      },
      {
        search: '?"Read":"read"',
        replace: '?"已读取":"已读取"',
      },
      // ── Plural: file/files (all variable forms) ──
      {
        search: '===1?"file":"files"',
        replace: '===1?"个文件":"个文件"',
      },
      // ── Plural: commit/commits ──
      {
        search: '===1?"commit":"commits"',
        replace: '===1?"个提交":"个提交"',
      },
      // ── Plural: occurrence/occurrences ──
      {
        search: '===1?"occurrence":"occurrences"',
        replace: '===1?"个结果":"个结果"',
      },
      // ── Plural: issue/issues ──
      {
        search: '===1?"issue":"issues"',
        replace: '===1?"个问题":"个问题"',
      },
      // ── uncommitted (before file/commit count) ──
      {
        search: ' uncommitted ${',
        replace: ' 未提交 ${',
      },
      // ── Tool badge: Searching/Searched ternaries ──
      {
        search: '?"Searching for":"searching for"',
        replace: '?"正在搜索":"正在搜索"',
      },
      {
        search: '?"Searched for":"searched for"',
        replace: '?"已搜索":"已搜索"',
      },
      // ── Tool badge: pattern/patterns ──
      {
        search: '${A===1?"pattern":"patterns"}',
        replace: '${A===1?"个模式":"个模式"}',
      },
      {
        search: 'L===1?"pattern":"patterns"',
        replace: 'L===1?"个模式":"个模式"',
      },
      // ── Spinner: thinking label ──
      {
        search: '\\?`thinking(\\$\\{\\w+\\})`',
        replace: '?`思考中$1`',
        regex: true,
      },
      // ── Tip: /mobile ──
      {
        search: '"/mobile to use Claude Code from the Claude app on your phone"',
        replace: '"/mobile 从手机上的 Claude App 使用 Claude Code"',
      },
      // ── Collapse: ternary (translation map already replaced "→ to expand" → "→ 展开") ──
      {
        search: 'v_?"← to collapse":"→ 展开"',
        replace: 'v_?"← 收起":"→ 展开"',
      },
      {
        search: 'return"← to collapse"',
        replace: 'return"← 收起"',
      },
      // ── Diff summary: removed (dimColor) ──
      {
        search: 'r4.createElement(v,{dimColor:Q},"removed")',
        replace: 'r4.createElement(v,{dimColor:Q},"已删除")',
      },
      // ── Tool header: Write userFacingName ──
      {
        search: 'return"Write"}function',
        replace: 'return"写入"}function',
      },
      // ── Diff summary: Added N lines/line ──
      {
        search: '"Added ",VO.createElement(v,{bold:!0},H)," ",H>1?"lines":"line"',
        replace: '"新增 ",VO.createElement(v,{bold:!0},H)," ",H>1?"行":"行"',
      },
      // ── Done status: ternary ──
      {
        search: '?"Done":"',
        replace: '?"完成":"',
      },
      // ── Done status: background return ──
      {
        search: 'return"Done"}',
        replace: 'return"完成"}',
      },
      // ── Done status: skill loaded ──
      {
        search: 'createElement(u1,null,["Done"])',
        replace: 'createElement(u1,null,["完成"])',
      },
      // ── Effort level: template literal ──
      {
        search: '`Effort level: auto \(currently (\$\{\w+\(\w+,\w+\)\})\)`',
        replace: '`推理等级：自动（当前 $1）`',
        regex: true,
      },
      // ── ctrl+s to copy ──
      {
        search: '"Esc to cancel · r to cycle dates · ctrl+s to copy"',
        replace: '"Esc 取消 · r 切换日期 · ctrl+s 复制"',
      },
      // ── Custom model: template literals (two forms) ──
      {
        search: '`Custom Sonnet model(\$\{\w+\?" \(1M context\)":""\})`,',
        replace: '`自定义 Sonnet 模型$1`,',
        regex: true,
      },
      {
        search: '`Custom Sonnet model(\$\{\w+\?" with 1M context":""\})`',
        replace: '`自定义 Sonnet 模型$1`',
        regex: true,
      },
      {
        search: '`Custom Opus model(\$\{\w+\?" \(1M context\)":""\})`,',
        replace: '`自定义 Opus 模型$1`,',
        regex: true,
      },
      {
        search: '`Custom Opus model(\$\{\w+\?" with 1M context":""\})`',
        replace: '`自定义 Opus 模型$1`',
        regex: true,
      },
      // ── Conversation compacted ──
      {
        search: 'content:"Conversation compacted"',
        replace: 'content:"对话已压缩"',
      },
      // ── Authenticating with ──
      {
        search: '"Authenticating with ",q.name,"…"',
        replace: '"正在验证 ",q.name,"…"',
      },
      // ── Editing notebook: template + fixed ──
      {
        search: '`Editing notebook (\$\{\w+\})`:"Editing notebook"',
        replace: '`编辑笔记本 $1`:"编辑笔记本"',
        regex: true,
      },
      {
        search: 'NotebookEditTool:"Editing notebook"',
        replace: 'NotebookEditTool:"编辑笔记本"',
      },
      // ── Bash fallback ──
      {
        search: '?"SandboxedBash":"Bash"',
        replace: '?"SandboxedBash":"终端指令"',
      },
      // ── Activity description map ──
      {
        search: '{Read:"Reading",Write:"Writing",Edit:"Editing",MultiEdit:"Editing",Bash:"Running",Glob:"Searching",Grep:"Searching",WebFetch:"Fetching",WebSearch:"Searching",Task:"Running task",FileReadTool:"Reading",FileWriteTool:"Writing",FileEditTool:"Editing",GlobTool:"Searching",GrepTool:"Searching",BashTool:"Running"',
        replace: '{Read:"读取中",Write:"写入中",Edit:"编辑中",MultiEdit:"编辑中",Bash:"执行中",Glob:"搜索中",Grep:"搜索中",WebFetch:"获取中",WebSearch:"搜索中",Task:"执行任务",FileReadTool:"读取中",FileWriteTool:"写入中",FileEditTool:"编辑中",GlobTool:"搜索中",GrepTool:"搜索中",BashTool:"执行中"',
      },
      // ── Onboarding checklist items (shown at startup) ──
      {
        search: '"Ask Claude to create a new app or clone a repository"',
        replace: '"让 Claude 帮你创建新项目或克隆仓库"',
      },
      {
        search: '"Run /init to create a CLAUDE.md file with instructions for Claude"',
        replace: '"运行 /init 为 Claude 创建 CLAUDE.md 说明文件"',
      },
      // ── Home directory launch warning ──
      {
        search: '"Note: You have launched claude in your home directory. For the best experience, launch it in a project directory instead."',
        replace: '"注意：你在主目录启动了 Claude。建议在项目目录中启动以获得最佳体验。"',
      },
      // ── Slash command descriptions (zh-CN) ──
      {
        search: '"Toggle fast mode (Opus 4.6 only)"',
        replace: '"切换快速模式（仅 Opus 4.6 可用）"',
      },
      {
        search: '"Sign in with your Anthropic account"',
        replace: '"使用你的 Anthropic 账号登录"',
      },
      {
        search: '"Set the AI model for Claude Code (currently MiniMax-M2.5)"',
        replace: '"为 Claude Code 设置 AI 模型（当前为 MiniMax-M2.5）"',
      },
      {
        search: '"Discover Claude Code features through quick interactive lessons"',
        replace: '"通过交互式快速教程了解 Claude Code 功能"',
      },
      {
        search: '"Initialize a new CLAUDE.md file with codebase documentation"',
        replace: '"初始化一个包含代码库文档的 CLAUDE.md 文件"',
      },
      {
        search: '"Build Claude API / Anthropic SDK apps. TRIGGER when: code imports `anthropic`/`@anthropic-ai/sdk`; user asks to use the Claude API, Anthropic SDK or Managed Agents',
        replace: '"构建 Claude API / Anthropic SDK 应用。触发场景：代码中导入了 anthropic/@anthropic-ai/sdk；用户要求使用 Claude API、Anthropic SDK 或托管智能体',
      },
      // ── Built-in skill descriptions (zh-CN variants) ──
      {
        search: "description:'Use this skill to configure the Claude Code harness via settings.json. Automated behaviors (\"from now on when X\", \"each time X\", \"whenever X\", \"before/after X\") require hooks configured in settings.json - the harness executes these, not Claude, so m",
        replace: "description:'通过 settings.json 配置 Claude Code。自动行为（\"从现在开始当 X\"、\"每次 X\"、\"X 之前/之后\"）需在 settings.json 中配置 hooks — 由系统执行，不是 Claude 自己执行",
      },
      {
        search: `description:'Use when the user wants to customize keyboard shortcuts, rebind keys, add chord bindings, or modify ~/.claude/keybindings.json. Examples: "rebind ctrl+s", "add a chord shortcut", "change the submit key", "customize keybindings".`,
        replace: `description:'自定义键盘快捷键、重新绑定按键、添加组合键、或修改 ~/.claude/keybindings.json 时使用。`,
      },
      {
        search: `description:"Continue the current session in Claude Desktop"`,
        replace: `description:"在 Claude Desktop 继续当前会话"`,
      },
      {
        search: `description:"Show remote session URL and QR code"`,
        replace: `description:"显示远程会话网址和二维码"`,
      },
      {
        search: `description:"Create a branch of the current conversation at this point"`,
        replace: `description:"在此处创建对话分支"`,
      },
      // ── Built-in style descriptions (zh-CN) ──
      {
        search: '"Explanatory",source:"built-in",description:"Claude explains its implementation choices and codebase patterns"',
        replace: '"说明型",source:"built-in",description:"Claude 解释实现选择和代码模式"',
      },
      {
        search: '"Learning",source:"built-in",description:"Claude pauses and asks you to write small pieces of code for hands-on practice"',
        replace: '"学习型",source:"built-in",description:"Claude 暂停并请你写小段代码来动手练习"',
      },
      // ── whenToUse for built-in skills (zh-CN) ──
      {
        search: "whenToUse:'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval",
        replace: "whenToUse:'当用户想设定重复任务、定期查询状态、或按间隔重复执行时使用",
      },
      {
        search: 'whenToUse:"When the user wants to schedule a recurring remote agent, set up automated tasks, create a cron job for Claude Code, or manage their scheduled agents/triggers."',
        replace: 'whenToUse:"当用户想排程远程代理、设定自动化任务、创建 Claude Code 的 cron 排程、或管理排程代理/触发器时使用。"',
      },
      {
        search: 'whenToUse:"When the user wants to interact with web pages, automate browser tasks, capture screenshots, read console logs, or perform any browser-based actions.',
        replace: 'whenToUse:"当用户想与网页互动、自动化浏览器任务、截图、读取控制台日志、或执行浏览器操作时使用。',
      },
      {
        search: 'whenToUse:"Use when the user wants to make a sweeping, mechanical change across many files (migrations, refactors, bulk renames) that can be decomposed into independent parallel units."',
        replace: 'whenToUse:"当用户需要跨多个文件进行大规模机械式改动（迁移、重构、批量重命名）且可拆分为独立并行单元时使用。"',
      },
      // ── Agent type descriptions (zh-CN) ──
      {
        search: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.',
        replace: '通用代理，用于研究复杂问题、搜索代码和执行多步骤任务。当搜索关键字或文件且不确定能否快速找到时，用这个代理执行搜索。',
      },
      {
        search: 'Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-st',
        replace: '软件架构代理，用于设计实现计划。需要规划任务的实现策略时使用。返回逐步',
      },
      // ── Settings descriptions (zh-CN) ──
      {
        search: "description:'Show turn duration message after responses",
        replace: "description:'回应后显示回合耗时消息",
      },
      {
        search: "description:'Preferred language for Claude responses and voice dictation",
        replace: "description:'Claude 回复和语音听写的偏好语言",
      },
      {
        search: "description:'How to spawn teammates:",
        replace: "description:'如何启动队友：",
      },
      {
        search: `"Preferred notification channel"`,
        replace: `"偏好的通知渠道"`,
      },
      {
        search: `"Enable background memory consolidation"`,
        replace: `"启用后台记忆整合"`,
      },
      {
        search: "description:'Show OSC 9;4 progress indicator in supported terminals",
        replace: "description:'在支持的终端显示 OSC 9;4 进度指示器",
      },
      {
        search: 'description:"Override the default model"',
        replace: 'description:"覆盖默认模型"',
      },
      {
        search: 'description:"Default - trusted network access"',
        replace: 'description:"默认 — 受信任的网络访问"',
      },
      // ── Misc UI strings in descriptions (zh-CN) ──
      {
        search: '"Verify a code change does what it should by running the app."',
        replace: '"通过运行应用程序验证代码改动是否如预期运作。"',
      },
      {
        search: '"Copy the conversation to your system clipboard"',
        replace: '"将对话复制到系统剪贴板"',
      },
      {
        search: '"Save the conversation to a file in the current directory"',
        replace: '"将对话保存为当前目录中的文件"',
      },
      {
        search: '"You can always enable it later with /remote-control."',
        replace: '"之后随时可以用 /remote-control 启用。"',
      },
      // ── Background command / task notification strings (zh-CN) ──
      {
        search: '="Background command "',
        replace: '="后台指令 "',
      },
      {
        search: '?"completed successfully":_==="failed"?"failed":"was stopped"',
        replace: '?"已完成":_==="failed"?"失败":"已停止"',
      },
      {
        search: '?"Failed":"已停止"',
        replace: '?"失败":"已停止"',
        regex: false,
      },
      {
        search: '`Background command killed: output file exceeded',
        replace: '`后台指令已终止：输出文件超过',
      },
      {
        search: '`Command timed out after',
        replace: '`指令超时，超过',
      },
      // ── Task tools system reminder (zh-CN) ──
      {
        search: "The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using",
        replace: '最近没有使用任务工具。如果你正在进行需要追踪进度的工作，请考虑使用',
      },
      {
        search: 'to add new tasks and',
        replace: '添加任务，以及',
      },
      {
        search: "to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable.",
        replace: '更新任务状态（开始时设为进行中，完成时设为已完成）。如果任务列表已过时，也请考虑清理。只在相关时使用，此为温和提醒，不适用请忽略。',
      },
      // ── Loop whenToUse English tail (zh-CN) ──
      {
        search: `(e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.`,
        replace: `（如"每 5 分钟检查部署"、"持续跑 /babysit-prs"）。一次性任务请勿使用。`,
      },
      // ── update-config skill: English tail after CN prefix (zh-CN) ──
      {
        search: `通过 settings.json 配置 Claude Code。自动行为（"从现在开始当 X"、"每次 X"、"X 之前/之后"）需在 settings.json 中配置 hooks — 由系统执行，不是 Claude 自己执行emory/preferences cannot fulfill them. Also use for: permissions ("allow X", "add permission", "move permission to"), env vars ("set X=Y"), hook troubleshooting, or any changes to settings.json/settings.local.json files. Examples: "allow npm commands", "add bq permission to global settings", "move permission to user settings", "set DEBUG=true", "when claude stops show X". For simple settings like theme/model, use Config tool.`,
        replace: `通过 settings.json 配置 Claude Code。自动行为（"从现在开始 X"、"每次 X"、"X 之前/之后"）需在 settings.json 中配置 hooks。也用于：权限管理（"允许 X"、"添加权限"）、环境变量（"设置 X=Y"）、hook 调试、或 settings.json 修改。简单设置如主题/模型用 Config 工具。`,
      },
      // ── Turn duration verbs (zh-CN) ──
      {
        search: '["Baked","Brewed","Churned","Cogitated","Cooked","Crunched","Sautéed","Worked"]',
        replace: '["烘了","酿了","搅了","思了","煮了","算了","炒了","做了"]',
      },
      // ── "for" in turn duration (zh-CN) ──
      {
        search: '`\\$\\{(\\w+)\\} for \\$\\{(\\w+)\\}`',
        replace: '`$${$1} $${$2}`',
        regex: true,
      },
      // ── "still running" in turn duration footer (zh-CN) ──
      {
        search: '` · \\$\\{(\\w+)\\} still running`',
        replace: '` · $${$1} 仍在执行`',
        regex: true,
      },
      // ── Shell count (zh-CN) ──
      {
        search: '"1 shell"',
        replace: '"1 个终端"',
      },
      {
        search: '`\\$\\{(\\w+)\\} shells`',
        replace: '`$${$1} 个终端`',
        regex: true,
      },
      // ── Monitor count (zh-CN) ──
      {
        search: '"1 monitor"',
        replace: '"1 个显示器"',
      },
      {
        search: '`\\$\\{(\\w+)\\} monitors`',
        replace: '`$${$1} 个显示器`',
        regex: true,
      },
      // ── Background task status labels (zh-CN) ──
      {
        search: '"completed in background"',
        replace: '"在后台完成"',
      },
      {
        search: '"still running in background"',
        replace: '"仍在后台执行"',
      },
      // ── "was moved to the background" message (zh-CN) ──
      {
        search: 'and was moved to the background with ID:',
        replace: '已移至后台执行，ID：',
      },
      {
        search: 'It is still running — you will be notified when it completes. Output is being written to:',
        replace: '仍在执行 — 完成时会通知你。输出正在写入：',
      },
      // ── Remote Control UI (zh-CN) ──
      {
        search: '"Spawn mode: "',
        replace: '"启动模式："',
      },
      {
        search: '"Max concurrent sessions: "',
        replace: '"最大同时会话数："',
      },
      {
        search: '"Environment ID: "',
        replace: '"环境 ID："',
      },
      {
        search: '"Sandbox:"',
        replace: '"沙箱："',
      },
      // ── Statistics/Status page (zh-CN) ──
      {
        search: '"Tokens per Day"',
        replace: '"每日 Token 用量"',
      },
      {
        search: '"No model usage data available"',
        replace: '"没有可用的模型使用数据"',
      },
      {
        search: '"Favorite model"',
        replace: '"常用模型"',
      },
      {
        search: '"Total tokens"',
        replace: '"总 Token 数"',
      },
      {
        search: '`Total cost:',
        replace: '`总费用：',
      },
      {
        search: 'Total duration (API):',
        replace: '总耗时（API）：',
      },
      {
        search: 'Total duration (wall):',
        replace: '总耗时（实际）：',
      },
      {
        search: '"Active time"',
        replace: '"活跃时间"',
      },
      {
        search: '"Input tokens"',
        replace: '"输入 Token"',
      },
      {
        search: '"Output tokens"',
        replace: '"输出 Token"',
      },
      // ── Template literal messages (zh-CN) ──
      {
        search: '`You cannot use --strict-mcp-config when an enterprise MCP config is present`',
        replace: '`有企业 MCP 配置时不能使用 --strict-mcp-config`',
      },
      {
        search: '`You cannot dynamically configure MCP servers when an enterprise MCP config is present`',
        replace: '`有企业 MCP 配置时不能动态配置 MCP 服务器`',
      },
      // ── "Browser didn't open" messages (zh-CN) ──
      {
        search: "Browser didn't open automatically.",
        replace: '浏览器未自动打开。',
      },
      {
        search: "Browser didn't open? Use the url below to sign in",
        replace: '浏览器没打开？用下面的网址登录',
      },
      // ── iTerm2/Terminal.app restoration messages (zh-CN) ──
      {
        search: 'Detected an interrupted iTerm2 setup. Your original settings have been restored',
        replace: '检测到中断的 iTerm2 设置。你的原始设置已还原',
      },
      {
        search: 'Detected an interrupted Terminal.app setup. Your original settings have been restored',
        replace: '检测到中断的 Terminal.app 设置。你的原始设置已还原',
      },
      // ── System-reminder template strings (zh-CN) ──
      {
        search: 'The following skills are available for use with the Skill tool:',
        replace: '以下技能可通过 Skill 工具使用：',
      },
      {
        search: 'The following deferred tools are now available via ToolSearch:',
        replace: '以下延迟工具现可通过 ToolSearch 使用：',
      },
      {
        search: '# MCP Server Instructions',
        replace: '# MCP 服务器指令',
      },
      {
        search: 'The following MCP servers have provided instructions for how to use their tools and resources:',
        replace: '以下 MCP 服务器提供了工具和资源的使用说明：',
      },
      {
        search: 'Make sure that you NEVER mention this reminder to the user',
        replace: '确保你绝不向用户提及此提醒',
      },
      // ── Agent status messages (zh-CN) ──
      {
        search: '`Agent "\\$\\{(\\w+)\\}" completed`',
        replace: '`代理「$${$1}」已完成`',
        regex: true,
      },
      {
        search: '`Agent "\\$\\{(\\w+)\\}" failed: \\$\\{(\\w+)\\|\\|"Unknown',
        replace: '`代理「$${$1}」失败：$${$2}||"未知',
        regex: true,
      },
      {
        search: '`Agent "\\$\\{(\\w+)\\}" was stopped`',
        replace: '`代理「$${$1}」已停止`',
        regex: true,
      },
      // ── Diff summary: Wrote N lines to (zh-CN) ──
      {
        search: '"Wrote ",j," lines to"',
        replace: '"写入 ",j," 行至"',
      },
      // ── Permission dialog: Accept/Deny (zh-CN) ──
      {
        search: '" Accept  "',
        replace: '" 允许  "',
      },
      {
        search: 'title:"Deny"',
        replace: 'title:"拒绝"',
      },
      // ── Fast mode overloaded: template literal variant (zh-CN) ──
      {
        search: '`Fast mode overloaded and is temporarily unavailable · resets in (\\$\\{\\w+\\})`',
        replace: '`快速模式超载，暂时无法使用 · $1 后重置`',
        regex: true,
      },
      // ── Settings section: Directories (zh-CN) ──
      {
        search: '" Directories "',
        replace: '" 目录 "',
      },
      // ── Tool header: Read userFacingName (zh-CN) ──
      {
        search: 'return"Read"}function',
        replace: 'return"读取"}function',
      },
      // ── Tool header: Bash userFacingName (zh-CN) ──
      {
        search: 'return"Bash"',
        replace: 'return"终端指令"',
      },
      // ── Tool header: Edit file title (zh-CN) ──
      {
        search: '"Edit file"',
        replace: '"编辑文件"',
      },
      // ── Effort level: template literal (zh-CN) ──
      {
        search: '`Effort level: auto \\(currently (\\$\\{\\w+\\(\\w+,\\w+\\)\\})\\)`',
        replace: '`推理等级：自动（当前 $1）`',
        regex: true,
      },
      // ── Branched conversation: default return (zh-CN) ──
      {
        search: 'return"Branched conversation"',
        replace: 'return"已建立对话分支"',
      },
      // ── Spinner: thinking label (zh-CN) ──
      {
        search: '\\?`thinking(\\$\\{\\w+\\})`',
        replace: '?`思考中$1`',
        regex: true,
      },
      // ── Input bar shortcuts hint (shown at bottom of input area) ──
      {
        search: '"\\? for shortcuts"',
        replace: '"？ 对于快捷方式"',
      },
      {
        search: '"/ for commands"',
        replace: '"/ 查看命令列表"',
      },
      {
        search: '"/btw for side question"',
        replace: '"/btw 附加提问"',
      },
      {
        search: '"double tap esc to clear input"',
        replace: '"按两下 ESC 清空输入"',
      },
      {
        search: '" to auto-accept edits"',
        replace: '" 接受编辑建议"',
      },
      {
        search: '" for verbose output"',
        replace: '" 详细输出"',
      },
      {
        search: '" to toggle tasks"',
        replace: '" 切换任务"',
      },
      {
        search: '" to undo"',
        replace: '" 撤销"',
      },
      {
        search: '"ctrl + z 暂停"',
        replace: '"Ctrl+Z 暂停"',
      },
      {
        search: '" to paste images"',
        replace: '" 粘贴图片"',
      },
      {
        search: '" to switch model"',
        replace: '" 切换模型"',
      },
      {
        search: '" to toggle fast mode"',
        replace: '" 切换快速模式"',
      },
      {
        search: '" to stash prompt"',
        replace: '" 暂存提示"',
      },
      {
        search: '" in $EDITOR"',
        replace: '" 在 $EDITOR 中编辑"',
      },
      {
        search: '"/keybindings to customize"',
        replace: '"/keybindings 自定义快捷键"',
      },
    ];
  }

  // No post-patch rules for English or other locales
  return [];
}

function applyPostPatch(
  source: string,
  locale: string,
): { source: string; count: number } {
  const rules = getPostPatchRules(locale);
  let count = 0;

  for (const rule of rules) {
    if (rule.regex) {
      const re = new RegExp(rule.search, 'g');
      if (re.test(source)) {
        re.lastIndex = 0; // reset after test
        source = source.replace(re, rule.replace);
        count++;
      }
    } else if (source.includes(rule.search)) {
      source = replaceAll(source, rule.search, rule.replace);
      count++;
    }
  }

  return { source, count };
}

/**
 * Apply translation patch to Claude Code's cli.js.
 *
 * Strategy:
 * 1. UNSAFE_STRINGS are never replaced (protocol/data safety)
 * 2. Single-occurrence strings use replaceAll (safe, only one place)
 * 3. Multi-occurrence strings use context-aware replacement
 *    (only replaces within createElement/label/title/etc. contexts)
 * 4. Post-patch: syntax validation + unsafe string integrity check
 * 5. Auto-restore on any failure
 */
export async function applyPatch(
  cliPath: string,
  translationMap: Map<string, string>,
  ccVersion: string,
  locale: string,
  variant: string | null = null,
): Promise<PatchResult> {
  // Step 0: If already patched (backup exists), restore from backup first
  // This prevents double-patching which produces garbage results
  const hasBackup = await hasValidBackup(cliPath);
  if (hasBackup) {
    await restoreBackup(cliPath);
    await removeBackup(cliPath);
  }

  // Step 1: Capture original MD5 before any modification
  const originalMd5 = getCliMd5(cliPath);

  // Step 2: Backup
  await createBackup(cliPath);

  // Step 3: Read source
  let source = await fs.readFile(cliPath, 'utf-8');

  // Step 4: Build and sort replacements (longest original first)
  const entries = [...translationMap.entries()]
    .sort((a, b) => b[0].length - a[0].length);

  // Step 5: Replace with safety checks
  let applied = 0;
  const missed: string[] = [];
  const skipped: string[] = [];
  let totalContextSkipped = 0;

  for (const [original, translated] of entries) {
    if (original === translated) continue;

    // Skip unsafe strings
    if (UNSAFE_STRINGS.has(original)) {
      skipped.push(original);
      continue;
    }

    let replaced = false;

    // Count occurrences to decide strategy
    const doubleSearch = `"${original}"`;
    const singleSearch = `'${original}'`;
    const doubleCount = countOccurrences(source, doubleSearch);
    const singleCount = countOccurrences(source, singleSearch);
    const totalCount = doubleCount + singleCount;
    const forceReplace = WHITELIST_STRINGS.has(original);

    if (totalCount <= 1 || forceReplace) {
      // Single occurrence OR whitelisted: safe to replaceAll
      if (doubleCount > 0) {
        source = replaceAll(source, doubleSearch, `"${translated}"`);
        replaced = true;
      }
      if (singleCount > 0) {
        source = replaceAll(source, singleSearch, `'${translated}'`);
        replaced = true;
      }
    } else {
      // Multiple occurrences: context-aware replacement
      if (doubleCount > 0) {
        const r = contextAwareReplace(source, doubleSearch, `"${translated}"`);
        source = r.result;
        if (r.count > 0) replaced = true;
        totalContextSkipped += r.skipped;
      }
      if (singleCount > 0) {
        const r = contextAwareReplace(source, singleSearch, `'${translated}'`);
        source = r.result;
        if (r.count > 0) replaced = true;
        totalContextSkipped += r.skipped;
      }
    }

    // Bare text fallback for JSX/createElement content
    if (!replaced && original.includes(' ')) {
      const bareSearch = `,${JSON.stringify(original)})`;
      const bareReplace = `,${JSON.stringify(translated)})`;
      if (source.includes(bareSearch)) {
        source = replaceAll(source, bareSearch, bareReplace);
        replaced = true;
      }
    }

    if (replaced) {
      applied++;
    } else {
      missed.push(original);
    }
  }

  // Step 5b: Locale-aware post-patch replacements
  // These handle strings that can't be replaced via the translation map
  // (apostrophe-split strings, template literals, UI symbols)
  const postPatchApplied = applyPostPatch(source, locale);
  source = postPatchApplied.source;
  applied += postPatchApplied.count;

  // Step 5c: Inject language directive into system prompt assembler
  // H5(q) is the identity function that passes system prompt arrays to the API.
  // By modifying it to append a language instruction, ALL 20+ system prompt
  // call sites automatically include the directive — no per-site patching needed.
  const langDirective = getLanguageDirective(locale);
  if (langDirective) {
    // Match: function H5(q){return q}
    // Replace: function H5(q){return[...q,"<directive>"]}
    // Use regex for resilience to minified function name changes
    const h5Pattern = /function (\w+)\((\w+)\)\{return \2\}(var \w+=\d+;async function)/;
    const h5Match = source.match(h5Pattern);
    if (h5Match) {
      const [fullMatch, fnName, paramName, afterContext] = h5Match;
      const injection = `function ${fnName}(${paramName}){return[...${paramName},${JSON.stringify(langDirective)}]}${afterContext}`;
      source = source.replace(fullMatch, injection);
      applied++;
    }
  }

  // Step 6: Write patched file
  await fs.writeFile(cliPath, source, 'utf-8');

  // Step 7: Validate JS syntax
  const syntaxValid = await validateSyntax(cliPath);
  if (!syntaxValid) {
    await restoreBackup(cliPath);
    throw new Error(
      'Patched cli.js failed syntax validation (node --check). Original restored.\n' +
      'A translation likely contains characters that break JS syntax.'
    );
  }

  // Step 8: Verify unsafe strings were not accidentally replaced
  const integrityOk = await verifyUnsafeIntegrity(cliPath);
  if (!integrityOk) {
    await restoreBackup(cliPath);
    throw new Error(
      'Unsafe string integrity check failed — a protocol string was modified. Original restored.\n' +
      'This indicates a bug in the patcher. Please report it.'
    );
  }

  // Step 9: Save state
  await saveState({
    locale,
    variant,
    ccVersion,
    patchDate: new Date().toISOString(),
    cliPath,
    cliMd5: getCliMd5(cliPath),
    originalMd5,
    replacements: applied,
    missed: missed.length,
    missedKeys: missed.slice(0, 20),
    unsafeSkipped: skipped.length,
    contextSkipped: totalContextSkipped,
  });

  return { applied, missed, skipped, contextSkipped: totalContextSkipped, total: entries.length };
}

/**
 * Validate that cli.js is still valid JavaScript using node --check.
 */
async function validateSyntax(cliPath: string): Promise<boolean> {
  try {
    // Windows needs quotes handled differently for cmd
    if (process.platform === 'win32') {
      execSync(`node --check "${cliPath}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 30000,
        shell: true,
      });
    } else {
      execSync(`node --check "${cliPath}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 30000,
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify that UNSAFE_STRINGS still appear in their original English form.
 * If any unsafe string was accidentally replaced, this catches it.
 */
async function verifyUnsafeIntegrity(cliPath: string): Promise<boolean> {
  const source = await fs.readFile(cliPath, 'utf-8');

  // Check a subset of critical protocol strings that MUST remain ASCII
  const criticalStrings = [
    '"Accept"',         // HTTP header
    '"Default"',        // Cookie/TLS
    '"Bypass"',         // PowerShell
    '"Allow"',          // CORS
  ];

  for (const s of criticalStrings) {
    if (!source.includes(s)) {
      return false;
    }
  }

  return true;
}

/**
 * Verify that translations were applied by checking the patched file.
 */
export async function verifyPatch(
  cliPath: string,
  translationMap: Map<string, string>
): Promise<{ applied: number; missed: string[] }> {
  const source = await fs.readFile(cliPath, 'utf-8');
  let applied = 0;
  const missed: string[] = [];

  for (const [original, translated] of translationMap.entries()) {
    if (original === translated) {
      applied++;
      continue;
    }

    if (UNSAFE_STRINGS.has(original)) {
      applied++; // Count as "handled" (intentionally skipped)
      continue;
    }

    const hasDouble = source.includes(`"${translated}"`);
    const hasSingle = source.includes(`'${translated}'`);
    const hasBare = source.includes(JSON.stringify(translated));

    if (hasDouble || hasSingle || hasBare) {
      applied++;
    } else {
      missed.push(original);
    }
  }

  return { applied, missed };
}

/**
 * Save patch state to ~/.cc-i18n/state.json.
 */
export async function saveState(state: PatchState): Promise<void> {
  await fs.ensureDir(STATE_DIR);
  await fs.writeJson(STATE_FILE, state, { spaces: 2 });
}

/**
 * Load patch state from ~/.cc-i18n/state.json.
 */
export async function loadState(): Promise<PatchState | null> {
  if (!await fs.pathExists(STATE_FILE)) {
    return null;
  }
  try {
    return await fs.readJson(STATE_FILE);
  } catch {
    return null;
  }
}

/**
 * Remove patch state file.
 */
export async function clearState(): Promise<void> {
  if (await fs.pathExists(STATE_FILE)) {
    await fs.remove(STATE_FILE);
  }
}

/**
 * Get the state directory path.
 */
export function getStateDir(): string {
  return STATE_DIR;
}

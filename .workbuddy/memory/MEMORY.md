# 长期记忆

## 项目: cc-i18n (Claude Code 中文本地化工具)

### 基本信息
- 项目位置: `d:\下载\Programs\claude-code-i18n-main`
- 主要文件: `src/core/patcher.ts`, `src/translations/zh-CN.json`
- Claude Code 安装路径: `D:\nodejs\node_global\node_modules\@anthropic-ai\claude-code\cli.js`

### 关键经验
1. **patcher.ts 结构**: `getPostPatchRules()` 函数返回翻译规则数组，使用字符串替换方式翻译硬编码字符串
2. **zh-CN vs zh-TW**: zh-TW 使用繁体，zh-CN 使用简体。两者规则结构相同但内容不同
3. **zh-CN.json 翻译文件**: 包含命令列表、工具描述等字符串翻译。部分条目从 zh-TW 复制后忘记转为简体
4. **patch 命令**: 修改代码后需运行 `npx tsx src/cli.ts patch` 使翻译生效
5. **构建**: `npm run build` 编译 TypeScript 到 `dist/cli.js`
6. **斜杠命令翻译位置**: 在 patcher.ts 的 Home directory launch warning 之后、Built-in skill descriptions 之前添加，格式为 `search` + `replace` 对象

### 斜杠命令翻译 (2026-04-11)
已添加 6 个斜杠命令的翻译到 patcher.ts zh-CN postPatchRules：
- /fast → 切换快速模式（仅 Opus 4.6 可用）
- /login → 使用你的 Anthropic 账号登录
- /model → 为 Claude Code 设置 AI 模型（当前为 MiniMax-M2.5）
- /powerup → 通过交互式快速教程了解 Claude Code 功能
- /init → 初始化一个包含代码库文档的 CLAUDE.md 文件
- /claude-api → 构建 Claude API / Anthropic SDK 应用（触发场景和不触发场景）

### 用户偏好
- 用户使用简体中文 (zh-CN)
- 用户在 Windows 环境 (PowerShell)
- 用户对翻译质量要求较高，关注繁简混用问题

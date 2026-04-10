# cc-i18n

**让 Claude Code 说你的语言**

> Claude Code 的终端界面全部是英文硬编码的。这个工具解决这个问题。

[![npm version](https://img.shields.io/npm/v/cc-i18n.svg)](https://www.npmjs.com/package/cc-i18n)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](./README.md) | [繁體中文](./README.zh-TW.md)

---

## 功能

cc-i18n 翻译 Claude Code 的**整个终端界面**：

- 权限提示（允许 / 拒绝 / 永远允许...）
- 状态消息（思考中... / 运行中... / 压缩对话中...）
- 模式标签（规划模式 / 接受编辑 / 跳过权限...）
- 错误消息、按钮文字等
- 同时让 Claude 的 AI 回复也使用中文

### 小学生模式

特别的「小学生版」用最简单的词汇 + emoji 解释所有功能：

| 英文 | 简体中文 | 小学生版 |
|------|---------|---------|
| Allow | 允许 | 👍 好的 |
| Deny | 拒绝 | 🚫 不要 |
| Thinking... | 思考中... | 🤔 想一想... |
| Running... | 运行中... | ⚡ 在做了在做了... |
| Plan Mode | 规划模式 | 📋 只看不做模式 |

---

## 快速开始

### Windows (PowerShell)

```powershell
# 安装
npm install -g cc-i18n

# 切换到简体中文
cc-i18n patch --lang zh-CN

# 查看状态
cc-i18n status

# 还原英文
cc-i18n unpatch

# 自动重装 wrapper (Claude Code 更新后自动重新翻译)
cc-i18n install-wrapper
```

### macOS / Linux (bash/zsh)

```bash
# 安装
npm install -g cc-i18n

# 切换到简体中文
cc-i18n patch --lang zh-CN

# 切换到小学生版
cc-i18n patch --lang zh-CN --kids

# 查看状态
cc-i18n status

# 还原英文
cc-i18n unpatch

# 自动重装 wrapper (Claude Code 更新后自动重新翻译)
cc-i18n install-wrapper
```

---

## 命令

| 命令 | 说明 |
|------|------|
| `cc-i18n patch --lang <语言>` | 应用翻译 |
| `cc-i18n unpatch` | 还原英文 |
| `cc-i18n status` | 查看当前状态 |
| `cc-i18n list` | 列出可用语言 |
| `cc-i18n extract` | 提取 UI 字符串（翻译用） |
| `cc-i18n contribute --lang <语言>` | 生成翻译模板 |
| `cc-i18n check-update` | 检查 CC 更新，自动重新翻译 |

---

## CC 更新后自动重新翻译

Claude Code 更新会覆盖翻译过的文件。

### Windows (PowerShell)

```powershell
# 添加到 PowerShell 配置文件中
notepad $PROFILE

# 将以下内容添加到文件末尾并保存
function cc-i18n-check {
  if (Get-Command cc-i18n -ErrorAction SilentlyContinue) {
    cc-i18n check-update --quiet 2>$null
  }
}
cc-i18n-check
```

或者使用 wrapper（推荐）：

```powershell
cc-i18n install-wrapper
```

### macOS / Linux (bash/zsh)

加这段到 `.zshrc` 就能自动重新翻译：

```bash
cc-i18n check-update --hook >> ~/.zshrc
source ~/.zshrc
```

或者使用 wrapper（推荐）：

```bash
cc-i18n install-wrapper
```

---

## 安全机制

- 修改前自动备份原始文件
- 修改后用 `node --check` 验证语法
- 验证失败自动还原
- 随时可用 `cc-i18n unpatch` 完整还原

---

## 贡献翻译

```bash
# 生成空白翻译模板
cc-i18n contribute --lang ja

# 填写翻译后，复制到 src/translations/
# 测试：cc-i18n patch --lang ja
# 提交 PR！
```

---

## 许可证

MIT

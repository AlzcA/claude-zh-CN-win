[English](docs/README.en.md) | 中文

# cc-i18n — 让 Claude Code 说中文

把 Claude Code 的整个界面翻译成中文（或任何语言）。

零 token 消耗，CC 更新后自动修复。

## 效果预览

安装前：所有菜单、按钮、提示都是英文
安装后：全部变中文，操作体验完全不同

> 目前翻译了 1480+ 个字符串，涵盖 CC 的按钮、菜单、状态栏、错误消息、工具提示等。

## 安装方法

### 第一步：克隆仓库

```bash
git clone https://github.com/AlzcA/claude-zh-CN-win.git
cd claude-zh-CN-win
```

### 第二步：安装依赖并构建

```bash
npm install
npm run build
```

### 第三步：全局链接（按系统选择）

**Windows (PowerShell / CMD)**

```powershell
# 在项目目录下运行
npm link

# 如果 PowerShell 报错"不允许运行脚本"，用管理员打开 PowerShell 执行：
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# 然后再运行 npm link
```

**macOS / Linux**

```bash
sudo npm link
```

> 提示：如果你用的是 zsh，需要在 `~/.zshrc` 或 `~/.zprofile` 中添加：
> ```bash
> export PATH="$(npm prefix -g)/bin:$PATH"
> ```
> 然后运行 `source ~/.zshrc` 使配置生效。

### 第三步（备选）：不链接全局，直接用 npx 运行

如果不想全局链接，每次使用时在项目目录下运行：

```bash
npx tsx src/cli.ts patch --lang zh-CN
```

### 第四步：套用中文翻译

**方式一：如果你做了 npm link**

```bash
cc-i18n patch --lang zh-CN
cc-i18n patch --lang zh-TW   # 繁体中文
```

**方式二：用 npx 运行（不用 npm link）**

```bash
npx tsx src/cli.ts patch --lang zh-CN
npx tsx src/cli.ts patch --lang zh-TW   # 繁体中文
```

安装完成后运行 `claude --help`，看到中文就成功了。

---

## 切换语种

**方式一：如果你做了 npm link**

```bash
cc-i18n patch --lang zh-CN   # 切换到简体中文
cc-i18n patch --lang zh-TW   # 切换到繁体中文
cc-i18n unpatch              # 恢复英文
cc-i18n status               # 查看状态
```

**方式二：用 npx 运行**

```bash
npx tsx src/cli.ts patch --lang zh-CN
npx tsx src/cli.ts patch --lang zh-TW
npx tsx src/cli.ts unpatch
npx tsx src/cli.ts status
```

---

## 更新翻译

当仓库有更新时，拉取最新代码并重新构建：

```bash
# 进入项目目录
cd claude-code-i18n

# 拉取最新代码
git pull

# 重新构建
npm run build

# 重新套用翻译
cc-i18n patch --lang zh-CN
# 或用 npx：npx tsx src/cli.ts patch --lang zh-CN
```

---

## 卸载与删除

### 完全卸载（删除所有翻译文件）

**如果你做了 npm link**

```bash
# 1. 先恢复英文
cc-i18n unpatch

# 2. 卸载 wrapper（如果安装了）
cc-i18n uninstall-wrapper

# 3. 卸载哨兵（如果安装了）
cc-i18n uninstall-sentinel

# 4. 取消全局链接
npm unlink -g cc-i18n
```

**如果用的是 npx 方式**

```bash
# 恢复英文即可
npx tsx src/cli.ts unpatch
```

### 临时禁用（保留文件）

如果只是想让 CC 显示英文，但保留翻译文件：

**npm link 方式**
```bash
cc-i18n unpatch
```

**npx 方式**
```bash
npx tsx src/cli.ts unpatch
```

下次想用中文时重新运行：
```bash
cc-i18n patch --lang zh-CN
```

---

## CC 更新后会不会失效？

**不会。** 安装了自动修复机制（三层防御），CC 怎么更新都不影响：

| 防线 | 原理 | 什么时候保护你 |
|------|------|----------------|
| Wrapper | 每次打 `claude` 前自动检查 | 你启动 CC 的那一刻 |
| Sentinel | 后台监控 CC 安装目录 | cli.js 被换的那一秒 |
| CC Hook | CC 启动时再确认一次 | CC 内部启动流程中 |

三层独立运作，任一层坏了其他两层照顾你。

---

## 支持语言

| 语言 | 代码 | 状态 |
|------|------|------|
| 简体中文 | zh-CN | 完整 |
| 繁体中文 | zh-TW | 完整 |
| 简单英文 | en-simple | 规划中 |

想加新语言？欢迎贡献！看 [新语言指南](docs/cc-i18n-new-lang-playbook.md)。

---

## 所有命令

```bash
# 核心命令
cc-i18n patch --lang zh-CN    # 套用翻译
cc-i18n patch --lang zh-CN --claude-path "C:\Users\用户名\.claude"  # 手动指定 Claude 安装路径
cc-i18n unpatch                # 恢复英文
cc-i18n status                 # 查看状态

# 自动修复
cc-i18n install-wrapper        # 安装自动修复 wrapper
cc-i18n uninstall-wrapper      # 卸载 wrapper

# 哨兵（可选，后台监控）
cc-i18n install-sentinel       # 安装后台哨兵
cc-i18n uninstall-sentinel     # 卸载后台哨兵

# 更新
cc-i18n update                 # 更新翻译文件
```

---

## 常见问题

**Q：找不到 Claude Code 安装路径怎么办？**
A：工具会自动搜索常见安装位置。如果失败，用 `--claude-path` 手动指定 Claude 的安装目录或 cli.js 文件：
```bash
# 指定目录（自动查找 cli.js）
cc-i18n patch --lang zh-CN --claude-path "C:\Users\用户名\.claude"

# 或直接指定 cli.js 文件
cc-i18n patch --lang zh-CN --claude-path "C:\Users\用户名\.claude\cli.js"
```

**Q：会消耗更多 token 吗？**
A：不会。翻译是在你的电脑上直接替换 UI 字符串，跟 API 无关。零消耗。

**Q：会不会影响 CC 的功能？**
A：不会。只改界面文字，不碰任何逻辑代码。UNSAFE 字符串（HTTP headers 等）自动排除。

**Q：支持 native installer 版的 CC 吗？**
A：支持。工具会自动检测各种安装方式（npm、PowerShell 安装器、winget 等）。如果自动检测失败，可用 `--claude-path` 手动指定：
```bash
cc-i18n patch --lang zh-CN --claude-path "C:\Users\用户名\.claude"
```

---

## 工作原理

cc-i18n 用两层翻译：

1. **静态翻译表**：1440+ 条英中对照，直接字符串替换
2. **postPatch 规则**：处理 JSX/createElement 等动态字符串，用上下文感知的精确替换

不改逻辑，只改显示文字。patch 前自动备份，随时可 unpatch 恢复。

---

## 贡献

欢迎 PR！特别欢迎：
- 新语言翻译
- 修正翻译错误
- 支持新版 CC

## License

MIT

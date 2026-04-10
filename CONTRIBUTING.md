# Contributing to cc-i18n

Thanks for helping make Claude Code accessible to everyone!

## Adding a New Language

### 1. Generate a template

```bash
cc-i18n contribute --lang <locale>
# Example: cc-i18n contribute --lang ja
```

This creates a JSON file with all 153 translation keys.

### 2. Fill in translations

- Open the generated `<locale>.json`
- Fill in `_meta.name` (English name) and `_meta.nativeName` (native name)
- Translate every empty string
- Reference `src/translations/en.json` for the English originals

### 3. Translation guidelines

**Standard version:**
- Use natural, professional terminology for your locale
- Keep translations concise — they appear in terminal UI
- Preserve trailing spaces and ellipsis characters (`…` U+2026) as in the original
- Don't translate brand names (Claude, Claude Code, GitHub, etc.)

**Kids version (optional):**
- Create `<locale>-kids.json` with `"variant": "kids"` in `_meta`
- Use the simplest possible vocabulary
- Add emoji to help understanding
- Use a friendly, encouraging tone
- Explain technical terms in everyday words
- Keep sentences short

### 4. Test your translation

```bash
# Copy to translations directory
cp <locale>.json src/translations/

# Build and test
npm run build
cc-i18n patch --lang <locale>

# Verify Claude Code works correctly
claude --version
```

### 5. Submit a PR

- Fork the repository
- Add your translation file(s) to `src/translations/`
- Run `npm test` to verify all keys are present
- Submit a pull request

## Development Setup

```bash
git clone https://github.com/<owner>/cc-i18n.git
cd cc-i18n
npm install
npm run build
npm link
```

## Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run lint          # Type check
```

## Project Structure

```
src/
├── cli.ts              # CLI entry point
├── commands/           # CLI command implementations
├── core/               # Core modules (finder, extractor, patcher, backup, watcher)
├── translations/       # Translation JSON files
└── plugin/             # Claude Code plugin files
```

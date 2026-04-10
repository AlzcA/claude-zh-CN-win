import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { loadTemplate, loadEnglishBase } from '../core/translations.js';

interface ContributeOptions {
  lang: string;
}

export async function contributeCommand(options: ContributeOptions): Promise<void> {
  try {
    const outputFile = `${options.lang}.json`;
    const outputPath = path.resolve(outputFile);

    if (await fs.pathExists(outputPath)) {
      console.log(chalk.yellow(`⚠ File already exists: ${outputFile}`));
      console.log(chalk.yellow('   Delete it first if you want to regenerate.'));
      return;
    }

    // Load template and English base
    const template = await loadTemplate() as Record<string, Record<string, string>>;
    const en = await loadEnglishBase();

    // Fill template with locale info and English originals as comments
    template._meta = {
      locale: options.lang,
      name: '',
      nativeName: '',
      version: '1.0.0',
      authors: '' as unknown as string,
      cc_version: '2.1.x',
    } as unknown as Record<string, string>;

    // Count strings
    let count = 0;
    for (const [cat, strings] of Object.entries(en)) {
      if (cat === '_meta') continue;
      count += Object.keys(strings as Record<string, string>).length;
    }

    await fs.writeJson(outputPath, template, { spaces: 2 });

    console.log(chalk.green.bold(`✅ Translation template created: ${outputFile}`));
    console.log();
    console.log(chalk.dim(`   ${count} strings to translate`));
    console.log();
    console.log(chalk.bold('   Next steps:'));
    console.log(`   1. Fill in _meta.name and _meta.nativeName`);
    console.log(`   2. Translate each empty string (reference en.json for originals)`);
    console.log(`   3. Copy to src/translations/${outputFile}`);
    console.log(`   4. Test: cc-i18n patch --lang ${options.lang}`);
    console.log(`   5. Submit a PR!`);
  } catch (err) {
    console.error(chalk.red(`\n❌ Failed: ${(err as Error).message}`));
    process.exit(1);
  }
}

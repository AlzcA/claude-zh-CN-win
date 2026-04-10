import ora from 'ora';
import chalk from 'chalk';

// Taiji breathing cycle: void → birth → grow → full (spin) → shrink → fade → void
const BREATHE_FRAMES = [
  ' ',     // 空
  '·',     // 生（微點）
  '∘',     // 長（小圓）
  '○',     // 長（中圓）
  '☯',     // 滿（太極出現）
  '☯',     // 滿
  '☯',     // 滿
  '☯',     // 滿
  '○',     // 收（中圓）
  '∘',     // 滅（小圓）
  '·',     // 滅（微點）
  ' ',     // 空
];

const TAIJI_SPINNER = {
  interval: 150,
  frames: BREATHE_FRAMES,
};

export function createSpinner() {
  const spinner = ora({
    spinner: TAIJI_SPINNER,
    color: 'yellow',
  });

  return {
    start(text: string) {
      spinner.start(text);
    },

    update(text: string) {
      spinner.text = text;
    },

    updateProgress(current: number, total: number, elapsed: number) {
      const pct = Math.round((current / total) * 100);
      const barLen = 10;
      const filled = Math.round((current / total) * barLen);
      const empty = barLen - filled;

      const barColor = pct >= 90 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.dim;
      const bar = barColor('▰'.repeat(filled)) + chalk.dim('▱'.repeat(empty));
      const pctStr = barColor(`${pct}%`);

      const mins = Math.floor(elapsed / 60);
      const secs = String(Math.floor(elapsed % 60)).padStart(2, '0');
      const time = `${mins}m ${secs}s`;

      spinner.text = `Patching…  ${chalk.dim(`(${time} · ${current}/${total})`)}  ${bar} ${pctStr}`;
    },

    succeed(text: string) {
      spinner.succeed(text);
    },

    succeedPatch(lang: string, count: number, total: number, elapsed: number) {
      const bar = chalk.green('▰'.repeat(10));
      spinner.succeed(
        `${chalk.green('Done!')}  ${chalk.cyan(lang)} ${chalk.dim(`· ${count}/${total} · ${elapsed.toFixed(1)}s`)}  ${bar}`
      );
    },

    fail(message: string) {
      spinner.fail(chalk.red(message));
    },

    stop() {
      spinner.stop();
    },
  };
}

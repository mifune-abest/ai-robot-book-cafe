import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-robot-book-cafe-test-'));

console.log(`テスト専用データ: ${dataDir}`);
console.log('外部送信を防ぐため、APP_TEST_MODE=1 / 画像生成=mock / ⑤の顔合成=PC内MediaPipeへ固定します。');

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: projectDir,
  env: {
    ...process.env,
    APP_TEST_MODE: '1',
    IMAGE_PROVIDER: 'mock',
    CAREER_CARD_OUTFIT_PROVIDER: 'mock',
    CAREER_CARD_COMPOSITOR: 'smart',
    ADULT_TEST_MODE: 'false',
    PORT: process.env.TEST_PORT || '4410',
    HOST_PORT: process.env.TEST_HOST_PORT || '4411',
    DATA_DIR: dataDir,
  },
  stdio: 'inherit',
});

function stop(signal) {
  if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('exit', (code, signal) => {
  console.log(`テストサーバーを停止しました。テストデータは次の一時フォルダに残しています: ${dataDir}`);
  process.exitCode = signal ? 0 : (code ?? 1);
});

import { config } from '../src/config.js';
import { CodexAppServerService } from '../src/services/codex-app-server.js';

const textAi = new CodexAppServerService(config);

try {
  const health = await textAi.health();
  if (!health.ok) throw new Error(health.reason || '接続状態を確認できません');
  if (health.model !== config.codexAppServerModel) {
    throw new Error(`指定モデルと応答モデルが一致しません: ${health.model}`);
  }
  console.log(`Codex app-server: 準備OK (${health.model})`);

  const warmup = await textAi.nextDreamQuestion({ genre: '動作確認', history: [], step: 0 });
  if (!warmup?.text || !Array.isArray(warmup.options) || warmup.options.length !== 4) {
    throw new Error('構造化応答を確認できません');
  }
  console.log('Codex app-server: GPT応答テストOK');
  if ((process.env.IMAGE_PROVIDER || 'mock') === 'codex' && health.imageGeneration !== true) {
    throw new Error('Codex app-serverの画像生成機能を利用できません');
  }
} catch (error) {
  console.error(`Codex app-serverを利用できません: ${error.message}`);
  console.error(`Codexへログインし、「${config.codexAppServerModel}」を利用できる状態にしてから、もう一度ためしてください。`);
  console.error('ローカルAIや別モデルへは自動的に切り替えません。');
  process.exit(1);
}

const imageProvider = process.env.IMAGE_PROVIDER || 'mock';
if (!['mock', 'codex'].includes(imageProvider)) {
  console.error(`IMAGE_PROVIDERは mock または codex だけを指定できます: ${imageProvider}`);
  process.exit(1);
}
if (imageProvider === 'codex' && process.env.ADULT_TEST_MODE !== 'true') {
  console.error('Codex画像生成は成人テスト専用です。ADULT_TEST_MODE=trueを明示してください。');
  process.exit(1);
}

if (imageProvider === 'mock') {
  console.log('画像: おためしモード（外部送信なし）');
} else {
  console.log('画像: Codex app-server / gpt-image-2（外部送信あり）');
  console.log('利用者: 成人テスト専用（未成年者には使用しない）');
  console.log('画像生成: ①〜④すべてCodex app-server経由');
}

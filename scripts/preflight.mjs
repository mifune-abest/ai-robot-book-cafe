import { config } from '../src/config.js';
import { CodexAppServerService } from '../src/services/codex-app-server.js';
import { localCompositorAssetsStatus } from '../src/services/local-compositor-assets.js';

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
  const imageProvider = process.env.IMAGE_PROVIDER || 'mock';
  const careerCardOutfitProvider = process.env.CAREER_CARD_OUTFIT_PROVIDER || imageProvider;
  if ((imageProvider === 'codex' || careerCardOutfitProvider === 'codex') && health.imageGeneration !== true) {
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
const careerCardOutfitProvider = process.env.CAREER_CARD_OUTFIT_PROVIDER || imageProvider;
if (!['mock', 'codex'].includes(careerCardOutfitProvider)) {
  console.error(`CAREER_CARD_OUTFIT_PROVIDERは mock または codex だけを指定できます: ${careerCardOutfitProvider}`);
  process.exit(1);
}
const careerCardCompositor = process.env.CAREER_CARD_COMPOSITOR || 'smart';
if (!['classic', 'smart'].includes(careerCardCompositor)) {
  console.error(`CAREER_CARD_COMPOSITORは classic または smart だけを指定できます: ${careerCardCompositor}`);
  process.exit(1);
}
const compositorHealth = localCompositorAssetsStatus(careerCardCompositor);
if (!compositorHealth.ready) {
  const details = [...(compositorHealth.missing || []), ...(compositorHealth.changed || [])].join(', ');
  console.error(`⑤のローカル顔合成モデルを利用できません${details ? `: ${details}` : ''}`);
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

if (careerCardOutfitProvider === 'codex') {
  console.log('⑤の服装: Codex app-server / gpt-image-2（職業名だけ外部送信・本人写真は送信しない）');
} else {
  console.log('⑤の服装: おためしモード');
}
console.log(`⑤の顔合成: ${careerCardCompositor === 'smart' ? 'PC内MediaPipe（本人写真の送信なし）' : '従来の固定楕円（手動退避設定）'}`);

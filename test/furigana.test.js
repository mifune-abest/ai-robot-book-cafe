import assert from 'node:assert/strict';
import test from 'node:test';
import { FuriganaService } from '../src/services/furigana-service.js';

const service = new FuriganaService();

test('漢字だけでなく送り仮名を含む言葉にも読みを分けて付ける', async () => {
  const segments = await service.annotate('画像を使っている箇所');

  assert.deepEqual(segments, [
    { text: '画像', reading: 'がぞう' },
    { text: 'を' },
    { text: '使', reading: 'つか' },
    { text: 'っている' },
    { text: '箇所', reading: 'かしょ' },
  ]);
});

test('AIが生成する複合的な職業名にも読みを付ける', async () => {
  const segments = await service.annotate('海の生き物を守る未来デザイナー');
  const readings = segments
    .filter((segment) => segment.reading)
    .map((segment) => `${segment.text}:${segment.reading}`);

  assert.deepEqual(readings, [
    '海:うみ',
    '生:い',
    '物:もの',
    '守:まも',
    '未来:みらい',
  ]);
});

test('漢字がない文言は表示を変えない', async () => {
  assert.deepEqual(await service.annotate('おおきく みる'), [{ text: 'おおきく みる' }]);
});

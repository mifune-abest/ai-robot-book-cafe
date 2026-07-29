import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDreamQuestion } from '../src/services/codex-app-server.js';

const safeQuestion = {
  text: 'どんな ふんいきに したい？',
  options: ['わくわくする', 'ほっとする', 'ふしぎな', 'にぎやかな'],
};

test('理想のAI質問は異なる4選択肢を受け付ける', () => {
  const result = validateDreamQuestion(safeQuestion, []);

  assert.equal(result.text, safeQuestion.text);
  assert.deepEqual(result.options, safeQuestion.options);
});

test('理想のAI質問は重複した質問・選択肢を受け付けない', () => {
  assert.throws(
    () => validateDreamQuestion({ ...safeQuestion, options: ['あお', 'あお', 'あか', 'きいろ'] }, []),
    /重複/,
  );
  assert.throws(
    () => validateDreamQuestion(safeQuestion, [{ question: safeQuestion.text, options: ['まる', 'しかく', 'ほし', 'ハート'], answer: 'まる' }]),
    /同じ質問/,
  );
  assert.throws(
    () => validateDreamQuestion(
      { text: 'つぎは どれに する？', options: safeQuestion.options },
      [{ question: 'ひとつめの しつもん？', options: safeQuestion.options, answer: safeQuestion.options[0] }],
    ),
    /同じ選択肢/,
  );
});

test('理想のAI質問は個人情報・外見・危険な内容を受け付けない', () => {
  for (const text of ['学校名を おしえて？', 'かおは どんな かたち？', '爆弾を どこに おく？']) {
    assert.throws(
      () => validateDreamQuestion({ ...safeQuestion, text }, []),
      undefined,
      text,
    );
  }
});

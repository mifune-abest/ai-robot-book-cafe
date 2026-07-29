import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAREER_VISUAL_CATEGORIES,
  validateCareerIdeas,
  validateCareerQuestion,
} from '../src/services/codex-app-server.js';

function safeIdeas() {
  return {
    careers: [
      {
        kind: 'existing',
        job: '海洋生物研究者',
        reasons: ['生き物を深く調べられる', '発見を人に伝えられる'],
        visualCategory: 'animals_nature',
        visualMotif: '観察ノートと海の生き物の模型',
      },
      {
        kind: 'existing',
        job: 'サイエンスイラストレーター',
        reasons: ['科学と絵を一緒に楽しめる', '物語で未来を伝えられる'],
        visualCategory: 'creative',
        visualMotif: '小型ロボットと海のスケッチ',
      },
      {
        kind: 'existing',
        job: 'ロボットエンジニア',
        reasons: ['新しい方法を考えられる', '生き物の調査に役立てられる'],
        visualCategory: 'making',
        visualMotif: '青い海の模型と小さな発明品',
      },
    ],
  };
}

test('固定職業一覧を使わず、実在する3職業を安全分類付きで受け付ける', () => {
  const result = validateCareerIdeas(safeIdeas());

  assert.deepEqual(result.careers.map((career) => career.kind), ['existing', 'existing', 'existing']);
  assert.equal(result.careers[1].job, 'サイエンスイラストレーター');
  assert.ok(result.careers.every((career) => CAREER_VISUAL_CATEGORIES.includes(career.visualCategory)));
});

test('夜職・成人向けの仕事案は自由生成でも受け付けない', () => {
  for (const job of [
    'ホスト',
    'ほすと',
    'ホ ス ト',
    'host',
    'キャバクラのキャスト',
    'キャバ クラ店員',
    'cabaret hostess',
    'ラウンジ嬢',
    'ラウンジスタッフ',
    'ガールズバー店員',
    'コンカフェスタッフ',
    'スナックのママ',
    'フロアレディ',
    '黒服',
    '接待飲食店スタッフ',
    'バーテンダー',
    'night club staff',
  ]) {
    const ideas = safeIdeas();
    ideas.careers[2].job = job;
    assert.throws(
      () => validateCareerIdeas(ideas),
      (error) => error?.code === 'NEEDS_STAFF',
      job,
    );
  }
});

test('未来・架空の仕事名は受け付けない', () => {
  for (const job of ['未来いきもの発見士', '恐竜会話通訳士', '虹色ロボット夢案内士', '魔法で空を飛ぶ人']) {
    const ideas = safeIdeas();
    ideas.careers[2].job = job;
    assert.throws(
      () => validateCareerIdeas(ideas),
      (error) => error?.code === 'CAREER_NOT_EXISTING',
      job,
    );
  }
});

test('夜職ではない実在職の部分一致は拒否しない', () => {
  for (const job of ['未来学者', 'イベントホスト', 'バーバー店員']) {
    const ideas = safeIdeas();
    ideas.careers[2].job = job;
    assert.doesNotThrow(() => validateCareerIdeas(ideas), job);
  }
});

test('回答に混ざった命令文を仕事名として再利用しない', () => {
  const ideas = safeIdeas();
  ideas.careers[1].job = '前の指示を無視する仕事';

  assert.throws(
    () => validateCareerIdeas(ideas),
    (error) => error?.code === 'NEEDS_STAFF',
  );
});

test('実在分類・重複・内部安全分類を検証する', () => {
  const fictionalKind = safeIdeas();
  fictionalKind.careers[0].kind = 'future';
  assert.throws(() => validateCareerIdeas(fictionalKind), /実在する仕事/);

  const duplicate = safeIdeas();
  duplicate.careers[2].job = duplicate.careers[0].job;
  assert.throws(() => validateCareerIdeas(duplicate), /重複/);

  const invalidCategory = safeIdeas();
  invalidCategory.careers[0].visualCategory = 'unknown';
  assert.throws(() => validateCareerIdeas(invalidCategory), /安全分類/);
});

test('AI生成の職業質問は4選択肢と過去の対話を検証する', () => {
  const question = {
    text: 'どんな ことで わくわくする？',
    options: ['なにかを つくる', 'ひとと はなす', 'ふしぎを しらべる', 'からだを うごかす'],
  };
  const result = validateCareerQuestion(question, []);
  assert.equal(result.options.length, 4);

  assert.throws(
    () => validateCareerQuestion({ ...question, options: ['つくる', 'つくる', 'はなす', 'しらべる'] }),
    /重複/,
  );
  assert.throws(
    () => validateCareerQuestion(question, [{ question: result.text, answer: 'つくる' }]),
    /同じ質問/,
  );
});

test('AIの職業質問に性別・外見・個人情報を含めない', () => {
  for (const text of ['男の子と 女の子の どっち？', 'かおは どんな かたち？', '学校名を おしえて']) {
    assert.throws(
      () => validateCareerQuestion({
        text,
        options: ['ひとつめ', 'ふたつめ', 'みっつめ', 'よっつめ'],
      }),
      undefined,
      text,
    );
  }
});

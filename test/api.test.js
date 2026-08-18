import assert from 'node:assert/strict';
import test from 'node:test';

const publicBaseUrl = normalizeBaseUrl(
  process.env.PUBLIC_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4410',
);
const hostBaseUrl = normalizeBaseUrl(
  process.env.HOST_BASE_URL || 'http://127.0.0.1:4411',
);

// Sharpで読み込める96バイトの2x2 PNG。写真APIの入力形式だけを安全かつ高速に確認する。
const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWPILjqZXXSSAUIBACy+BpkBZOd5AAAAAElFTkSuQmCC';

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, '');
}

async function request(baseUrl, pathname, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(
      `${baseUrl} に接続できません。APP_TEST_MODE=1、IMAGE_PROVIDER=mock、空のDATA_DIRでテストサーバーを起動してください。`,
      { cause: error },
    );
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, payload };
}

async function expectJson(baseUrl, pathname, options, expectedStatus = 200) {
  const result = await request(baseUrl, pathname, options);
  assert.equal(
    result.response.status,
    expectedStatus,
    `${options?.method || 'GET'} ${pathname}: ${JSON.stringify(result.payload)}`,
  );
  assert.match(result.response.headers.get('content-type') || '', /^application\/json\b/);
  return result.payload;
}

async function expectApiError(baseUrl, pathname, options, expectedStatus, expectedCode) {
  const payload = await expectJson(baseUrl, pathname, options, expectedStatus);
  assert.equal(payload.error?.code, expectedCode, JSON.stringify(payload));
  assert.equal(typeof payload.error?.message, 'string');
  assert.ok(payload.error.message.length > 0);
  return payload;
}

async function expectPng(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `画像を取得できません: ${pathname}`);
  assert.match(response.headers.get('content-type') || '', /^image\/png\b/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.ok(bytes.byteLength > 100, '生成画像が空に近すぎます。');
  assert.deepEqual(
    [...bytes.slice(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    '生成物がPNGではありません。',
  );
}

test('5画面とホスト分離の主要APIを一連の流れで確認する', { timeout: 120_000 }, async (t) => {
  // この2点はサブテスト化しない。失敗時は以降を止め、外部画像APIへの誤送信や
  // 前回データへの上書きを防ぐためのフェイルクローズ確認である。
  const health = await expectJson(publicBaseUrl, '/api/health');
  assert.equal(
    health.textAi?.model,
    'test-model',
    'APP_TEST_MODE=1で起動されていません。以降のAPIテストを中止します。',
  );
  assert.equal(
    health.image?.mode,
    'mock',
    '外部送信・課金を避けるため、APIテストはIMAGE_PROVIDER=mockで実行してください。',
  );
  assert.equal(health.queues?.image?.concurrency, 2);
  assert.equal(health.queues?.text?.concurrency, 2);
  assert.equal(health.careerCardOutfit?.mode, 'mock');
  assert.equal(health.careerCardOutfit?.ready, true);
  assert.equal(health.careerCardOutfit?.sendsParticipantPhoto, false);
  assert.equal(health.careerCardCompositor?.mode, 'smart');
  assert.equal(health.careerCardCompositor?.ready, true);
  assert.equal(health.careerCardCompositor?.localOnly, true);
  assert.equal(health.careerCardCompositor?.sendsParticipantPhoto, false);

  const initialHostState = await expectJson(hostBaseUrl, '/api/host/state');
  assert.equal(
    initialHostState.memory?.phase,
    'setup',
    '永続状態が残っています。空のDATA_DIRを指定してテストサーバーを再起動してください。',
  );
  assert.deepEqual(initialHostState.memory?.entries, []);

  await t.test('テストモードとホスト分離', async () => {
    assert.equal(health.textAi?.ok, true);

    const careerCardPage = await fetch(`${publicBaseUrl}/career-card`);
    assert.equal(careerCardPage.status, 200);
    assert.match(careerCardPage.headers.get('content-type') || '', /^text\/html\b/);
    assert.match(careerCardPage.headers.get('content-security-policy') || '', /worker-src 'self'/);
    assert.match(careerCardPage.headers.get('content-security-policy') || '', /wasm-unsafe-eval/);

    const mediaPipeRuntime = await fetch(`${publicBaseUrl}/vendor/mediapipe/vision_bundle.mjs`, { method: 'HEAD' });
    assert.equal(mediaPipeRuntime.status, 200);
    assert.match(mediaPipeRuntime.headers.get('content-type') || '', /javascript/);
    const faceModel = await fetch(`${publicBaseUrl}/models/face_landmarker.task`, { method: 'HEAD' });
    assert.equal(faceModel.status, 200);

    await expectApiError(publicBaseUrl, '/host', undefined, 404, 'NOT_FOUND');
    await expectApiError(publicBaseUrl, '/api/host/state', undefined, 404, 'NOT_FOUND');
    await expectApiError(
      publicBaseUrl,
      '/api/host/memory/open',
      { method: 'POST', body: {} },
      404,
      'NOT_FOUND',
    );

    assert.equal(initialHostState.memory?.phase, 'setup');
  });

  await t.test('全画面共通のふりがなをローカルで取得する', async () => {
    for (const baseUrl of [publicBaseUrl, hostBaseUrl]) {
      const result = await expectJson(baseUrl, '/api/furigana', {
        method: 'POST',
        body: { texts: ['画像を作っています', '歌手'] },
      });
      assert.deepEqual(result.items[0].segments, [
        { text: '画像', reading: 'がぞう' },
        { text: 'を' },
        { text: '作', reading: 'つく' },
        { text: 'っています' },
      ]);
      assert.deepEqual(result.items[1].segments, [{ text: '歌手', reading: 'かしゅ' }]);
    }

    await expectApiError(
      publicBaseUrl,
      '/api/furigana',
      { method: 'POST', body: { texts: [] } },
      400,
      'INVALID_FURIGANA_TEXTS',
    );
  });

  await t.test('ホスト設定の検証と危険・個人情報入力の拒否', async () => {
    await expectApiError(
      hostBaseUrl,
      '/api/host/settings',
      { method: 'POST', body: { genres: [], tables: [{ id: 'test-table', name: 'テスト', expected: 2 }] } },
      400,
      'INVALID_GENRES',
    );

    await expectApiError(
      hostBaseUrl,
      '/api/host/settings',
      { method: 'POST', body: { genres: ['いえ'], tables: [{ id: 'test-table', name: 'テスト', expected: 0 }] } },
      400,
      'INVALID_NUMBER',
    );

    await expectApiError(
      hostBaseUrl,
      '/api/host/settings',
      { method: 'POST', body: { genres: ['爆弾'], tables: [{ id: 'test-table', name: 'テスト', expected: 2 }] } },
      422,
      'NEEDS_STAFF',
    );

    await expectApiError(
      publicBaseUrl,
      '/api/dream/start',
      { method: 'POST', body: { genre: '爆弾のへや' } },
      422,
      'NEEDS_STAFF',
    );

    await expectApiError(
      publicBaseUrl,
      '/api/craft/generate',
      { method: 'POST', body: { style: 'かっこいい', idea: '電話番号は090-1234-5678' } },
      422,
      'PRIVATE_INFO',
    );

    const state = await expectJson(hostBaseUrl, '/api/host/settings', {
      method: 'POST',
      body: {
        genres: ['いえ', 'カフェ'],
        tables: [{ id: 'test-table', name: 'テストテーブル', expected: 2 }],
      },
    });
    assert.deepEqual(state.settings.genres, ['いえ', 'カフェ']);
    assert.deepEqual(state.settings.tables, [
      { id: 'test-table', name: 'テストテーブル', expected: 2 },
    ]);
  });

  await t.test('① 性別選択なしで、AI適応質問4回から実在する3職業を自由提案する', async () => {
    const config = await expectJson(publicBaseUrl, '/api/public-config');
    assert.equal('careerQuestions' in config, false, '固定職業質問を公開してはいけません。');
    assert.equal(config.careerCardCompositor, 'smart');

    const started = await expectJson(publicBaseUrl, '/api/career/start', {
      method: 'POST',
      body: {},
    });
    assert.match(started.sessionId, /^career_interview_/);
    assert.match(started.questionId, /^career_question_/);
    assert.equal(started.options?.length, 4);
    assert.equal(started.step, 1);
    assert.equal(started.total, 4);
    assert.doesNotMatch(JSON.stringify(started), /性別|男の子|女の子/);

    await expectApiError(publicBaseUrl, '/api/career/start', {
      method: 'POST',
      body: { gender: 'girl' },
    }, 400, 'GENDER_NOT_ACCEPTED');

    await expectApiError(publicBaseUrl, '/api/career/recommend', {
      method: 'POST',
      body: { sessionId: started.sessionId },
    }, 409, 'ANSWERS_INCOMPLETE');

    await expectApiError(publicBaseUrl, '/api/career/answer', {
      method: 'POST',
      body: { sessionId: started.sessionId, questionId: 'career_question_old', answer: started.options[0] },
    }, 409, 'CAREER_QUESTION_CHANGED');

    const firstRequest = {
      sessionId: started.sessionId,
      questionId: started.questionId,
      answer: 'ゲームがしたい',
    };
    let progress = await expectJson(publicBaseUrl, '/api/career/answer', {
      method: 'POST',
      body: firstRequest,
    });
    assert.equal(progress.ready, false);
    assert.equal(progress.step, 2);
    assert.equal(progress.options?.length, 4);
    const repeated = await expectJson(publicBaseUrl, '/api/career/answer', {
      method: 'POST',
      body: firstRequest,
    });
    assert.deepEqual(repeated, progress, '同じ回答の再送で次の質問を飛ばしてはいけません。');

    const otherStarted = await expectJson(publicBaseUrl, '/api/career/start', {
      method: 'POST',
      body: {},
    });
    assert.equal(otherStarted.question, started.question, '同じ履歴ならテスト用の最初のAI質問は同じです。');
    const otherProgress = await expectJson(publicBaseUrl, '/api/career/answer', {
      method: 'POST',
      body: {
        sessionId: otherStarted.sessionId,
        questionId: otherStarted.questionId,
        answer: otherStarted.options[1],
      },
    });
    assert.notEqual(otherProgress.question, progress.question, '前の興味回答に合わせて次の質問を変えてください。');

    while (progress.ready !== true) {
      progress = await expectJson(publicBaseUrl, '/api/career/answer', {
        method: 'POST',
        body: {
          sessionId: started.sessionId,
          questionId: progress.questionId,
          answer: progress.options[0],
        },
      });
    }
    assert.equal(progress.step, 4);

    const recommendation = await expectJson(publicBaseUrl, '/api/career/recommend', {
      method: 'POST',
      body: { sessionId: started.sessionId },
    });
    assert.equal(recommendation.careers?.length, 3);
    assert.deepEqual(recommendation.careers.map((career) => career.kind), ['existing', 'existing', 'existing']);
    assert.equal(new Set(recommendation.careers.map((career) => career.job)).size, 3);
    assert.match(recommendation.careers[0].job, /ゲーム/);
    assert.match(recommendation.careers[1].job, /ゲーム/);
    for (const career of recommendation.careers) {
      assert.match(career.careerId, /^career_/);
      assert.equal(typeof career.job, 'string');
      assert.equal(career.reasons?.length, 2);
      assert.equal('visualCategory' in career, false, '画像用の内部安全分類を公開してはいけません。');
      assert.equal('visualMotif' in career, false, '画像用の内部モチーフを公開してはいけません。');
      assert.equal('primaryInterestMatch' in career, false, '内部の興味一致判定を公開してはいけません。');
    }

    const repeatedRecommendation = await expectJson(publicBaseUrl, '/api/career/recommend', {
      method: 'POST',
      body: { sessionId: started.sessionId },
    });
    assert.deepEqual(
      repeatedRecommendation.careers.map((career) => career.careerId),
      recommendation.careers.map((career) => career.careerId),
      '候補の再取得でcareerIdを増殖させてはいけません。',
    );

    const selected = recommendation.careers[2];

    const outfit = await expectJson(publicBaseUrl, '/api/career-card/outfit', {
      method: 'POST',
      body: { careerId: selected.careerId },
    });
    assert.equal(outfit.mock, true);
    assert.equal(outfit.job, selected.job);
    assert.equal(outfit.participantPhotoSent, false);
    assert.deepEqual(outfit.faceSlot, {
      centerX: 0.5,
      centerY: 0.31,
      width: 0.34,
      height: 0.44,
      collarY: 0.52,
      eyeDistance: 0.108,
      eyeY: 0.315,
    });
    assert.ok(Object.values(outfit.faceSlot).every((value) => value > 0 && value < 1));
    assert.match(outfit.outfitUrl, /^\/media\/career_card_outfit_[A-Za-z0-9_-]+\.png$/);
    await expectPng(publicBaseUrl, outfit.outfitUrl);

    const repeatedOutfit = await expectJson(publicBaseUrl, '/api/career-card/outfit', {
      method: 'POST',
      body: { careerId: selected.careerId },
    });
    assert.equal(repeatedOutfit.outfitUrl, outfit.outfitUrl);

    await expectApiError(
      publicBaseUrl,
      '/api/career-card/outfit',
      { method: 'POST', body: { careerId: selected.careerId, photoDataUrl: tinyPngDataUrl } },
      400,
      'PHOTO_NOT_ACCEPTED',
    );

    const generated = await expectJson(publicBaseUrl, '/api/career/generate', {
      method: 'POST',
      body: { careerId: selected.careerId, photoDataUrl: tinyPngDataUrl },
    });
    assert.equal(generated.mock, true);
    assert.equal(generated.job, selected.job);
    assert.match(generated.resultUrl, /^\/media\/career_[A-Za-z0-9_-]+\.png$/);
    await expectPng(publicBaseUrl, generated.resultUrl);
  });

  await t.test('① 「アイドルになりたい」は安全な質問だけで深め、候補1へそのまま表示する', async () => {
    let progress = await expectJson(publicBaseUrl, '/api/career/start', {
      method: 'POST',
      body: {},
    });
    const sessionId = progress.sessionId;
    for (let index = 0; index < 4; index += 1) {
      progress = await expectJson(publicBaseUrl, '/api/career/answer', {
        method: 'POST',
        body: {
          sessionId,
          questionId: progress.questionId,
          answer: index === 0 ? 'アイドルになりたい' : progress.options[0],
        },
      });
      if (progress.ready === true) break;
      assert.doesNotMatch(
        JSON.stringify(progress),
        /見た目|顔|体型|衣装|化粧|髪型|肌/,
        'アイドル希望で外見に関する質問をしてはいけません。',
      );
    }
    assert.equal(progress.ready, true);
    const recommendation = await expectJson(publicBaseUrl, '/api/career/recommend', {
      method: 'POST',
      body: { sessionId },
    });
    assert.equal(recommendation.careers?.[0]?.job, 'アイドル');
    assert.match(
      recommendation.careers.slice(0, 2).flatMap((career) => career.reasons).join(' '),
      /歌|ダンス|ステージ/,
    );
  });

  await t.test('② かんたん・むずかしいの両方で工作完成イメージを生成する', async () => {
    const config = await expectJson(publicBaseUrl, '/api/public-config');
    assert.ok(config.materials?.length > 0, 'テスト用素材がありません。APP_TEST_MODE=1を確認してください。');

    const easy = await expectJson(publicBaseUrl, '/api/craft/generate', {
      method: 'POST',
      body: { mode: 'easy', style: 'かわいい', idea: '星のついた小物入れ' },
    });
    assert.equal(easy.mock, true);
    assert.match(easy.resultUrl, /^\/media\/craft_[A-Za-z0-9_-]+\.png$/);
    await expectPng(publicBaseUrl, easy.resultUrl);

    const hard = await expectJson(publicBaseUrl, '/api/craft/generate', {
      method: 'POST',
      body: { mode: 'hard', style: 'かっこいい', idea: '' },
    });
    assert.equal(hard.mock, true);
    await expectPng(publicBaseUrl, hard.resultUrl);

    await expectApiError(
      publicBaseUrl,
      '/api/craft/generate',
      { method: 'POST', body: { mode: 'expert', style: 'かわいい', idea: '' } },
      400,
      'INVALID_CHOICE',
    );
  });

  await t.test('③ 過去の回答に合わせたAI質問5回の完了後だけ理想の画像を生成する', async () => {
    const config = await expectJson(publicBaseUrl, '/api/public-config');
    assert.equal('dreamQuestions' in config, false, '固定の理想質問を公開してはいけません。');

    const started = await expectJson(publicBaseUrl, '/api/dream/start', {
      method: 'POST',
      body: { genre: 'カフェ' },
    });
    assert.match(started.sessionId, /^dream_/);
    assert.match(started.questionId, /^dream_question_/);
    assert.equal(started.step, 1);
    assert.equal(started.total, 5);
    assert.equal(started.options?.length, 4);

    await expectApiError(
      publicBaseUrl,
      '/api/dream/generate',
      { method: 'POST', body: { sessionId: started.sessionId } },
      409,
      'DREAM_NOT_READY',
    );

    await expectApiError(publicBaseUrl, '/api/dream/answer', {
      method: 'POST',
      body: {
        sessionId: started.sessionId,
        questionId: 'dream_question_old',
        answer: started.options[0],
      },
    }, 409, 'DREAM_QUESTION_CHANGED');

    const firstRequest = {
      sessionId: started.sessionId,
      questionId: started.questionId,
      answer: started.options[0],
    };
    let progress = await expectJson(publicBaseUrl, '/api/dream/answer', {
      method: 'POST',
      body: firstRequest,
    });
    assert.equal(progress.ready, false);
    assert.equal(progress.step, 2);
    assert.match(progress.questionId, /^dream_question_/);
    assert.equal(progress.options?.length, 4);

    const repeated = await expectJson(publicBaseUrl, '/api/dream/answer', {
      method: 'POST',
      body: firstRequest,
    });
    assert.deepEqual(repeated, progress, '同じ回答の再送で次の質問を飛ばしてはいけません。');

    const otherStarted = await expectJson(publicBaseUrl, '/api/dream/start', {
      method: 'POST',
      body: { genre: 'カフェ' },
    });
    const otherProgress = await expectJson(publicBaseUrl, '/api/dream/answer', {
      method: 'POST',
      body: {
        sessionId: otherStarted.sessionId,
        questionId: otherStarted.questionId,
        answer: otherStarted.options[1],
      },
    });
    assert.notEqual(otherProgress.question, progress.question, '直前の回答が違うときは次のAI質問を変えてください。');

    const questions = new Set([started.question, progress.question]);
    let finalRequest;
    let finalResponse;
    while (progress.ready !== true) {
      finalRequest = {
        sessionId: started.sessionId,
        questionId: progress.questionId,
        answer: progress.options[0],
      };
      progress = await expectJson(publicBaseUrl, '/api/dream/answer', {
        method: 'POST',
        body: finalRequest,
      });
      if (progress.ready !== true) {
        assert.match(progress.questionId, /^dream_question_/);
        assert.equal(progress.options?.length, 4);
        questions.add(progress.question);
      } else {
        finalResponse = progress;
      }
    }
    assert.equal(questions.size, 5, '5回すべて異なるAI質問にしてください。');
    assert.equal(finalResponse.step, 5);
    assert.equal(typeof finalResponse.title, 'string');

    const repeatedFinal = await expectJson(publicBaseUrl, '/api/dream/answer', {
      method: 'POST',
      body: finalRequest,
    });
    assert.deepEqual(repeatedFinal, finalResponse, '最終回答の再送で要約を作り直してはいけません。');

    const generated = await expectJson(publicBaseUrl, '/api/dream/generate', {
      method: 'POST',
      body: { sessionId: started.sessionId },
    });
    assert.equal(generated.mock, true);
    assert.match(generated.resultUrl, /^\/media\/dream_[A-Za-z0-9_-]+\.png$/);
    await expectPng(publicBaseUrl, generated.resultUrl);
  });

  await t.test('④ 未達では生成せず、全員分の登録・生成・手動公開後だけ公開する', async () => {
    let state = await expectJson(hostBaseUrl, '/api/host/memory/open', {
      method: 'POST',
      body: {},
    });
    assert.equal(state.memory.phase, 'collecting');

    state = await expectJson(hostBaseUrl, '/api/host/settings', {
      method: 'POST',
      body: {
        genres: ['いえ', 'カフェ'],
        tables: [{ id: 'test-table', name: 'テストテーブル', expected: 2 }],
      },
    });
    assert.equal(state.memory.phase, 'collecting');

    const mistaken = await expectJson(
      publicBaseUrl,
      '/api/memory/entries',
      {
        method: 'POST',
        body: { tableId: 'test-table', nickname: 'まちがい', prompt: '入力をまちがえた' },
      },
      201,
    );
    assert.match(mistaken.entryId, /^memory_/);
    state = await expectJson(hostBaseUrl, `/api/host/memory/entries/${mistaken.entryId}/remove`, {
      method: 'POST', body: {},
    });
    assert.equal(state.progress.received, 0);

    await expectJson(publicBaseUrl, '/api/memory/entries', {
      method: 'POST',
      body: { tableId: 'test-table', nickname: 'あお', prompt: '本を読んで楽しかった' },
    }, 201);

    state = await expectJson(hostBaseUrl, '/api/host/memory/close', {
      method: 'POST',
      body: {},
    });
    assert.equal(state.memory.phase, 'locked');
    assert.equal(state.progress.expected, 2);
    assert.equal(state.progress.received, 1);
    assert.equal(state.canGenerate, false);

    await expectApiError(
      hostBaseUrl,
      '/api/host/memory/generate',
      { method: 'POST', body: {} },
      409,
      'MEMORY_INCOMPLETE',
    );

    await expectJson(hostBaseUrl, '/api/host/memory/open', { method: 'POST', body: {} });
    await expectJson(
      publicBaseUrl,
      '/api/memory/entries',
      {
        method: 'POST',
        body: { tableId: 'test-table', nickname: 'きいろ', prompt: 'デニム工作がうれしかった' },
      },
      201,
    );

    state = await expectJson(hostBaseUrl, '/api/host/memory/close', {
      method: 'POST',
      body: {},
    });
    assert.equal(state.progress.expected, 2);
    assert.equal(state.progress.received, 2);
    assert.equal(state.progress.complete, true);
    assert.equal(state.canGenerate, true);

    state = await expectJson(hostBaseUrl, '/api/host/memory/generate', {
      method: 'POST',
      body: {},
    });
    assert.equal(state.memory.phase, 'review');
    assert.equal(state.memory.renderedCount, 2);
    assert.equal(state.canGenerate, true);
    assert.match(state.memory.resultUrl, /^\/media\/memory_final_[A-Za-z0-9_-]+\.png$/);

    const beforePublish = await expectJson(publicBaseUrl, '/api/memory/status');
    assert.equal(beforePublish.phase, 'review');
    assert.equal(beforePublish.resultUrl, null, 'ホストが公開する前に結果が見えています。');
    const privateName = state.memory.resultUrl.split('/').pop();
    await expectApiError(publicBaseUrl, state.memory.resultUrl, undefined, 404, 'NOT_PUBLISHED');
    await expectApiError(publicBaseUrl, `/media//${privateName}`, undefined, 404, 'NOT_PUBLISHED');

    state = await expectJson(hostBaseUrl, '/api/host/memory/publish', {
      method: 'POST',
      body: {},
    });
    assert.equal(state.memory.phase, 'published');
    assert.equal(state.memory.renderedCount, state.progress.expected);

    const published = await expectJson(publicBaseUrl, '/api/memory/status');
    assert.equal(published.phase, 'published');
    assert.equal(published.expected, 2);
    assert.equal(published.received, 2);
    assert.equal(published.resultUrl, state.memory.resultUrl);
    await expectPng(publicBaseUrl, published.resultUrl);

    state = await expectJson(hostBaseUrl, '/api/host/memory/unpublish', {
      method: 'POST', body: {},
    });
    assert.equal(state.memory.phase, 'review');
    await expectApiError(publicBaseUrl, published.resultUrl, undefined, 404, 'NOT_PUBLISHED');

    state = await expectJson(hostBaseUrl, '/api/host/memory/reset', {
      method: 'POST', body: {},
    });
    assert.equal(state.memory.phase, 'setup');
    assert.deepEqual(state.memory.entries, []);
    await expectApiError(publicBaseUrl, published.resultUrl, undefined, 404, 'NOT_PUBLISHED');
  });
});

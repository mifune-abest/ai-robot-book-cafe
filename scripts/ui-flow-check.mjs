import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const screenshotDir = path.join(projectDir, 'docs', 'screenshots');
const publicBase = (process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4410').replace(/\/$/, '');
const hostBase = (process.env.HOST_BASE_URL || 'http://127.0.0.1:4411').replace(/\/$/, '');
const errors = [];

await fs.mkdir(screenshotDir, { recursive: true });

async function jsonRequest(base, pathname, body = undefined) {
  const response = await fetch(`${base}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${pathname}: ${JSON.stringify(payload)}`);
  return payload;
}

function watch(page, name) {
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
  });
}

async function assertFurigana(page, name) {
  let missing = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(200);
    missing = await page.evaluate(() => {
      const kanji = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆ヶ]/u;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const values = [];
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        const text = node.nodeValue || '';
        const option = parent?.closest('option');
        const skipped = parent?.closest('script, style, noscript, ruby, rt');
        const hidden = !parent || parent.getClientRects().length === 0;
        const optionAnnotated = option && option.dataset.furiganaDisplay === text;
        if (kanji.test(text) && !skipped && !hidden && !optionAnnotated) {
          values.push(text.trim().slice(0, 80));
        }
        node = walker.nextNode();
      }
      return values.filter(Boolean);
    });
    if (!missing.length) return;
  }
  throw new Error(`${name}: ふりがな未設定 ${missing.join(' / ')}`);
}

async function clickFirstAnswer(page) {
  const button = page.locator('[data-answer-index]').first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
}

await jsonRequest(hostBase, '/api/host/memory/reset', {});
await jsonRequest(hostBase, '/api/host/settings', {
  eventName: 'AI ROBOT BOOK CAFE',
  genres: ['いえ', 'カフェ'],
  freeModeEnabled: true,
  tables: [{ id: 'ui-table', name: 'テストテーブル', expected: 1 }],
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });

try {
  const career = await context.newPage();
  watch(career, 'career-flow');
  let careerStartPayload;
  career.on('request', (request) => {
    if (request.url().endsWith('/api/career/start') && request.method() === 'POST') {
      careerStartPayload = request.postDataJSON();
    }
  });
  await career.goto(`${publicBase}/career`);
  for (let index = 0; index < 5; index += 1) await clickFirstAnswer(career);
  await assertFurigana(career, 'career-recommendations');
  if (!careerStartPayload || 'gender' in careerStartPayload) {
    throw new Error('性別の選択値をサーバーへ送っています。');
  }
  await career.locator('[data-career-index]').first().click();
  const file = career.locator('#career-photo-file');
  await file.waitFor({ state: 'attached' });
  await file.setInputFiles({
    name: 'dummy.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWPILjqZXXSSAUIBACy+BpkBZOd5AAAAAElFTkSuQmCC', 'base64'),
  });
  await career.route('**/api/career/generate', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });
  await career.locator('#generate-career').click();
  const careerProgress = career.locator('#career-image-progress');
  await careerProgress.waitFor({ state: 'visible', timeout: 2_000 });
  if ((await careerProgress.getAttribute('aria-valuemax')) !== '100') {
    throw new Error('職業画像の待ち時間バーが正しく表示されていません。');
  }
  if (!/\u3042\u3068 \u7d04\d+\u5206|\u3082\u3046\u3059\u3050/.test(await career.locator('#career-image-time').innerText())) {
    throw new Error('職業画像の完成時間の目安が表示されていません。');
  }
  await career.locator('#print-career').waitFor({ state: 'visible', timeout: 15_000 });
  await assertFurigana(career, 'career-result');
  await career.screenshot({ path: path.join(screenshotDir, 'flow-career-result-1366x768.png'), fullPage: true });
  await career.emulateMedia({ media: 'print' });
  if (!(await career.locator('.career-print-label').isVisible())) {
    throw new Error('印刷時のAI生成表示が見つかりません。');
  }
  await career.emulateMedia({ media: 'screen' });

  const craft = await context.newPage();
  watch(craft, 'craft-flow');
  await craft.goto(`${publicBase}/craft`);
  await craft.locator('[data-craft-style]').first().click();
  await craft.locator('#craft-fullscreen').waitFor({ state: 'visible', timeout: 15_000 });
  await assertFurigana(craft, 'craft-result');
  await craft.screenshot({ path: path.join(screenshotDir, 'flow-craft-result-1366x768.png'), fullPage: true });

  const dream = await context.newPage();
  watch(dream, 'dream-flow');
  await dream.goto(`${publicBase}/dream`);
  await dream.locator('[data-dream-genre]').first().click();
  const dreamQuestions = new Set();
  for (let index = 0; index < 5; index += 1) {
    const choices = dream.locator('[data-answer-index]');
    await choices.first().waitFor({ state: 'visible', timeout: 10_000 });
    if ((await choices.count()) !== 4) throw new Error(`dream-flow: ${index + 1}問目が4選択肢ではありません。`);
    await assertFurigana(dream, `dream-question-${index + 1}`);
    dreamQuestions.add((await dream.locator('h1').innerText()).trim());
    await choices.first().click();
  }
  if (dreamQuestions.size !== 5) throw new Error('dream-flow: 5回すべて異なる質問が表示されませんでした。');
  await dream.locator('#dream-fullscreen').waitFor({ state: 'visible', timeout: 15_000 });
  await assertFurigana(dream, 'dream-result');
  await dream.screenshot({ path: path.join(screenshotDir, 'flow-dream-result-1366x768.png'), fullPage: true });

  const invalidDream = await context.newPage();
  watch(invalidDream, 'dream-invalid-response');
  await invalidDream.route('**/api/dream/start', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sessionId: 'dream_invalid', options: [] }),
  }));
  await invalidDream.goto(`${publicBase}/dream`);
  await invalidDream.locator('[data-dream-genre]').first().click();
  await invalidDream.locator('#error-retry').waitFor({ state: 'visible', timeout: 5_000 });
  if ((await invalidDream.locator('[data-answer-index]').count()) !== 0) {
    throw new Error('dream-invalid-response: 不正なAI応答から固定質問へ切り替わりました。');
  }

  await jsonRequest(hostBase, '/api/host/memory/open', {});
  const memory = await context.newPage();
  watch(memory, 'memory-flow');
  await memory.goto(`${publicBase}/memory`);
  await memory.selectOption('#memory-table', 'ui-table');
  await memory.fill('#memory-nickname', 'あお');
  await memory.fill('#memory-prompt', 'ロボットと本がたのしかった');
  await memory.locator('#memory-submit').click();
  await memory.locator('#memory-next').waitFor({ state: 'visible', timeout: 10_000 });
  await assertFurigana(memory, 'memory-thanks');

  const host = await context.newPage();
  watch(host, 'host-flow');
  host.on('dialog', (dialog) => dialog.accept());
  await host.goto(`${hostBase}/host`);
  await host.locator('#host-memory-close').click();
  await host.locator('#host-memory-generate').waitFor({ state: 'visible' });
  await host.locator('#host-memory-generate').click();
  await host.locator('#check-people').waitFor({ state: 'visible', timeout: 15_000 });
  await host.check('#check-people');
  await host.check('#check-bright');
  await host.locator('#host-memory-publish').click();
  await host.getByText('この画像を公開しています。').waitFor({ state: 'visible', timeout: 10_000 });
  await assertFurigana(host, 'host-published');
  await host.screenshot({ path: path.join(screenshotDir, 'flow-host-published-1366x768.png'), fullPage: true });

  await memory.reload();
  await memory.locator('#memory-fullscreen').waitFor({ state: 'visible', timeout: 10_000 });
  await assertFurigana(memory, 'memory-published');
  await memory.screenshot({ path: path.join(screenshotDir, 'flow-memory-published-1366x768.png'), fullPage: true });
} finally {
  await browser.close();
  await jsonRequest(hostBase, '/api/host/memory/reset', {}).catch(() => undefined);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('実バックエンド結合UIフロー: ①②③④とホスト公開まで成功');
  console.log(`結果スクリーンショット: ${screenshotDir}`);
}

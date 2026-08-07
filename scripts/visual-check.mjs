import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const screenshotDir = path.join(projectDir, 'docs', 'screenshots');
const publicBase = (process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4410').replace(/\/$/, '');
const hostBase = (process.env.HOST_BASE_URL || 'http://127.0.0.1:4411').replace(/\/$/, '');

await fs.mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const checks = [];

async function furiganaState(page) {
  return page.evaluate(() => {
    const kanji = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆ヶ]/u;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const missing = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const text = node.nodeValue || '';
      const option = parent?.closest('option');
      const skipped = parent?.closest('script, style, noscript, ruby, rt');
      const hidden = !parent || parent.getClientRects().length === 0;
      const optionAnnotated = option && option.dataset.furiganaDisplay === text;
      if (kanji.test(text) && !skipped && !hidden && !optionAnnotated) {
        missing.push(text.trim().slice(0, 80));
      }
      node = walker.nextNode();
    }
    return {
      count: document.querySelectorAll('ruby[data-furigana="true"]').length,
      missing: missing.filter(Boolean),
    };
  });
}

async function capture({ name, base, route, width, height }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: console ${message.text()}`);
  });
  const response = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  if (!response?.ok()) errors.push(`${name}: HTTP ${response?.status()}`);
  await page.waitForTimeout(900);
  const furigana = await furiganaState(page);
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    title: document.querySelector('h1')?.textContent?.trim() || '',
    loading: document.body.textContent?.includes('じゅんび中…') || false,
  }));
  const noHorizontalOverflow = layout.scrollWidth <= layout.width + 1;
  checks.push({ name, viewport: `${width}x${height}`, title: layout.title, noHorizontalOverflow, furigana: furigana.count });
  if (!noHorizontalOverflow) errors.push(`${name}: 横スクロール ${layout.scrollWidth}px > ${layout.width}px`);
  if (!layout.title || layout.loading) errors.push(`${name}: 初期画面の読み込み未完了`);
  if (furigana.missing.length) errors.push(`${name}: ふりがな未設定 ${furigana.missing.join(' / ')}`);
  await page.screenshot({ path: path.join(screenshotDir, `${name}-${width}x${height}.png`), fullPage: true });
  await context.close();
}

async function captureCareerRecommendations({ width, height }) {
  const name = 'career-recommendations';
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: console ${message.text()}`);
  });
  await page.goto(`${publicBase}/career`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  for (let index = 0; index < 4; index += 1) {
    const button = page.locator('[data-answer-index]').first();
    await button.waitFor({ state: 'visible', timeout: 10_000 });
    await button.click();
  }
  await page.locator('[data-career-index]').first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300);
  const furigana = await furiganaState(page);
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    title: document.querySelector('h1')?.textContent?.trim() || '',
    cardCount: document.querySelectorAll('[data-career-index]').length,
    kindLabels: [...document.querySelectorAll('.recommendation-card__kind')]
      .map((element) => element.textContent?.trim()),
  }));
  const noHorizontalOverflow = layout.scrollWidth <= layout.width + 1;
  checks.push({ name, viewport: `${width}x${height}`, title: layout.title, noHorizontalOverflow, furigana: furigana.count });
  if (!noHorizontalOverflow) errors.push(`${name}: 横スクロール ${layout.scrollWidth}px > ${layout.width}px`);
  if (furigana.missing.length) errors.push(`${name}: ふりがな未設定 ${furigana.missing.join(' / ')}`);
  if (layout.cardCount !== 3) errors.push(`${name}: 職業候補が${layout.cardCount}件です`);
  if (layout.kindLabels.join('|') !== 'じっさいに ある しごと|じっさいに ある しごと|じっさいに ある しごと') {
    errors.push(`${name}: 実在職業の表示が不正です: ${layout.kindLabels.join('|')}`);
  }
  await page.screenshot({ path: path.join(screenshotDir, `${name}-${width}x${height}.png`), fullPage: true });
  await context.close();
}

try {
  const publicRoutes = [
    ['home', '/'],
    ['career', '/career'],
    ['craft', '/craft'],
    ['dream', '/dream'],
    ['memory', '/memory'],
  ];
  for (const [name, route] of publicRoutes) {
    await capture({ name, route, base: publicBase, width: 1366, height: 768 });
    await capture({ name, route, base: publicBase, width: 390, height: 844 });
  }
  await captureCareerRecommendations({ width: 1366, height: 768 });
  await captureCareerRecommendations({ width: 390, height: 844 });
  await capture({ name: 'host', route: '/host', base: hostBase, width: 1366, height: 768 });
} finally {
  await browser.close();
}

for (const result of checks) {
  console.log(`${result.name} ${result.viewport}: ${result.noHorizontalOverflow ? '横スクロールなし' : '要修正'} / ふりがな${result.furigana}件 / ${result.title}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`視覚確認用スクリーンショット: ${screenshotDir}`);
}

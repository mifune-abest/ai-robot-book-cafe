import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import { config, listLanAddresses, projectRoot } from './config.js';
import { AppError, errorPayload } from './lib/errors.js';
import { assertChildSafe } from './lib/safety.js';
import { TaskQueue } from './lib/task-queue.js';
import { cleanOptionalText, cleanText, integer, oneOf, parseDataUrl, randomId } from './lib/validation.js';
import { ImageService } from './services/image-service.js';
import { CodexAppServerService } from './services/codex-app-server.js';
import { FuriganaService } from './services/furigana-service.js';
import { createMemoryPoster } from './services/memory-poster.js';
import { JsonStore } from './store.js';

sharp.cache(false);

const publicDir = path.join(projectRoot, 'public');
const store = new JsonStore(config.dataDir);
const textAi = new CodexAppServerService(config);
const images = new ImageService(config, textAi);
const furigana = new FuriganaService();
const imageQueue = new TaskQueue({ concurrency: 1, maxPending: 20 });
const textQueue = new TaskQueue({ concurrency: 1, maxPending: 40 });

const careerSessions = new Map();
const careerInterviewSessions = new Map();
const dreamSessions = new Map();
const CAREER_ADAPTIVE_QUESTION_COUNT = 4;
const CAREER_TOTAL_STEPS = CAREER_ADAPTIVE_QUESTION_COUNT + 1;
const DREAM_QUESTION_COUNT = 5;

function sessionCleanup() {
  const cutoff = Date.now() - 45 * 60 * 1000;
  for (const [id, value] of careerSessions) {
    if (value.createdAt < cutoff) {
      careerSessions.delete(id);
      store.deleteMediaUrl(value.resultUrl).catch(() => undefined);
    }
  }
  for (const [id, value] of careerInterviewSessions) {
    if (value.createdAt < cutoff) careerInterviewSessions.delete(id);
  }
  for (const [id, value] of dreamSessions) if (value.createdAt < cutoff) dreamSessions.delete(id);
}
setInterval(sessionCleanup, 10 * 60 * 1000).unref();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function registerFuriganaRoute(app) {
  app.post('/api/furigana', asyncRoute(async (req, res) => {
    const texts = req.body?.texts;
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 80) {
      throw new AppError('INVALID_FURIGANA_TEXTS', '読み方を確認できませんでした。', 400);
    }
    if (texts.some((text) => typeof text !== 'string' || text.length > 500)) {
      throw new AppError('INVALID_FURIGANA_TEXT', '読み方を確認できませんでした。', 400);
    }
    const totalLength = texts.reduce((total, text) => total + text.length, 0);
    if (totalLength > 8_000) {
      throw new AppError('FURIGANA_TEXT_TOO_LONG', '読み方を確認できませんでした。', 400);
    }
    res.json({ items: await furigana.annotateMany(texts) });
  }));
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  next();
}

function rateLimiter({ max = 180, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  setInterval(() => buckets.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const count = (buckets.get(key) || 0) + 1;
    buckets.set(key, count);
    if (count > max) return next(new AppError('TOO_MANY_REQUESTS', '少しまってから ためしてください。', 429));
    next();
  };
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error instanceof AppError ? error.status : 500;
  if (!(error instanceof AppError)) {
    console.error(JSON.stringify({ level: 'error', event: 'request_failed', path: req.path, error: error.name, message: error.message }));
  }
  res.status(status).json(errorPayload(error));
}

function findMaterialFile(url) {
  const name = path.basename(url);
  const file = path.join(store.materialDir, name);
  if (!file.startsWith(store.materialDir)) throw new AppError('MATERIAL_NOT_FOUND', '素材が見つかりません。', 404);
  return file;
}

function isLoopbackAddress(value = '') {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function canReceivePrivatePhoto(req) {
  return config.testMode || Boolean(req.secure || req.socket.encrypted) || isLoopbackAddress(req.socket.remoteAddress);
}

function requestedMediaName(req) {
  let decoded = req.path;
  try { decoded = decodeURIComponent(decoded); } catch { /* 不正なエスケープはそのまま扱う */ }
  return path.posix.basename(decoded.replaceAll('\\', '/'));
}

async function normalizedJpeg(dataUrl, maxBytes = 6_000_000) {
  const parsed = parseDataUrl(dataUrl, { maxBytes });
  try {
    const buffer = await sharp(parsed.buffer, { limitInputPixels: 28_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return { buffer, mime: 'image/jpeg' };
  } catch {
    throw new AppError('PHOTO_BROKEN', '写真を読み込めません。撮り直してください。');
  }
}

function publicConfig() {
  const state = store.read();
  return {
    eventName: state.settings.eventName,
    genres: state.settings.genres,
    freeModeEnabled: state.settings.freeModeEnabled !== false,
    craftStyles: state.settings.craftStyles,
    tables: state.settings.tables.map(({ id, name }) => ({ id, name })),
    materials: state.materials.filter((item) => item.active).map(({ id, name, url }) => ({ id, name, url })),
    imageMode: images.status().mode,
    audienceMode: images.status().adultTestMode ? 'adult-test' : 'standard',
  };
}

function memoryProgress(state) {
  const tables = state.settings.tables.map((table) => {
    const received = state.memory.entries.filter((entry) => entry.tableId === table.id).length;
    return { id: table.id, name: table.name, expected: table.expected, received, complete: received === table.expected };
  });
  const expected = tables.reduce((sum, table) => sum + table.expected, 0);
  const received = state.memory.entries.length;
  return { tables, expected, received, complete: expected > 0 && expected === received && tables.every((table) => table.complete) };
}

function publicMemoryStatus() {
  const state = store.read();
  const progress = memoryProgress(state);
  return {
    eventName: state.settings.eventName,
    phase: state.memory.phase,
    tables: progress.tables.map(({ id, name, expected, received }) => ({ id, name, expected, received })),
    expected: progress.expected,
    received: progress.received,
    resultUrl: state.memory.phase === 'published' ? state.memory.resultUrl : null,
  };
}

async function ensureTestMaterials() {
  if (!config.testMode || store.read().materials.length) return;
  const samples = [
    ['sample-denim', 'デニムのきれ', '#31597A'],
    ['sample-button', 'カラーボタン', '#F05A47'],
    ['sample-rope', 'ひも', '#D79B66'],
  ];
  for (const [id, name, color] of samples) {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="500"><rect width="700" height="500" fill="#FFF8E8"/><rect x="90" y="70" width="520" height="360" rx="40" fill="${color}"/><path d="M90 115h520M135 70v360" stroke="white" stroke-width="9" stroke-dasharray="18 15" opacity=".7"/><text x="350" y="275" text-anchor="middle" font-family="sans-serif" font-size="52" fill="white">${name}</text></svg>`);
    const buffer = await sharp(svg).jpeg({ quality: 88 }).toBuffer();
    const url = await store.saveMaterial(id, buffer, 'jpg');
    await store.update((state) => state.materials.push({ id, name, url, active: true, mime: 'image/jpeg' }));
  }
}

function createPublicApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(securityHeaders);
  app.use('/api', rateLimiter());
  app.use(express.json({ limit: '9mb', type: 'application/json' }));

  app.get('/api/health', asyncRoute(async (req, res) => {
    const textHealth = await textAi.health();
    const imageHealth = images.status();
    res.json({
      textAi: config.testMode ? textHealth : { ok: textHealth.ok, ...(textHealth.ok ? { model: textHealth.model } : { reason: textHealth.reason }) },
      image: {
        mode: imageHealth.mode,
        ready: imageHealth.ready && (imageHealth.mode !== 'codex' || textHealth.imageGeneration === true),
        external: imageHealth.external,
        ...(imageHealth.model ? { model: imageHealth.model } : {}),
        ...(imageHealth.adultTestMode ? { audience: 'adult-test' } : {}),
      },
      queues: { text: textQueue.status(), image: imageQueue.status() },
    });
  }));
  app.get('/api/public-config', (req, res) => res.json(publicConfig()));
  registerFuriganaRoute(app);

  app.post('/api/career/start', asyncRoute(async (req, res) => {
    if (req.body && Object.hasOwn(req.body, 'gender')) {
      throw new AppError('GENDER_NOT_ACCEPTED', 'せいべつは しごとを きめるために おくらないよ。');
    }
    const sessionId = randomId('career_interview_');
    const question = await textQueue.run(() => textAi.nextCareerQuestion({ history: [], step: 0 }));
    const questionId = randomId('career_question_');
    careerInterviewSessions.set(sessionId, {
      history: [],
      currentQuestion: { id: questionId, ...question },
      status: 'asking',
      lastAnswer: null,
      createdAt: Date.now(),
    });
    res.json({
      sessionId,
      questionId,
      question: question.text,
      options: question.options,
      step: 2,
      total: CAREER_TOTAL_STEPS,
    });
  }));

  app.post('/api/career/answer', asyncRoute(async (req, res) => {
    const sessionId = cleanText(req.body?.sessionId, { field: 'セッション', max: 80 });
    const questionId = cleanText(req.body?.questionId, { field: 'しつもん', max: 80 });
    const session = careerInterviewSessions.get(sessionId);
    if (!session) throw new AppError('SESSION_EXPIRED', 'さいしょから ためしてください。', 410);
    const answer = assertChildSafe(cleanText(req.body?.answer, { field: 'こたえ', max: 60 }));
    if (
      session.lastAnswer?.questionId === questionId
      && session.lastAnswer.answer === answer
    ) {
      return res.json(session.lastAnswer.response);
    }
    if (session.status !== 'asking') {
      throw new AppError('CAREER_INTERVIEW_READY', 'もう しつもんに こたえています。', 409);
    }
    if (session.busy) throw new AppError('CAREER_BUSY', 'いま つぎのしつもんを かんがえています。', 409);
    if (session.currentQuestion?.id !== questionId) {
      throw new AppError('CAREER_QUESTION_CHANGED', 'あたらしい しつもんに こたえてね。', 409);
    }

    const nextHistory = [
      ...session.history,
      { question: session.currentQuestion.text, answer },
    ];
    if (nextHistory.length > CAREER_ADAPTIVE_QUESTION_COUNT) {
      throw new AppError('CAREER_INTERVIEW_READY', 'もう しつもんに こたえています。', 409);
    }
    session.busy = true;
    session.createdAt = Date.now();
    try {
      if (nextHistory.length === CAREER_ADAPTIVE_QUESTION_COUNT) {
        const response = { ready: true, step: CAREER_TOTAL_STEPS, total: CAREER_TOTAL_STEPS };
        session.history = nextHistory;
        session.currentQuestion = null;
        session.status = 'ready';
        session.lastAnswer = { questionId, answer, response };
        return res.json(response);
      }

      const question = await textQueue.run(() => textAi.nextCareerQuestion({
        history: nextHistory,
        step: nextHistory.length,
      }));
      const nextQuestionId = randomId('career_question_');
      const response = {
        ready: false,
        questionId: nextQuestionId,
        question: question.text,
        options: question.options,
        step: nextHistory.length + 2,
        total: CAREER_TOTAL_STEPS,
      };
      session.history = nextHistory;
      session.currentQuestion = { id: nextQuestionId, ...question };
      session.lastAnswer = { questionId, answer, response };
      return res.json(response);
    } finally {
      session.busy = false;
    }
  }));

  app.post('/api/career/recommend', asyncRoute(async (req, res) => {
    const sessionId = cleanText(req.body?.sessionId, { field: 'セッション', max: 80 });
    const interview = careerInterviewSessions.get(sessionId);
    if (!interview) throw new AppError('SESSION_EXPIRED', 'さいしょから ためしてください。', 410);
    if (interview.status === 'done') return res.json(interview.careersResponse);
    if (interview.status === 'recommending') {
      throw new AppError('CAREER_BUSY', 'いま しごとを さがしています。', 409);
    }
    if (interview.status !== 'ready' || interview.history.length !== CAREER_ADAPTIVE_QUESTION_COUNT) {
      throw new AppError('ANSWERS_INCOMPLETE', 'しつもんに ぜんぶこたえてください。', 409);
    }
    interview.status = 'recommending';
    interview.createdAt = Date.now();
    try {
      const transcript = interview.history.map((item) => `Q:${item.question} A:${item.answer}`);
      const recommendation = await textQueue.run(() => textAi.recommendCareer(transcript));
      const careers = recommendation.careers.map((career) => {
        const careerId = randomId('career_');
        careerSessions.set(careerId, {
          ...career,
          createdAt: Date.now(),
          status: 'ready',
          resultUrl: null,
        });
        return {
          careerId,
          job: career.job,
          reasons: career.reasons,
          kind: career.kind,
        };
      });
      interview.careersResponse = { careers };
      interview.status = 'done';
      interview.history = [];
      interview.currentQuestion = null;
      interview.lastAnswer = null;
      return res.json(interview.careersResponse);
    } catch (error) {
      interview.status = 'ready';
      throw error;
    }
  }));

  app.post('/api/career/generate', asyncRoute(async (req, res) => {
    if (!canReceivePrivatePhoto(req)) {
      throw new AppError('HTTPS_REQUIRED', 'しゃしんはHTTPSのときだけ送れます。スタッフを呼んでください。', 426);
    }
    const careerId = cleanText(req.body?.careerId, { field: 'しごと', max: 60 });
    const session = careerSessions.get(careerId);
    if (!session) throw new AppError('SESSION_EXPIRED', 'さいしょから ためしてください。', 410);
    if (session.status === 'done') return res.json({ resultUrl: session.resultUrl, mock: images.status().mode === 'mock' });
    if (session.status === 'generating') throw new AppError('ALREADY_GENERATING', 'いま つくっています。', 409);
    session.status = 'generating';
    session.createdAt = Date.now();
    try {
      const photo = await normalizedJpeg(req.body?.photoDataUrl);
      const buffer = await imageQueue.run(() => images.career({
        job: session.job,
        visualCategory: session.visualCategory,
        visualMotif: session.visualMotif,
        photo,
      }));
      const resultUrl = await store.saveMedia(randomId('career_'), buffer, 'png');
      Object.assign(session, { status: 'done', resultUrl, createdAt: Date.now() });
      res.json({ resultUrl, job: session.job, mock: images.status().mode === 'mock' });
    } catch (error) {
      session.status = 'ready';
      throw error;
    }
  }));

  app.post('/api/craft/generate', asyncRoute(async (req, res) => {
    const state = store.read();
    const style = oneOf(cleanText(req.body?.style, { field: 'ふんいき', max: 20 }), state.settings.craftStyles, 'ふんいき');
    const idea = assertChildSafe(cleanOptionalText(req.body?.idea, { field: 'ことば', max: 40 }));
    const active = state.materials.filter((item) => item.active);
    if (!active.length) throw new AppError('MATERIALS_NOT_READY', 'そざいを じゅんび中です。スタッフを呼んでください。', 409);
    const materials = await Promise.all(active.map(async (item) => ({
      ...item,
      buffer: await fs.promises.readFile(findMaterialFile(item.url)),
      mime: item.mime || 'image/jpeg',
    })));
    const buffer = await imageQueue.run(() => images.craft({ style, idea, materials }));
    const resultUrl = await store.saveMedia(randomId('craft_'), buffer, 'png');
    res.json({ resultUrl, mock: images.status().mode === 'mock' });
  }));

  app.post('/api/dream/start', asyncRoute(async (req, res) => {
    const state = store.read();
    const supplied = cleanText(req.body?.genre, { field: 'つくるもの', max: 24 });
    if (!state.settings.genres.includes(supplied) && state.settings.freeModeEnabled === false) {
      throw new AppError('FREE_MODE_DISABLED', 'えらべるジャンルから えらんでください。', 409);
    }
    const genre = state.settings.genres.includes(supplied) ? supplied : assertChildSafe(supplied);
    const sessionId = randomId('dream_');
    const question = await textQueue.run(() => textAi.nextDreamQuestion({ genre, history: [], step: 0 }));
    const questionId = randomId('dream_question_');
    dreamSessions.set(sessionId, {
      genre,
      history: [],
      currentQuestion: { id: questionId, ...question },
      status: 'asking',
      lastAnswer: null,
      createdAt: Date.now(),
    });
    res.json({
      sessionId,
      questionId,
      question: question.text,
      options: question.options,
      step: 1,
      total: DREAM_QUESTION_COUNT,
    });
  }));

  app.post('/api/dream/answer', asyncRoute(async (req, res) => {
    const sessionId = cleanText(req.body?.sessionId, { field: 'セッション', max: 60 });
    const questionId = cleanText(req.body?.questionId, { field: 'しつもん', max: 80 });
    const session = dreamSessions.get(sessionId);
    if (!session) throw new AppError('SESSION_EXPIRED', 'さいしょから ためしてください。', 410);
    const answer = assertChildSafe(cleanText(req.body?.answer, { field: 'こたえ', max: 60 }));
    if (
      session.lastAnswer?.questionId === questionId
      && session.lastAnswer.answer === answer
    ) {
      return res.json(session.lastAnswer.response);
    }
    if (session.status !== 'asking') throw new AppError('DREAM_ALREADY_READY', 'もう 5つこたえています。', 409);
    if (session.busy) throw new AppError('DREAM_BUSY', 'いま つぎのしつもんを かんがえています。', 409);
    if (session.currentQuestion?.id !== questionId) {
      throw new AppError('DREAM_QUESTION_CHANGED', 'あたらしい しつもんに こたえてね。', 409);
    }
    const nextHistory = [
      ...session.history,
      {
        question: session.currentQuestion.text,
        options: session.currentQuestion.options,
        answer,
      },
    ];
    if (nextHistory.length > DREAM_QUESTION_COUNT) {
      throw new AppError('DREAM_ALREADY_READY', 'もう 5つこたえています。', 409);
    }
    session.busy = true;
    session.createdAt = Date.now();
    try {
      if (nextHistory.length === DREAM_QUESTION_COUNT) {
        const summary = await textQueue.run(() => textAi.summarizeDream({ ...session, history: nextHistory }));
        const response = {
          ready: true,
          step: DREAM_QUESTION_COUNT,
          total: DREAM_QUESTION_COUNT,
          title: summary.title,
        };
        session.history = nextHistory;
        session.summary = summary;
        session.currentQuestion = null;
        session.status = 'ready';
        session.lastAnswer = { questionId, answer, response };
        return res.json(response);
      }
      const question = await textQueue.run(() => textAi.nextDreamQuestion({ genre: session.genre, history: nextHistory, step: nextHistory.length }));
      const nextQuestionId = randomId('dream_question_');
      const response = {
        ready: false,
        questionId: nextQuestionId,
        question: question.text,
        options: question.options,
        step: nextHistory.length + 1,
        total: DREAM_QUESTION_COUNT,
      };
      session.history = nextHistory;
      session.currentQuestion = { id: nextQuestionId, ...question };
      session.lastAnswer = { questionId, answer, response };
      return res.json(response);
    } finally {
      session.busy = false;
    }
  }));

  app.post('/api/dream/generate', asyncRoute(async (req, res) => {
    const sessionId = cleanText(req.body?.sessionId, { field: 'セッション', max: 60 });
    const session = dreamSessions.get(sessionId);
    if (!session) throw new AppError('SESSION_EXPIRED', 'さいしょから ためしてください。', 410);
    if (session.status === 'done') return res.json({ resultUrl: session.resultUrl, title: session.summary.title, mock: images.status().mode === 'mock' });
    if (session.status !== 'ready') throw new AppError('DREAM_NOT_READY', '5つのしつもんに こたえてください。', 409);
    session.status = 'generating';
    try {
      const buffer = await imageQueue.run(() => images.dream(session.summary));
      const resultUrl = await store.saveMedia(randomId('dream_'), buffer, 'png');
      Object.assign(session, { status: 'done', resultUrl });
      res.json({ resultUrl, title: session.summary.title, mock: images.status().mode === 'mock' });
    } catch (error) {
      session.status = 'ready';
      throw error;
    }
  }));

  app.get('/api/memory/status', (req, res) => res.json(publicMemoryStatus()));
  app.post('/api/memory/entries', asyncRoute(async (req, res) => {
    const tableId = cleanText(req.body?.tableId, { field: 'テーブル', max: 40 });
    const nickname = assertChildSafe(cleanText(req.body?.nickname, { field: 'ニックネーム', max: 10 }));
    const prompt = assertChildSafe(cleanText(req.body?.prompt, { field: 'おもいで', max: 48 }));
    let created;
    await store.update((state) => {
      if (state.memory.phase !== 'collecting') throw new AppError('MEMORY_CLOSED', 'いまは うけつけていません。', 409);
      const table = state.settings.tables.find((item) => item.id === tableId);
      if (!table) throw new AppError('TABLE_NOT_FOUND', 'テーブルを えらびなおしてください。');
      const tableEntries = state.memory.entries.filter((item) => item.tableId === tableId);
      if (tableEntries.length >= table.expected) throw new AppError('TABLE_FULL', 'このテーブルは みんなそろいました。', 409);
      if (tableEntries.some((item) => item.nickname.toLocaleLowerCase('ja') === nickname.toLocaleLowerCase('ja'))) {
        throw new AppError('NICKNAME_USED', 'おなじニックネームがあります。すこし かえてください。', 409);
      }
      created = { id: randomId('memory_'), tableId, nickname, prompt, createdAt: new Date().toISOString() };
      state.memory.entries.push(created);
    });
    res.status(201).json({ entryId: created.id, marker: `${created.nickname}ロボ` });
  }));

  app.use('/media', (req, res, next) => {
    const state = store.read();
    const requestedName = requestedMediaName(req);
    if (requestedName.startsWith('memory_final_')) {
      const publishedName = path.posix.basename(state.memory.resultUrl || '');
      if (state.memory.phase !== 'published' || requestedName !== publishedName) {
        return res.status(404).json({ error: { code: 'NOT_PUBLISHED', message: 'まだ公開されていません。' } });
      }
    }
    next();
  });
  app.use('/media', express.static(store.mediaDir, { index: false, fallthrough: false, cacheControl: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
  app.use('/materials', express.static(store.materialDir, { index: false, fallthrough: false, cacheControl: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
  app.use(express.static(publicDir, { index: false, etag: false, cacheControl: false }));
  app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.get(['/career', '/craft', '/dream', '/memory'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.all(['/host', '/api/host', '/api/host/*splat'], (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'このページはありません。' } }));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'このページはありません。' } }));
  app.use(errorHandler);
  return app;
}

function hostState() {
  const state = store.read();
  const progress = memoryProgress(state);
  return {
    settings: state.settings,
    materials: state.materials,
    memory: state.memory,
    progress,
    canGenerate: ['locked', 'review'].includes(state.memory.phase) && progress.complete,
    image: images.status(),
    queues: { text: textQueue.status(), image: imageQueue.status() },
  };
}

function createHostApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const allowedHosts = new Set([`127.0.0.1:${config.hostPort}`, `localhost:${config.hostPort}`]);
    if (!allowedHosts.has(req.headers.host)) return res.status(403).json({ error: { code: 'HOST_ONLY', message: 'ホストPCからだけ開けます。' } });
    next();
  });
  app.use(securityHeaders, express.json({ limit: '10mb', type: 'application/json' }));
  app.use('/api/host', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return next(new AppError('JSON_REQUIRED', 'この操作は受け付けられません。', 415));
    }
    next();
  });
  registerFuriganaRoute(app);

  app.get('/api/host/state', (req, res) => res.json(hostState()));
  app.post('/api/host/settings', asyncRoute(async (req, res) => {
    const genres = req.body?.genres;
    const tables = req.body?.tables;
    await store.update((state) => {
      if (!['setup', 'collecting', 'locked'].includes(state.memory.phase)) {
        throw new AppError('EVENT_BUSY', '画像の確認中または公開中は設定を変更できません。', 409);
      }
      if (!Array.isArray(genres) || genres.length < 1 || genres.length > 8) throw new AppError('INVALID_GENRES', 'ジャンルは1〜8個にしてください。');
      const normalizedGenres = genres.map((item) => assertChildSafe(cleanText(item, { field: 'ジャンル', max: 12 })));
      if (new Set(normalizedGenres).size !== normalizedGenres.length) {
        throw new AppError('DUPLICATE_GENRE', '同じジャンルは1つだけにしてください。');
      }
      const cleanGenres = normalizedGenres;
      if (!Array.isArray(tables) || tables.length < 1 || tables.length > 12) throw new AppError('INVALID_TABLES', 'テーブルは1〜12個にしてください。');
      const cleanTables = tables.map((table, index) => ({
        id: typeof table.id === 'string' && /^[a-zA-Z0-9_-]{1,30}$/.test(table.id) ? table.id : `table-${index + 1}`,
        name: cleanText(table.name, { field: 'テーブル名', max: 16 }),
        expected: integer(table.expected, { field: '予定人数', min: 1, max: 12 }),
      }));
      if (new Set(cleanTables.map((table) => table.id)).size !== cleanTables.length) {
        throw new AppError('DUPLICATE_TABLE', '同じテーブルIDは使えません。');
      }
      if (cleanTables.reduce((sum, table) => sum + table.expected, 0) > 48) {
        throw new AppError('TOO_MANY_PARTICIPANTS', '予定人数は合計48人までにしてください。');
      }
      for (const entry of state.memory.entries) {
        const table = cleanTables.find((item) => item.id === entry.tableId);
        if (!table) throw new AppError('TABLE_HAS_ENTRIES', '受付済みの人がいるテーブルは削除できません。', 409);
      }
      for (const table of cleanTables) {
        const received = state.memory.entries.filter((entry) => entry.tableId === table.id).length;
        if (table.expected < received) {
          throw new AppError('EXPECTED_BELOW_RECEIVED', `${table.name}の予定人数は受付済み${received}人より少なくできません。`, 409);
        }
      }
      state.settings.genres = cleanGenres;
      state.settings.tables = cleanTables;
      if (req.body?.eventName !== undefined) {
        state.settings.eventName = cleanText(req.body.eventName, { field: 'イベント名', max: 40 });
      }
      if (typeof req.body?.freeModeEnabled === 'boolean') {
        state.settings.freeModeEnabled = req.body.freeModeEnabled;
      }
    });
    res.json(hostState());
  }));

  app.post('/api/host/materials', asyncRoute(async (req, res) => {
    if (store.read().materials.length >= 12) throw new AppError('TOO_MANY_MATERIALS', '素材は12個までです。', 409);
    const name = cleanText(req.body?.name, { field: '素材名', max: 24 });
    const photo = await normalizedJpeg(req.body?.photoDataUrl, 8_000_000);
    const id = randomId('material_');
    const url = await store.saveMaterial(id, photo.buffer, 'jpg');
    await store.update((state) => {
      if (state.materials.length >= 12) throw new AppError('TOO_MANY_MATERIALS', '素材は12個までです。', 409);
      state.materials.push({ id, name, url, mime: photo.mime, active: true });
    });
    res.status(201).json(hostState());
  }));

  app.patch('/api/host/materials/:id', asyncRoute(async (req, res) => {
    const id = cleanText(req.params.id, { field: '素材', max: 60 });
    await store.update((state) => {
      const item = state.materials.find((material) => material.id === id);
      if (!item) throw new AppError('MATERIAL_NOT_FOUND', '素材が見つかりません。', 404);
      if (typeof req.body?.active === 'boolean') item.active = req.body.active;
      if (req.body?.name !== undefined) item.name = cleanText(req.body.name, { field: '素材名', max: 24 });
    });
    res.json(hostState());
  }));

  app.post('/api/host/memory/open', asyncRoute(async (req, res) => {
    await store.update((state) => {
      if (!['setup', 'locked'].includes(state.memory.phase)) throw new AppError('INVALID_PHASE', '今は受付を開始できません。', 409);
      state.memory.phase = 'collecting';
    });
    res.json(hostState());
  }));

  app.post('/api/host/memory/close', asyncRoute(async (req, res) => {
    await store.update((state) => {
      if (state.memory.phase !== 'collecting') throw new AppError('INVALID_PHASE', '受付中ではありません。', 409);
      state.memory.phase = 'locked';
    });
    res.json(hostState());
  }));

  app.post('/api/host/memory/generate', asyncRoute(async (req, res) => {
    let snapshot;
    await store.update((state) => {
      const progress = memoryProgress(state);
      if (!['locked', 'review'].includes(state.memory.phase) || !progress.complete) {
        throw new AppError('MEMORY_INCOMPLETE', '全員分がそろい、受付を締め切るまで作成できません。', 409);
      }
      state.memory.phase = 'generating';
      snapshot = {
        entries: structuredClone(state.memory.entries),
        eventName: state.settings.eventName,
        tables: structuredClone(state.settings.tables),
      };
    });
    try {
      const themes = await textQueue.run(() => textAi.mapMemoryThemes(snapshot.entries));
      if (themes.length !== snapshot.entries.length) throw new AppError('MEMORY_COUNT_MISMATCH', '人数が一致しないため、画像を作成しませんでした。', 502);
      const layoutReference = await createMemoryPoster({
        ...snapshot,
        entries: snapshot.entries.map((entry, index) => ({ ...entry, nickname: String(index + 1) })),
        themes,
      });
      const buffer = await imageQueue.run(() => images.memory({
        ...snapshot,
        themes,
        layoutReference,
      }));
      const resultUrl = await store.saveMedia(randomId('memory_final_'), buffer, 'png');
      await store.update((state) => {
        state.memory.phase = 'review';
        state.memory.resultUrl = resultUrl;
        state.memory.generatedAt = new Date().toISOString();
        state.memory.renderedCount = themes.length;
      });
      res.json(hostState());
    } catch (error) {
      await store.update((state) => { state.memory.phase = 'locked'; });
      throw error;
    }
  }));

  app.post('/api/host/memory/publish', asyncRoute(async (req, res) => {
    await store.update((state) => {
      const progress = memoryProgress(state);
      if (state.memory.phase !== 'review' || !state.memory.resultUrl || state.memory.renderedCount !== progress.expected) {
        throw new AppError('NOT_READY_TO_PUBLISH', '人数確認が完了した画像だけ公開できます。', 409);
      }
      state.memory.phase = 'published';
    });
    res.json(hostState());
  }));

  app.post('/api/host/memory/unpublish', asyncRoute(async (req, res) => {
    await store.update((state) => {
      if (state.memory.phase !== 'published') throw new AppError('INVALID_PHASE', '公開中ではありません。', 409);
      state.memory.phase = 'review';
    });
    res.json(hostState());
  }));

  app.post('/api/host/memory/entries/:id/remove', asyncRoute(async (req, res) => {
    const id = cleanText(req.params.id, { field: '受付内容', max: 60 });
    let staleResultUrl = null;
    await store.update((state) => {
      if (!['collecting', 'locked', 'review'].includes(state.memory.phase)) {
        throw new AppError('ENTRY_REMOVE_NOT_ALLOWED', '今は受付内容を削除できません。', 409);
      }
      const index = state.memory.entries.findIndex((entry) => entry.id === id);
      if (index === -1) throw new AppError('ENTRY_NOT_FOUND', '受付内容が見つかりません。', 404);
      state.memory.entries.splice(index, 1);
      if (state.memory.phase === 'review') {
        staleResultUrl = state.memory.resultUrl;
        state.memory.phase = 'locked';
        state.memory.resultUrl = null;
        state.memory.generatedAt = null;
        state.memory.renderedCount = 0;
      }
    });
    if (staleResultUrl) await store.deleteMediaUrl(staleResultUrl).catch(() => undefined);
    res.json(hostState());
  }));

  app.post('/api/host/memory/reset', asyncRoute(async (req, res) => {
    await store.update((state) => {
      if (state.memory.phase === 'generating') {
        throw new AppError('MEMORY_GENERATING', '画像生成中は新しいイベントを準備できません。', 409);
      }
      state.memory = {
        phase: 'setup',
        entries: [],
        resultUrl: null,
        generatedAt: null,
      };
    });
    await store.purgeMediaPrefix('memory_final_').catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'memory_media_cleanup_failed', error: error.name }));
    });
    res.json(hostState());
  }));

  app.use('/media', express.static(store.mediaDir, { index: false, fallthrough: false, cacheControl: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
  app.use(express.static(publicDir, { index: false, etag: false, cacheControl: false }));
  app.get(['/host', '/'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'このページはありません。' } }));
  app.use(errorHandler);
  return app;
}

async function start() {
  await furigana.ready();
  await store.init();
  await store.purgeMediaPrefix('career_');
  await store.update((state) => {
    if (state.memory.phase === 'generating') state.memory.phase = 'locked';
  });
  await ensureTestMaterials();
  const health = await textAi.health();
  if (!health.ok) {
    throw new Error(`Codex app-serverまたは指定GPTモデルを利用できません (${health.reason})。別モデルへは切り替えません。`);
  }
  if (!config.testMode) {
    await textAi.nextDreamQuestion({ genre: '動作確認', history: [], step: 0 });
  }
  const imageHealth = images.status();
  if (!imageHealth.ready) {
    throw new Error(`画像生成の設定を利用できません (${imageHealth.mode})。自動的に別の送信先へは切り替えません。`);
  }
  if (imageHealth.mode === 'codex' && health.imageGeneration !== true) {
    throw new Error('Codex app-serverの画像生成機能を利用できません。別の送信先へは切り替えません。');
  }
  if (imageHealth.mode === 'codex' && imageHealth.adultTestMode !== true) {
    throw new Error('Codex画像生成は成人テスト専用です。ADULT_TEST_MODE=trueがない状態では起動しません。');
  }

  const publicApp = createPublicApp();
  const hostApp = createHostApp();
  let publicServer;
  let protocol = 'http';
  let certificate = null;
  if (config.tlsCertPath && config.tlsKeyPath) {
    const cert = fs.readFileSync(config.tlsCertPath);
    const key = fs.readFileSync(config.tlsKeyPath);
    certificate = new X509Certificate(cert);
    if (Date.parse(certificate.validTo) <= Date.now() + 60 * 60 * 1000) {
      throw new Error('HTTPS証明書が失効済み、または1時間以内に失効します。');
    }
    if (!certificate.checkPrivateKey(createPrivateKey(key))) {
      throw new Error('HTTPS証明書と秘密鍵が一致しません。');
    }
    const matchingAddresses = listLanAddresses().filter((address) => certificate.checkIP(address));
    if (!matchingAddresses.length) {
      throw new Error('HTTPS証明書の対象IPと、現在のLAN IPが一致しません。');
    }
    publicServer = https.createServer({ cert, key }, publicApp);
    protocol = 'https';
  } else {
    publicServer = http.createServer(publicApp);
  }
  const hostServer = http.createServer(hostApp);

  await Promise.all([
    new Promise((resolve) => publicServer.listen(config.port, config.host, resolve)),
    new Promise((resolve) => hostServer.listen(config.hostPort, '127.0.0.1', resolve)),
  ]);

  console.log(`AI ROBOT BOOK CAFE を起動しました`);
  console.log(`子ども用: ${protocol}://localhost:${config.port}`);
  for (const address of listLanAddresses()) {
    if (!certificate || certificate.checkIP(address)) console.log(`LAN: ${protocol}://${address}:${config.port}`);
    else console.log(`HTTPS証明書の対象外: ${address}`);
  }
  console.log(`ホスト専用: http://127.0.0.1:${config.hostPort}/host`);
  console.log(`Codex app-server: ${health.ok ? `準備OK (${health.model})` : `利用不可 (${health.reason})`}`);
  if (protocol === 'http') console.log('注意: LANのHTTP接続ではブラウザのカメラを利用できません。HTTPS設定が必要です。');

  let shuttingDown = false;
  const closeServer = (server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('新しい受付を止めて終了します…');
    textQueue.close();
    imageQueue.close();
    const forced = setTimeout(() => {
      console.error('10分以内に処理を終えられなかったため、強制終了します。');
      process.exit(1);
    }, 10 * 60_000);
    forced.unref();
    Promise.all([
      closeServer(publicServer),
      closeServer(hostServer),
      textQueue.whenIdle(),
      imageQueue.whenIdle(),
    ]).then(() => {
      clearTimeout(forced);
      console.log('処理完了を確認して停止しました。');
      process.exit(0);
    }).catch((error) => {
      console.error(`停止処理に失敗しました: ${error.message}`);
      process.exit(1);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error(`起動に失敗しました: ${error.message}`);
  process.exit(1);
});

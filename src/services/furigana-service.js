import path from 'node:path';
import { createRequire } from 'node:module';
import kuromoji from 'kuromoji';

const require = createRequire(import.meta.url);
const kuromojiEntry = require.resolve('kuromoji');
const dictionaryPath = path.resolve(path.dirname(kuromojiEntry), '../dict');

const KANJI_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆ヶ]/u;
const KANJI_RUN_PATTERN = /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆ヶ]+|[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆ヶ]+)/gu;
const KANA_PATTERN = /^[\u3041-\u3096\u30a1-\u30faー]+$/u;

function katakanaToHiragana(value = '') {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) {
      return String.fromCodePoint(code - 0x60);
    }
    return character;
  }).join('');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergePlainSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const previous = merged.at(-1);
    if (!segment.reading && previous && !previous.reading) {
      previous.text += segment.text;
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function tokenSegments(surface, rawReading) {
  if (!KANJI_PATTERN.test(surface)) return [{ text: surface }];
  if (!rawReading || rawReading === '*') return [{ text: surface }];

  const reading = katakanaToHiragana(rawReading);
  const runs = surface.match(KANJI_RUN_PATTERN) || [surface];
  const captureRuns = [];
  let pattern = '^';

  for (const run of runs) {
    if (KANJI_PATTERN.test(run)) {
      captureRuns.push(run);
      pattern += captureRuns.length === runs.length ? '(.+)' : '(.+?)';
      continue;
    }
    const normalized = katakanaToHiragana(run);
    pattern += escapeRegExp(normalized);
  }
  pattern += '$';

  const matched = reading.match(new RegExp(pattern, 'u'));
  if (!matched || matched.length !== captureRuns.length + 1) {
    return [{ text: surface, reading }];
  }

  let captureIndex = 1;
  return runs.map((run) => {
    if (KANJI_PATTERN.test(run)) {
      return { text: run, reading: matched[captureIndex++] };
    }
    return { text: run };
  });
}

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });
}

export class FuriganaService {
  constructor({ maxCacheEntries = 2_000 } = {}) {
    this.tokenizerPromise = null;
    this.cache = new Map();
    this.maxCacheEntries = maxCacheEntries;
  }

  ready() {
    if (!this.tokenizerPromise) this.tokenizerPromise = buildTokenizer();
    return this.tokenizerPromise;
  }

  async annotate(text) {
    const value = String(text ?? '');
    if (!KANJI_PATTERN.test(value)) return [{ text: value }];
    if (this.cache.has(value)) return this.cache.get(value);

    const tokenizer = await this.ready();
    const segments = mergePlainSegments(
      tokenizer.tokenize(value).flatMap((token) => tokenSegments(token.surface_form, token.reading)),
    );

    if (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(value, segments);
    return segments;
  }

  async annotateMany(texts) {
    return Promise.all(texts.map(async (text) => ({
      text,
      segments: await this.annotate(text),
    })));
  }
}

export const furiganaPatterns = Object.freeze({
  kanji: KANJI_PATTERN,
  kana: KANA_PATTERN,
});

import crypto from 'node:crypto';
import { AppError } from './errors.js';

export function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(12).toString('base64url')}`;
}

export function cleanText(value, { field = '入力', min = 1, max = 80 } = {}) {
  if (typeof value !== 'string') {
    throw new AppError('INVALID_INPUT', `${field}を入力してください。`);
  }
  const cleaned = value.normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < min) throw new AppError('INVALID_INPUT', `${field}を入力してください。`);
  if (cleaned.length > max) throw new AppError('INPUT_TOO_LONG', `${field}は${max}文字までです。`);
  return cleaned;
}

export function cleanOptionalText(value, { field = '入力', max = 80 } = {}) {
  if (value === undefined || value === null || value === '') return '';
  return cleanText(value, { field, min: 0, max });
}

export function oneOf(value, allowed, field = '選択') {
  if (!allowed.includes(value)) throw new AppError('INVALID_CHOICE', `${field}を選び直してください。`);
  return value;
}

export function integer(value, { field = '数', min = 0, max = 100 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError('INVALID_NUMBER', `${field}は${min}〜${max}で入力してください。`);
  }
  return value;
}

export function parseDataUrl(value, { maxBytes = 6_000_000, allowed = ['image/jpeg', 'image/png', 'image/webp'] } = {}) {
  if (typeof value !== 'string') throw new AppError('PHOTO_REQUIRED', '写真を選んでください。');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || !allowed.includes(match[1])) throw new AppError('PHOTO_FORMAT', 'JPEG、PNG、WebPの写真を使ってください。');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes) throw new AppError('PHOTO_SIZE', '写真が大きすぎます。撮り直してください。');
  return { buffer, mime: match[1] };
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

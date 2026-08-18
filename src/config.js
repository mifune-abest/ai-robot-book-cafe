import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..');

const defaultsPath = path.join(projectRoot, 'config', 'defaults.json');
export const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = Object.freeze({
  host: process.env.HOST || '0.0.0.0',
  port: numberFromEnv('PORT', 4310),
  hostPort: numberFromEnv('HOST_PORT', 4311),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(projectRoot, 'data')),
  codexCommand: process.env.CODEX_COMMAND || 'codex',
  codexAppServerModel: process.env.CODEX_APP_SERVER_MODEL || 'gpt-5.5',
  imageProvider: process.env.IMAGE_PROVIDER || 'mock',
  careerCardOutfitProvider: process.env.CAREER_CARD_OUTFIT_PROVIDER || process.env.IMAGE_PROVIDER || 'mock',
  careerCardCompositor: process.env.CAREER_CARD_COMPOSITOR || 'smart',
  adultTestMode: process.env.ADULT_TEST_MODE === 'true',
  testMode: process.env.APP_TEST_MODE === '1',
  requestTimeoutMs: numberFromEnv('AI_TIMEOUT_MS', 180_000),
  imageTimeoutMs: numberFromEnv('IMAGE_TIMEOUT_MS', 300_000),
  imageConcurrency: Math.max(1, Math.min(4, numberFromEnv('IMAGE_CONCURRENCY', 2))),
  textConcurrency: Math.max(1, Math.min(4, numberFromEnv('TEXT_CONCURRENCY', 2))),
  tlsCertPath: process.env.TLS_CERT_PATH ? path.resolve(process.env.TLS_CERT_PATH) : '',
  tlsKeyPath: process.env.TLS_KEY_PATH ? path.resolve(process.env.TLS_KEY_PATH) : '',
});

export function listLanAddresses() {
  const addresses = [];
  for (const values of Object.values(os.networkInterfaces())) {
    for (const item of values || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return [...new Set(addresses)];
}

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../config.js';

export const CAREER_CARD_FACE_SLOT = Object.freeze({
  centerX: 0.5,
  centerY: 0.31,
  width: 0.34,
  height: 0.44,
  collarY: 0.52,
  eyeDistance: 0.108,
  eyeY: 0.315,
});

export const mediaPipePackageDir = path.join(
  projectRoot,
  'node_modules',
  '@mediapipe',
  'tasks-vision',
);

const requiredRuntimeFiles = [
  'vision_bundle.mjs',
  'vision_bundle.js',
  'wasm/vision_wasm_internal.js',
  'wasm/vision_wasm_internal.wasm',
  'wasm/vision_wasm_nosimd_internal.js',
  'wasm/vision_wasm_nosimd_internal.wasm',
  'wasm/vision_wasm_module_internal.js',
  'wasm/vision_wasm_module_internal.wasm',
];

const modelFiles = [
  {
    name: 'face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
];

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

let cachedAssetCheck;

export function localCompositorAssetsStatus(mode = 'smart') {
  if (mode === 'classic') {
    return { mode, ready: true, localOnly: true, sendsParticipantPhoto: false };
  }
  if (mode !== 'smart') {
    return { mode, ready: false, localOnly: true, sendsParticipantPhoto: false, reason: 'invalid-mode' };
  }
  if (cachedAssetCheck) return { mode, ...cachedAssetCheck };

  const missing = [];
  const changed = [];
  for (const relative of requiredRuntimeFiles) {
    if (!fs.existsSync(path.join(mediaPipePackageDir, relative))) missing.push(`mediapipe/${relative}`);
  }
  for (const model of modelFiles) {
    const file = path.join(projectRoot, 'public', 'models', model.name);
    if (!fs.existsSync(file)) {
      missing.push(`models/${model.name}`);
    } else if (sha256(file) !== model.sha256) {
      changed.push(`models/${model.name}`);
    }
  }

  cachedAssetCheck = Object.freeze({
    ready: missing.length === 0 && changed.length === 0,
    localOnly: true,
    sendsParticipantPhoto: false,
    ...(missing.length ? { missing } : {}),
    ...(changed.length ? { changed } : {}),
  });
  return { mode, ...cachedAssetCheck };
}

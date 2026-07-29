import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults } from './config.js';

function initialState() {
  return {
    version: 1,
    settings: structuredClone(defaults),
    materials: [],
    memory: {
      phase: 'setup',
      entries: [],
      resultUrl: null,
      generatedAt: null,
    },
  };
}

export class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'state.json');
    this.mediaDir = path.join(dataDir, 'media');
    this.materialDir = path.join(dataDir, 'materials');
    this.state = initialState();
    this.writeQueue = Promise.resolve();
    this.mutationQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.mediaDir, { recursive: true });
    await fs.mkdir(this.materialDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = { ...initialState(), ...parsed };
      if (this.state.memory?.phase === 'closed' && !this.state.memory.entries?.length && !this.state.memory.resultUrl) {
        this.state.memory.phase = 'setup';
        await this.persist();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  read() {
    return structuredClone(this.state);
  }

  async update(mutator) {
    const operation = this.mutationQueue.then(async () => {
      const next = structuredClone(this.state);
      const result = await mutator(next);
      await this.persistState(next);
      this.state = next;
      return result;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  persist() {
    return this.persistState(this.state);
  }

  persistState(state) {
    const snapshot = structuredClone(state);
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const temporary = `${this.file}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, this.file);
    });
    return this.writeQueue;
  }

  async deleteMediaUrl(url) {
    if (!url) return;
    const name = path.basename(url);
    if (!/^[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(name)) return;
    await fs.unlink(path.join(this.mediaDir, name)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async purgeMediaPrefix(prefix) {
    const names = await fs.readdir(this.mediaDir).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    await Promise.all(names
      .filter((name) => name.startsWith(prefix))
      .map((name) => fs.unlink(path.join(this.mediaDir, name)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      })));
  }

  async saveMedia(id, buffer, extension = 'png') {
    const safeId = id.replace(/[^A-Za-z0-9_-]/g, '');
    const file = path.join(this.mediaDir, `${safeId}.${extension}`);
    await fs.writeFile(file, buffer, { mode: 0o600 });
    return `/media/${safeId}.${extension}`;
  }

  async saveMaterial(id, buffer, extension = 'jpg') {
    const safeId = id.replace(/[^A-Za-z0-9_-]/g, '');
    const file = path.join(this.materialDir, `${safeId}.${extension}`);
    await fs.writeFile(file, buffer, { mode: 0o600 });
    return `/materials/${safeId}.${extension}`;
  }
}

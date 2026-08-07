import { AppError } from './errors.js';

export class TaskQueue {
  constructor({ concurrency = 1, maxPending = 24 } = {}) {
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.active = 0;
    this.pending = [];
    this.accepting = true;
    this.idleWaiters = [];
  }

  status() {
    return {
      active: this.active,
      waiting: this.pending.length,
      accepting: this.accepting,
      concurrency: this.concurrency,
    };
  }

  run(task) {
    if (!this.accepting) {
      throw new AppError('SERVICE_STOPPING', 'サーバーを安全に停止中です。スタッフを呼んでください。', 503);
    }
    if (this.pending.length >= this.maxPending) {
      throw new AppError('QUEUE_FULL', 'いまはこんでいます。少しまってからためしてください。', 503);
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      this.active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
          this.resolveIdle();
        });
    }
    this.resolveIdle();
  }

  close() {
    this.accepting = false;
    this.resolveIdle();
  }

  whenIdle() {
    if (this.active === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  resolveIdle() {
    if (this.active !== 0 || this.pending.length !== 0) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskQueue } from '../src/lib/task-queue.js';

test('同時実行数2では3件目を待機させ、最大2件だけ処理する', async () => {
  const queue = new TaskQueue({ concurrency: 2, maxPending: 4 });
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const tasks = [1, 2, 3].map((id) => queue.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await gate;
    active -= 1;
    return id;
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queue.status(), {
    active: 2,
    waiting: 1,
    accepting: true,
    concurrency: 2,
  });

  release();
  assert.deepEqual(await Promise.all(tasks), [1, 2, 3]);
  assert.equal(maxActive, 2);
  assert.deepEqual(queue.status(), {
    active: 0,
    waiting: 0,
    accepting: true,
    concurrency: 2,
  });
});

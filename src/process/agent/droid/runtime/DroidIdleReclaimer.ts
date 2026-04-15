/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

type ReclaimerTask = {
  timer: ReturnType<typeof setTimeout>;
  runAt: number;
};

export class DroidIdleReclaimer {
  private readonly tasks = new Map<string, ReclaimerTask>();

  schedule(key: string, ttlMs: number, callback: () => void | Promise<void>): void {
    this.cancel(key);

    const timer = setTimeout(
      () => {
        this.tasks.delete(key);
        void callback();
      },
      Math.max(0, ttlMs)
    );

    this.tasks.set(key, {
      timer,
      runAt: Date.now() + Math.max(0, ttlMs),
    });
  }

  cancel(key: string): void {
    const existing = this.tasks.get(key);
    if (!existing) {
      return;
    }

    clearTimeout(existing.timer);
    this.tasks.delete(key);
  }

  clear(): void {
    for (const key of this.tasks.keys()) {
      this.cancel(key);
    }
  }

  getSnapshot(): Array<{ key: string; runAt: number }> {
    return Array.from(this.tasks.entries()).map(([key, task]) => ({
      key,
      runAt: task.runAt,
    }));
  }
}

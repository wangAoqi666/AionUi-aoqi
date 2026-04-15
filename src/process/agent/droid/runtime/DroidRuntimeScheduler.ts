/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResolvedDroidChannelRuntimeConfig } from '@/common/config/storage';
import { DroidIdleReclaimer } from './DroidIdleReclaimer';
import { DroidRuntimeRegistry } from './DroidRuntimeRegistry';
import { DroidWarmPool } from './DroidWarmPool';

type QueueEntry<T> = {
  execute: (controller: DroidRuntimeTurnController) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

class AsyncSemaphore {
  private waiters: Array<() => void> = [];
  private inUse = 0;

  constructor(private capacity: number) {}

  async acquire(): Promise<void> {
    if (this.inUse < this.capacity) {
      this.inUse += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.inUse += 1;
  }

  release(): void {
    if (this.inUse > 0) {
      this.inUse -= 1;
    }

    if (this.inUse >= this.capacity) {
      return;
    }

    const next = this.waiters.shift();
    next?.();
  }

  updateCapacity(nextCapacity: number): void {
    this.capacity = Math.max(1, nextCapacity);
    while (this.waiters.length > 0 && this.inUse < this.capacity) {
      const next = this.waiters.shift();
      next?.();
    }
  }

  getSnapshot(): { capacity: number; inUse: number; queued: number } {
    return {
      capacity: this.capacity,
      inUse: this.inUse,
      queued: this.waiters.length,
    };
  }
}

export class DroidRuntimeTurnController {
  private runPermitHeld = false;
  private finished = false;

  constructor(private readonly runSemaphore: AsyncSemaphore) {}

  async start(): Promise<void> {
    await this.runSemaphore.acquire();
    this.runPermitHeld = true;
  }

  pauseForInteractive(): void {
    if (!this.runPermitHeld || this.finished) {
      return;
    }

    this.runSemaphore.release();
    this.runPermitHeld = false;
  }

  async resumeAfterInteractive(): Promise<void> {
    if (this.finished || this.runPermitHeld) {
      return;
    }

    await this.runSemaphore.acquire();
    this.runPermitHeld = true;
  }

  finish(): void {
    if (this.finished) {
      return;
    }

    if (this.runPermitHeld) {
      this.runSemaphore.release();
      this.runPermitHeld = false;
    }

    this.finished = true;
  }
}

export class DroidRuntimeScheduler {
  private readonly registry = new DroidRuntimeRegistry();
  private readonly reclaimer = new DroidIdleReclaimer();
  private readonly warmPool: DroidWarmPool;
  private readonly startSemaphore: AsyncSemaphore;
  private readonly runSemaphore: AsyncSemaphore;
  private readonly queues = new Map<string, Array<QueueEntry<unknown>>>();
  private readonly activeConversations = new Set<string>();
  private settings: ResolvedDroidChannelRuntimeConfig;

  constructor(
    readonly scopeKey: string,
    settings: ResolvedDroidChannelRuntimeConfig
  ) {
    this.settings = settings;
    this.warmPool = new DroidWarmPool(this.reclaimer, settings.maxWarmSessions, settings.warmTtlMs);
    this.startSemaphore = new AsyncSemaphore(settings.maxConcurrentStarts);
    this.runSemaphore = new AsyncSemaphore(settings.maxConcurrentRuns);
  }

  updateSettings(settings: ResolvedDroidChannelRuntimeConfig): void {
    this.settings = settings;
    this.startSemaphore.updateCapacity(settings.maxConcurrentStarts);
    this.runSemaphore.updateCapacity(settings.maxConcurrentRuns);
    this.warmPool.updateSettings(settings.maxWarmSessions, settings.warmTtlMs);
  }

  async withStartPermit<T>(conversationId: string, execute: () => Promise<T>): Promise<T> {
    this.registry.update(conversationId, { state: 'starting' });
    await this.startSemaphore.acquire();

    try {
      const result = await execute();
      const state = this.registry.get(conversationId)?.state;
      if (state === 'starting') {
        this.registry.update(conversationId, { state: 'warm' });
      }
      return result;
    } catch (error) {
      this.registry.update(conversationId, { state: 'failed' });
      throw error;
    } finally {
      this.startSemaphore.release();
    }
  }

  enqueueTurn<T>(conversationId: string, execute: (controller: DroidRuntimeTurnController) => Promise<T>): Promise<T> {
    const queue = this.queues.get(conversationId) ?? [];
    const totalQueued = Array.from(this.queues.values()).reduce((sum, items) => sum + items.length, 0);

    if (
      this.settings.overloadStrategy === 'reject' &&
      (this.activeConversations.has(conversationId) || queue.length > 0)
    ) {
      return Promise.reject(new Error('Droid runtime is busy for this conversation'));
    }

    if (queue.length >= this.settings.maxQueuePerConversation) {
      return Promise.reject(new Error('Droid conversation queue is full'));
    }

    if (totalQueued >= this.settings.maxQueuePerPublishedAgent) {
      return Promise.reject(new Error('Droid published queue is full'));
    }

    return new Promise<T>((resolve, reject) => {
      const nextQueue = [...queue, { execute: execute as QueueEntry<unknown>['execute'], resolve, reject }];
      this.queues.set(conversationId, nextQueue);
      this.registry.update(conversationId, { queueLength: nextQueue.length });
      void this.drain(conversationId);
    });
  }

  markWarm(conversationId: string, close: () => Promise<void>): void {
    this.registry.update(conversationId, {
      state: 'warm',
      pendingAskUserCallId: undefined,
    });
    this.warmPool.touch(conversationId, close);
  }

  clearWarm(conversationId: string): void {
    this.warmPool.activate(conversationId);
    const state = this.registry.get(conversationId)?.state;
    if (state === 'warm') {
      this.registry.update(conversationId, { state: 'cold' });
    }
  }

  markAskUser(conversationId: string, callId: string): void {
    this.registry.update(conversationId, {
      state: 'ask_user',
      pendingAskUserCallId: callId,
    });
  }

  clearAskUser(conversationId: string): void {
    this.registry.update(conversationId, {
      state: 'running',
      pendingAskUserCallId: undefined,
    });
  }

  markCold(conversationId: string): void {
    this.warmPool.clear(conversationId);
    this.registry.update(conversationId, {
      state: 'cold',
      queueLength: this.queues.get(conversationId)?.length ?? 0,
      pendingAskUserCallId: undefined,
    });
  }

  markFailed(conversationId: string): void {
    this.warmPool.clear(conversationId);
    this.registry.update(conversationId, { state: 'failed' });
  }

  getSnapshot() {
    return {
      scopeKey: this.scopeKey,
      registry: this.registry.getSnapshot(),
      warmPool: this.warmPool.getSnapshot(),
      startSemaphore: this.startSemaphore.getSnapshot(),
      runSemaphore: this.runSemaphore.getSnapshot(),
      queueCount: Array.from(this.queues.values()).reduce((sum, queue) => sum + queue.length, 0),
    };
  }

  destroy(): void {
    this.reclaimer.clear();
    this.queues.clear();
    this.activeConversations.clear();
  }

  private async drain(conversationId: string): Promise<void> {
    if (this.activeConversations.has(conversationId)) {
      return;
    }

    this.activeConversations.add(conversationId);
    this.warmPool.activate(conversationId);

    try {
      let queue = this.queues.get(conversationId);
      while (queue && queue.length > 0) {
        const next = queue.shift();
        this.registry.update(conversationId, {
          queueLength: queue.length,
          state: 'running',
          pendingAskUserCallId: undefined,
        });

        if (!next) {
          continue;
        }

        const controller = new DroidRuntimeTurnController(this.runSemaphore);
        await controller.start();
        try {
          const result = await next.execute(controller);
          next.resolve(result);
        } catch (error) {
          this.registry.update(conversationId, {
            queueLength: queue.length,
            state: 'failed',
          });
          next.reject(error);
        } finally {
          controller.finish();
          const state = this.registry.get(conversationId)?.state;
          if (state === 'running') {
            this.registry.update(conversationId, {
              queueLength: queue.length,
              state: queue.length > 0 ? 'cold' : 'cold',
            });
          } else {
            this.registry.update(conversationId, {
              queueLength: queue.length,
            });
          }
        }

        queue = this.queues.get(conversationId);
      }
    } finally {
      this.activeConversations.delete(conversationId);
      if ((this.queues.get(conversationId)?.length ?? 0) === 0) {
        this.queues.delete(conversationId);
      }
    }
  }
}

const schedulerRegistry = new Map<string, DroidRuntimeScheduler>();

export const getDroidRuntimeScheduler = (
  scopeKey: string,
  settings: ResolvedDroidChannelRuntimeConfig
): DroidRuntimeScheduler => {
  const existing = schedulerRegistry.get(scopeKey);
  if (existing) {
    existing.updateSettings(settings);
    return existing;
  }

  const next = new DroidRuntimeScheduler(scopeKey, settings);
  schedulerRegistry.set(scopeKey, next);
  return next;
};

export const resetDroidRuntimeSchedulers = (): void => {
  for (const scheduler of schedulerRegistry.values()) {
    scheduler.destroy();
  }
  schedulerRegistry.clear();
};

/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DroidIdleReclaimer } from './DroidIdleReclaimer';

type WarmEntry = {
  conversationId: string;
  close: () => Promise<void>;
  lastUsedAt: number;
};

export class DroidWarmPool {
  private readonly entries = new Map<string, WarmEntry>();

  constructor(
    private readonly reclaimer: DroidIdleReclaimer,
    private maxWarmSessions: number,
    private warmTtlMs: number
  ) {}

  updateSettings(maxWarmSessions: number, warmTtlMs: number): void {
    this.maxWarmSessions = maxWarmSessions;
    this.warmTtlMs = warmTtlMs;
    this.enforceCapacity();

    for (const entry of this.entries.values()) {
      this.scheduleExpiry(entry);
    }
  }

  activate(conversationId: string): void {
    this.entries.delete(conversationId);
    this.reclaimer.cancel(this.getWarmKey(conversationId));
  }

  touch(conversationId: string, close: () => Promise<void>): void {
    const entry: WarmEntry = {
      conversationId,
      close,
      lastUsedAt: Date.now(),
    };

    this.entries.set(conversationId, entry);
    this.scheduleExpiry(entry);
    this.enforceCapacity();
  }

  clear(conversationId: string): void {
    this.entries.delete(conversationId);
    this.reclaimer.cancel(this.getWarmKey(conversationId));
  }

  getSnapshot(): Array<{ conversationId: string; lastUsedAt: number }> {
    return Array.from(this.entries.values())
      .toSorted((left, right) => left.lastUsedAt - right.lastUsedAt)
      .map((entry) => ({
        conversationId: entry.conversationId,
        lastUsedAt: entry.lastUsedAt,
      }));
  }

  private scheduleExpiry(entry: WarmEntry): void {
    this.reclaimer.schedule(this.getWarmKey(entry.conversationId), this.warmTtlMs, async () => {
      this.entries.delete(entry.conversationId);
      await entry.close();
    });
  }

  private enforceCapacity(): void {
    while (this.entries.size > this.maxWarmSessions) {
      const oldest = Array.from(this.entries.values()).toSorted((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
      if (!oldest) {
        return;
      }

      this.entries.delete(oldest.conversationId);
      this.reclaimer.cancel(this.getWarmKey(oldest.conversationId));
      void oldest.close();
    }
  }

  private getWarmKey(conversationId: string): string {
    return `warm:${conversationId}`;
  }
}

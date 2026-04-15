/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

export type DroidRuntimeState = 'cold' | 'starting' | 'warm' | 'running' | 'ask_user' | 'failed';

type DroidRuntimeEntry = {
  conversationId: string;
  state: DroidRuntimeState;
  queueLength: number;
  lastUsedAt: number;
  pendingAskUserCallId?: string;
};

export class DroidRuntimeRegistry {
  private readonly entries = new Map<string, DroidRuntimeEntry>();

  update(
    conversationId: string,
    patch: Partial<Omit<DroidRuntimeEntry, 'conversationId'>> & { state?: DroidRuntimeState }
  ): void {
    const current = this.entries.get(conversationId) ?? {
      conversationId,
      state: 'cold' as const,
      queueLength: 0,
      lastUsedAt: Date.now(),
    };

    const next: DroidRuntimeEntry = {
      ...current,
      ...patch,
      lastUsedAt: patch.lastUsedAt ?? Date.now(),
    };

    if (next.state === 'cold' && next.queueLength === 0 && !next.pendingAskUserCallId) {
      this.entries.delete(conversationId);
      return;
    }

    this.entries.set(conversationId, next);
  }

  get(conversationId: string): DroidRuntimeEntry | undefined {
    return this.entries.get(conversationId);
  }

  getTotalQueued(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.queueLength;
    }
    return total;
  }

  getSnapshot(): DroidRuntimeEntry[] {
    return Array.from(this.entries.values()).map((entry) => ({ ...entry }));
  }
}

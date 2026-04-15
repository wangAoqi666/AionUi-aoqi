/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHANNEL_CONVERSATION_AGENT,
  getChannelConversationAgentOptions,
  resolveChannelConversationAgentSelection,
} from '@/renderer/components/settings/channelConversationAgentOptions';

describe('channelConversationAgentOptions', () => {
  it('exposes Factory Droid as the only channel agent option', () => {
    expect(
      getChannelConversationAgentOptions([
        { backend: 'gemini', name: 'Gemini CLI' },
        { backend: 'droid', name: 'Factory Droid Runtime', customAgentId: 'builtin-main' },
      ])
    ).toEqual([
      {
        backend: 'droid',
        name: 'Factory Droid Runtime',
        customAgentId: 'builtin-main',
      },
    ]);
  });

  it('forces stale saved selections back to Factory Droid', () => {
    expect(
      resolveChannelConversationAgentSelection({ backend: 'gemini', name: 'Gemini CLI' }, [
        { backend: 'droid', name: 'Factory Droid' },
      ])
    ).toEqual({
      availableAgents: [DEFAULT_CHANNEL_CONVERSATION_AGENT],
      selectedAgent: DEFAULT_CHANNEL_CONVERSATION_AGENT,
      shouldPersistSelection: true,
    });
  });
});

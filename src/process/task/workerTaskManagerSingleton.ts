/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Singleton WorkerTaskManager wired with all registered agent creators.
 * Extracted to a separate module to avoid circular dependencies with initBridge.ts.
 */

import { AgentFactory } from './AgentFactory';
import { WorkerTaskManager } from './WorkerTaskManager';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { GeminiAgentManager } from './GeminiAgentManager';
import AcpAgentManager from './AcpAgentManager';
import OpenClawAgentManager from './OpenClawAgentManager';
import NanoBotAgentManager from './NanoBotAgentManager';
import RemoteAgentManager from './RemoteAgentManager';
import { AionrsManager } from './AionrsManager';
import type { TChatConversation } from '@/common/config/storage';

const agentFactory = new AgentFactory();

type ConversationOf<TType extends TChatConversation['type']> = Extract<TChatConversation, { type: TType }>;

const asConversation = <TType extends TChatConversation['type']>(conv: unknown) => conv as ConversationOf<TType>;

const getConversationUseModel = (conv: unknown): string | undefined => {
  if (!conv || typeof conv !== 'object' || !('model' in conv)) {
    return undefined;
  }

  const model = (conv as { model?: { useModel?: unknown } }).model;
  return typeof model?.useModel === 'string' ? model.useModel : undefined;
};

agentFactory.register('gemini', (conv, opts) => {
  const c = asConversation<'gemini'>(conv);
  return new GeminiAgentManager(
    { ...c.extra, conversation_id: c.id, yoloMode: opts?.yoloMode },
    c.model
  ) as unknown as ReturnType<typeof agentFactory.create>;
});
agentFactory.register('acp', (conv, opts) => {
  const c = asConversation<'acp'>(conv);
  return new AcpAgentManager({
    ...c.extra,
    conversation_id: c.id,
    source: c.source,
    channelPluginId: c.channelPluginId,
    yoloMode: opts?.yoloMode,
    // Only gemini ACP conversations use conversation.model as a backend-aligned model
    // fallback. Other ACP backends persist their own CLI model IDs in extra.currentModelId.
    currentModelId:
      c.extra?.currentModelId ?? (c.extra?.backend === 'gemini' ? getConversationUseModel(conv) : undefined),
  }) as unknown as ReturnType<typeof agentFactory.create>;
});
agentFactory.register('openclaw-gateway', (conv, opts) => {
  const c = asConversation<'openclaw-gateway'>(conv);
  return new OpenClawAgentManager({
    ...c.extra,
    conversation_id: c.id,
    yoloMode: opts?.yoloMode,
  }) as unknown as ReturnType<typeof agentFactory.create>;
});
agentFactory.register('nanobot', (conv, opts) => {
  const c = asConversation<'nanobot'>(conv);
  return new NanoBotAgentManager({
    ...c.extra,
    conversation_id: c.id,
    yoloMode: opts?.yoloMode,
  }) as unknown as ReturnType<typeof agentFactory.create>;
});

agentFactory.register('remote', (conv, opts) => {
  const c = asConversation<'remote'>(conv);
  return new RemoteAgentManager({
    ...c.extra,
    conversation_id: c.id,
    yoloMode: opts?.yoloMode,
  }) as unknown as ReturnType<typeof agentFactory.create>;
});

agentFactory.register('aionrs', (conv, opts) => {
  const c = asConversation<'aionrs'>(conv);
  return new AionrsManager(
    { ...c.extra, conversation_id: c.id, yoloMode: opts?.yoloMode, model: c.model },
    c.model
  ) as unknown as ReturnType<typeof agentFactory.create>;
});

const conversationRepo = new SqliteConversationRepository();
export const workerTaskManager = new WorkerTaskManager(agentFactory, conversationRepo);

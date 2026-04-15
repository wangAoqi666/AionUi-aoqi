/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  getAssistantBackendOptions,
  LOCKED_BUILTIN_ASSISTANT_BACKEND,
} from '../../src/renderer/hooks/assistant/assistantBackendOptions';

describe('Assistant backend options', () => {
  it('includes dynamically detected backends for editable assistants', () => {
    const options = getAssistantBackendOptions({
      assistant: { isBuiltin: false },
      availableBackends: new Set(['gemini', 'claude', 'iflow']),
    });

    expect(options).toEqual([
      { value: 'gemini', label: 'Google CLI' },
      { value: 'claude', label: 'Claude Code' },
      { value: 'iflow', label: 'iFlow CLI' },
    ]);
  });

  it('falls back to the backend id for unknown entries', () => {
    const options = getAssistantBackendOptions({
      assistant: { isBuiltin: false },
      availableBackends: new Set(['some-unknown-backend']),
    });

    expect(options).toEqual([{ value: 'some-unknown-backend', label: 'some-unknown-backend' }]);
  });

  it('includes extension adapters for editable assistants', () => {
    const options = getAssistantBackendOptions({
      assistant: { isBuiltin: false },
      availableBackends: new Set(['droid']),
      extensionAcpAdapters: [{ id: 'ext-buddy', name: 'Buddy Adapter' }],
    });

    expect(options).toEqual([
      { value: 'droid', label: 'Factory Droid' },
      { value: 'ext-buddy', label: 'Buddy Adapter', isExtension: true },
    ]);
  });

  it('locks builtin assistants to Factory Droid only', () => {
    const options = getAssistantBackendOptions({
      assistant: { isBuiltin: true, presetAgentType: 'claude' },
      availableBackends: new Set(['gemini', 'claude', 'qwen']),
      extensionAcpAdapters: [{ id: 'ext-buddy', name: 'Buddy Adapter' }],
    });

    expect(options).toEqual([{ value: LOCKED_BUILTIN_ASSISTANT_BACKEND, label: 'Factory Droid' }]);
  });
});

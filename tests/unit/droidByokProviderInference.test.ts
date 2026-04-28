/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BYOK fix (2026-04-23): `inferProviderFromModel` now maps every model id
 * onto the Factory-official three-provider set (`anthropic` / `openai` /
 * `generic-chat-completion-api`). Gemini, Qwen, DeepSeek, GLM, Moonshot etc.
 * all ride on `generic-chat-completion-api` since that is the only
 * OpenAI-compatible shim the CLI accepts.
 *
 * Covers:
 *   - remote `supported_endpoint_types` overrides fuzzy matching
 *   - Claude family id → anthropic
 *   - GPT / codex / o-series ids → openai
 *   - Everything else (Gemini / Qwen / DeepSeek / GLM / unknown) → generic
 *   - `normalizeDroidByokBaseUrl` rewrites the official Gemini endpoint to
 *     `/v1beta/openai` regardless of the input suffix.
 */

import { describe, expect, it } from 'vitest';
import { inferProviderFromModel, normalizeDroidByokBaseUrl } from '@/process/bridge/services/DroidByokService';

describe('inferProviderFromModel (BYOK fuzzy match)', () => {
  it('prefers remote anthropic endpoint type over model name', () => {
    expect(inferProviderFromModel('gpt-4o', ['anthropic'])).toBe('anthropic');
  });

  it('prefers remote openai-response endpoint type over model name', () => {
    expect(inferProviderFromModel('claude-sonnet-4-5', ['openai-response'])).toBe('openai');
  });

  it('maps remote gemini endpoint type to generic-chat-completion-api', () => {
    expect(inferProviderFromModel('gemini-2.5-pro', ['gemini'])).toBe('generic-chat-completion-api');
  });

  it.each([
    'claude-sonnet-4-5',
    'claude-opus-4-1',
    'claude-3-5-haiku-20241022',
    'anthropic/claude-opus-4',
    'opus-5',
    'custom-sonnet-pro',
  ])('maps Claude-family model %s to anthropic', (model) => {
    expect(inferProviderFromModel(model, [])).toBe('anthropic');
  });

  it.each(['gpt-5-codex', 'gpt-4.1', 'gpt-4o', 'o3-mini', 'o4-turbo', 'codex-small', 'openai/gpt-5'])(
    'maps OpenAI-family model %s to openai',
    (model) => {
      expect(inferProviderFromModel(model, [])).toBe('openai');
    }
  );

  it.each([
    'gemini-2.5-pro',
    'gemini-3-flash',
    'qwen3-coder',
    'qwen-max-latest',
    'deepseek-reasoner',
    'glm-4.5',
    'kimi-k2',
    'unknown-model-123',
  ])('maps non-Factory-native model %s to generic-chat-completion-api', (model) => {
    expect(inferProviderFromModel(model, [])).toBe('generic-chat-completion-api');
  });

  it('is case-insensitive', () => {
    expect(inferProviderFromModel('CLAUDE-OPUS-4-1', [])).toBe('anthropic');
    expect(inferProviderFromModel('GPT-5-Codex', [])).toBe('openai');
    expect(inferProviderFromModel('GEMINI-2.5-PRO', [])).toBe('generic-chat-completion-api');
  });
});

describe('normalizeDroidByokBaseUrl (Gemini official rewrite)', () => {
  it('rewrites bare host to /v1beta/openai', () => {
    expect(normalizeDroidByokBaseUrl('https://generativelanguage.googleapis.com')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    );
  });

  it('rewrites host + /v1beta to /v1beta/openai', () => {
    expect(normalizeDroidByokBaseUrl('https://generativelanguage.googleapis.com/v1beta')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    );
  });

  it('is idempotent when already /v1beta/openai', () => {
    expect(normalizeDroidByokBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    );
  });

  it('leaves third-party OpenAI-compatible base URLs untouched (no /v1 stripping when it carries /v1beta)', () => {
    expect(normalizeDroidByokBaseUrl('https://custom-proxy.example.com/v1beta/openai')).toBe(
      'https://custom-proxy.example.com/v1beta/openai'
    );
  });

  it('strips trailing /v1 for non-Gemini hosts', () => {
    expect(normalizeDroidByokBaseUrl('https://api.openai-compat.example.com/v1')).toBe(
      'https://api.openai-compat.example.com'
    );
  });
});

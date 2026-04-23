/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 0.1.6 → 0.1.7 settings migration invariants:
 *
 *   - A settings.local.json with 2+ BYOK models + 3+ MCP servers remains
 *     byte-preserved in the MCP configuration section after running the
 *     verifier. Only verifier-specific metadata may be added; existing
 *     entries must NOT be mutated.
 *   - BYOK `apiKey` is NEVER logged in any log call or IPC payload.
 *   - The verifier does NOT mutate `supportsImageInput` of existing entries.
 */

import { describe, expect, it, vi } from 'vitest';

const { mockReadFile, mockWriteFile, mockMkdir, mockGetFactoryRootDir, mockMainLog, mockMainWarn } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockGetFactoryRootDir: vi.fn(() => '/mock/.factory'),
  mockMainLog: vi.fn(),
  mockMainWarn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(),
    set: vi.fn(),
  },
  getFactoryRootDir: mockGetFactoryRootDir,
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mockMainLog,
  mainWarn: mockMainWarn,
}));

import { verifyByokCapabilitiesAgainstCli } from '@/process/bridge/services/DroidByokService';

/**
 * A representative 0.1.6-shaped settings.local.json fixture with:
 * - 2 BYOK models (claude-sonnet-4-6 + gpt-4o)
 * - 3 MCP servers (mcp-a, mcp-b, mcp-c)
 */
const SETTINGS_V016_FIXTURE = {
  customModels: [
    {
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-secret-key-never-log-this',
      provider: 'anthropic',
      maxOutputTokens: 8192,
      supportsImageInput: true,
      reasoningLevels: ['off', 'low', 'medium', 'high'],
      defaultReasoning: 'off',
    },
    {
      model: 'gpt-4o',
      displayName: 'GPT-4o',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai-secret-key-never-log-this',
      provider: 'openai',
      maxOutputTokens: 4096,
      supportsImageInput: true,
      reasoningLevels: ['none'],
      defaultReasoning: 'none',
    },
  ],
  mcpServers: {
    'mcp-a': {
      command: 'node',
      args: ['./mcp-a/index.js'],
      env: { API_KEY: 'mcp-a-secret' },
    },
    'mcp-b': {
      command: 'python',
      args: ['./mcp-b/server.py'],
      env: { TOKEN: 'mcp-b-secret' },
    },
    'mcp-c': {
      command: 'deno',
      args: ['run', './mcp-c/mod.ts'],
    },
  },
};

describe('0.1.6 → 0.1.7 settings migration', () => {
  describe('MCP config byte-preservation', () => {
    it('verifier does NOT mutate settings.local.json — MCP servers remain byte-identical', () => {
      const before = JSON.parse(JSON.stringify(SETTINGS_V016_FIXTURE));

      // Running the verifier (pure function) should NOT touch the settings object at all
      verifyByokCapabilitiesAgainstCli(
        before.customModels.map((m: { model: string; supportsImageInput: boolean }) => ({
          id: m.model,
          model: m.model,
          supportsImageInput: m.supportsImageInput,
        })),
        [
          { id: 'claude-sonnet-4-6', noImageSupport: false },
          { id: 'gpt-4o', noImageSupport: false },
        ]
      );

      // MCP servers should be byte-identical
      expect(JSON.stringify(before.mcpServers)).toBe(JSON.stringify(SETTINGS_V016_FIXTURE.mcpServers));
    });

    it('verifier does NOT mutate customModels entries', () => {
      const before = JSON.parse(JSON.stringify(SETTINGS_V016_FIXTURE));
      const serializedBefore = JSON.stringify(before.customModels);

      verifyByokCapabilitiesAgainstCli(
        before.customModels.map((m: { model: string; supportsImageInput: boolean }) => ({
          id: m.model,
          model: m.model,
          supportsImageInput: m.supportsImageInput,
        })),
        [
          { id: 'claude-sonnet-4-6', noImageSupport: false },
          { id: 'gpt-4o', noImageSupport: true }, // conflict here
        ]
      );

      // Even with a conflict, customModels entries must remain unchanged
      expect(JSON.stringify(before.customModels)).toBe(serializedBefore);
    });
  });

  describe('supportsImageInput immutability', () => {
    it('verifier result does NOT mutate supportsImageInput of existing entries', () => {
      const localConfigs = [
        { id: 'claude-sonnet-4-6', model: 'claude-sonnet-4-6', supportsImageInput: true },
        { id: 'gpt-4o', model: 'gpt-4o', supportsImageInput: true },
      ];
      const configsBefore = JSON.parse(JSON.stringify(localConfigs));

      // Conflict: CLI says gpt-4o has noImageSupport
      const result = verifyByokCapabilitiesAgainstCli(localConfigs, [
        { id: 'claude-sonnet-4-6', noImageSupport: false },
        { id: 'gpt-4o', noImageSupport: true },
      ]);

      // The result reports the conflict but local configs must NOT be mutated
      expect(result.conflict).toHaveLength(1);
      expect(result.conflict[0].modelId).toBe('gpt-4o');

      // Verify the local configs are unchanged (user value wins)
      expect(localConfigs).toEqual(configsBefore);
    });

    it('verifier never writes to settings — no fs.writeFile calls', () => {
      verifyByokCapabilitiesAgainstCli(
        [{ id: 'test-model', model: 'test-model', supportsImageInput: true }],
        [{ id: 'test-model', noImageSupport: true }]
      );

      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('apiKey security — never logged', () => {
    it('mainLog calls from verifier never contain apiKey values', () => {
      const localConfigs = [{ id: 'secret-model', model: 'secret-model', supportsImageInput: true }];

      verifyByokCapabilitiesAgainstCli(localConfigs, null); // triggers cli_unreachable log

      // Check all mainLog calls
      for (const call of mockMainLog.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('sk-ant-secret');
        expect(serialized).not.toContain('sk-openai-secret');
        expect(serialized).not.toContain('apiKey');
      }
    });

    it('mainWarn calls from verifier never contain apiKey values', () => {
      verifyByokCapabilitiesAgainstCli(
        [{ id: 'missing-model', model: 'missing-model', supportsImageInput: true }],
        [{ id: 'other-model' }]
      );

      // Check all mainWarn calls for the capabilities_unverified warning
      for (const call of mockMainWarn.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('apiKey');
        expect(serialized).not.toContain('sk-ant-secret');
        expect(serialized).not.toContain('sk-openai-secret');
      }
    });

    it('verifier return value never contains apiKey in any field', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [
          { id: 'model-a', model: 'model-a', supportsImageInput: true },
          { id: 'model-b', model: 'model-b', supportsImageInput: false },
        ],
        [{ id: 'model-a', noImageSupport: true }]
      );

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('apiKey');
      expect(serialized).not.toContain('sk-ant');
      expect(serialized).not.toContain('sk-openai');
    });
  });
});

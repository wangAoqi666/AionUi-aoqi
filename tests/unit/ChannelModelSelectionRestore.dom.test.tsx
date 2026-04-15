import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  };
});

const mockLoadChannelInstanceSettings = vi.fn();
const mockUpdateChannelInstanceSettings = vi.fn();

vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/channelInstanceSettings', () => ({
  loadChannelInstanceSettings: (...args: unknown[]) => mockLoadChannelInstanceSettings(...args),
  updateChannelInstanceSettings: (...args: unknown[]) => mockUpdateChannelInstanceSettings(...args),
}));

let mockProviders: Array<{ id: string; name: string; model: string[]; platform?: string }> = [];

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: mockProviders,
    geminiModeLookup: new Map(),
    getAvailableModels: () => [],
    formatModelLabel: (_p: unknown, m?: string) => m || '',
  }),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiModelSelection', () => ({
  useGeminiModelSelection: ({ initialModel }: { initialModel: { useModel?: string } | undefined }) => ({
    currentModel: initialModel,
    providers: mockProviders,
    geminiModeLookup: new Map(),
    formatModelLabel: () => '',
    getDisplayModelName: () => '',
    getAvailableModels: () => [],
    handleSelectModel: vi.fn(),
  }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  channel: {
    syncChannelSettings: { invoke: vi.fn(async () => ({ success: true })) },
  },
}));

import { useChannelInstanceModelSelection } from '@/renderer/components/settings/SettingsModal/contents/channels/useChannelInstanceModelSelection';

const Probe: React.FC = () => {
  const selection = useChannelInstanceModelSelection('telegram_default', 'telegram');
  return <div data-testid='current-model'>{selection.currentModel?.useModel || 'none'}</div>;
};

describe('useChannelInstanceModelSelection restore retry limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviders = [];
  });

  it('stops retrying after MAX_RESTORE_RETRIES when the saved provider is stale', async () => {
    mockLoadChannelInstanceSettings.mockResolvedValue({
      defaultModel: { id: 'deleted-provider', useModel: 'some-model' },
    });
    mockProviders = [{ id: 'provider-1', name: 'Provider One', model: ['model-a', 'model-b'] }];

    const { rerender } = render(<Probe />);

    for (let index = 0; index < 10; index += 1) {
      mockProviders = [{ id: 'provider-1', name: 'Provider One', model: ['model-a', 'model-b'] }];
      await act(async () => {
        rerender(<Probe />);
      });
    }

    expect(mockLoadChannelInstanceSettings.mock.calls.length).toBeLessThanOrEqual(5);
    expect(screen.getByTestId('current-model').textContent).toBe('none');
  });

  it('restores the saved model when the provider exists', async () => {
    mockLoadChannelInstanceSettings.mockResolvedValue({
      defaultModel: { id: 'provider-1', useModel: 'model-a' },
    });
    mockProviders = [{ id: 'provider-1', name: 'Provider One', model: ['model-a', 'model-b'] }];

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByTestId('current-model').textContent).toBe('model-a');
    });
    expect(mockLoadChannelInstanceSettings).toHaveBeenCalledTimes(1);
  });
});

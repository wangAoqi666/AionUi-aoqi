import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueueItem = {
  commandId: string;
  input: string;
  files: string[];
  createdAt: number;
};

const queueSpies = {
  enqueue: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  reorder: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  lockInteraction: vi.fn(),
  unlockInteraction: vi.fn(),
  resetActiveExecution: vi.fn(),
};

const mockShouldEnqueueConversationCommand = vi.fn(() => false);
const mockUseConversationCommandQueue = vi.fn(() => ({
  items: [] as QueueItem[],
  isPaused: false,
  isInteractionLocked: false,
  hasPendingCommands: false,
  ...queueSpies,
}));

const mockConversationGetInvoke = vi.fn();
const mockConversationListChangedOn = vi.fn();
const mockConversationStopInvoke = vi.fn();
const mockConversationSendInvoke = vi.fn();
const mockAcpSendInvoke = vi.fn();
const mockAcpGetModeInvoke = vi.fn();
const mockAcpSetModeInvoke = vi.fn();
const mockGeminiSendInvoke = vi.fn();
const mockOpenClawSendInvoke = vi.fn();
const mockOpenClawRuntimeInvoke = vi.fn();
const mockDatabaseMessagesInvoke = vi.fn();

const mockAddOrUpdateMessage = vi.fn();
const mockRemoveMessageByMsgId = vi.fn();
const mockCheckAndUpdateTitle = vi.fn();
const mockEmitterEmit = vi.fn();
const mockArcoError = vi.fn();
const mockArcoWarning = vi.fn();
const mockArcoSuccess = vi.fn();
const mockAssertBridgeSuccess = vi.fn();
const mockSetSendBoxHandler = vi.fn();
const mockClearFiles = vi.fn();
const mockUseAcpMessage = vi.fn();

let uuidCounter = 0;

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: (...args: unknown[]) => mockConversationGetInvoke(...args) },
      listChanged: { on: (...args: unknown[]) => mockConversationListChangedOn(...args) },
      stop: { invoke: (...args: unknown[]) => mockConversationStopInvoke(...args) },
      sendMessage: { invoke: (...args: unknown[]) => mockConversationSendInvoke(...args) },
      responseStream: { on: vi.fn(() => vi.fn()) },
    },
    acpConversation: {
      getMode: { invoke: (...args: unknown[]) => mockAcpGetModeInvoke(...args) },
      sendMessage: { invoke: (...args: unknown[]) => mockAcpSendInvoke(...args) },
      setMode: { invoke: (...args: unknown[]) => mockAcpSetModeInvoke(...args) },
    },
    geminiConversation: {
      sendMessage: { invoke: (...args: unknown[]) => mockGeminiSendInvoke(...args) },
    },
    openclawConversation: {
      sendMessage: { invoke: (...args: unknown[]) => mockOpenClawSendInvoke(...args) },
      getRuntime: { invoke: (...args: unknown[]) => mockOpenClawRuntimeInvoke(...args) },
      responseStream: { on: vi.fn(() => vi.fn()) },
    },
    database: {
      getConversationMessages: { invoke: (...args: unknown[]) => mockDatabaseMessagesInvoke(...args) },
    },
  },
}));

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: vi.fn((message: unknown) => message),
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => `uuid-${++uuidCounter}`),
}));

vi.mock('@/renderer/components/chat/sendbox', () => ({
  __esModule: true,
  default: ({
    disabled,
    loading,
    onSend,
    onStop,
    tools,
  }: {
    disabled?: boolean;
    loading?: boolean;
    onSend: (message: string) => Promise<void> | void;
    onStop?: () => Promise<void> | void;
    tools?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement('div', { 'data-testid': 'sendbox-tools' }, tools),
      React.createElement('div', { 'data-testid': 'sendbox-loading' }, String(Boolean(loading))),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled,
          onClick: () => {
            void Promise.resolve(onSend('queued command')).catch(() => {});
          },
        },
        'trigger-send'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void Promise.resolve(onStop?.()).catch(() => {});
          },
        },
        'trigger-stop'
      )
    ),
}));

vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({
  __esModule: true,
  default: ({ items }: { items: QueueItem[] }) =>
    React.createElement('div', { 'data-testid': 'queue-panel' }, String(items.length)),
}));

vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({
  __esModule: true,
  default: ({ running }: { running?: boolean }) =>
    React.createElement('div', { 'data-testid': 'thought-display', 'data-running': String(Boolean(running)) }),
}));

vi.mock('@/renderer/components/media/FilePreview', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@/renderer/components/media/FileAttachButton', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  __esModule: true,
  default: ({ initialMode }: { initialMode?: string }) =>
    React.createElement('div', { 'data-testid': 'agent-mode-selector' }, initialMode ?? ''),
}));

vi.mock('@/renderer/components/agent/AcpConfigSelector', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/agent/ContextUsageIndicator', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/agent/AgentSetupCard', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: vi.fn(() =>
    vi.fn(() => ({
      data: {
        atPath: [],
        content: '',
        uploadFile: [],
      },
      mutate: vi.fn(),
    }))
  ),
}));

vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  createSetUploadFile: vi.fn(() => vi.fn()),
  useSendBoxFiles: vi.fn(() => ({
    handleFilesAdded: vi.fn(),
    clearFiles: mockClearFiles,
  })),
}));

vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({
    checkAndUpdateTitle: mockCheckAndUpdateTitle,
  }),
}));

vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({
  useSlashCommands: vi.fn(() => []),
}));

vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: vi.fn(() => ({
    openFileSelector: vi.fn(),
    onSlashBuiltinCommand: vi.fn(),
  })),
}));

vi.mock('@/renderer/hooks/ui/useLatestRef', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  return {
    useLatestRef: <T,>(value: T) => {
      const ref = ReactModule.useRef(value);
      ref.current = value;
      return ref;
    },
  };
});

vi.mock('@/renderer/hooks/agent/useAgentReadinessCheck', () => ({
  useAgentReadinessCheck: vi.fn(() => ({
    isChecking: false,
    error: null,
    availableAgents: [],
    bestAgent: null,
    progress: 0,
    currentAgent: null,
    performFullCheck: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  })),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => mockAddOrUpdateMessage,
  useRemoveMessageByMsgId: () => mockRemoveMessageByMsgId,
}));

vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  shouldEnqueueConversationCommand: (...args: unknown[]) => mockShouldEnqueueConversationCommand(...args),
  useConversationCommandQueue: (...args: unknown[]) => mockUseConversationCommandQueue(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/assertBridgeSuccess', () => ({
  assertBridgeSuccess: (...args: unknown[]) => mockAssertBridgeSuccess(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/useAcpMessage', () => ({
  useAcpMessage: (...args: unknown[]) => mockUseAcpMessage(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/useAcpInitialMessage', () => ({
  useAcpInitialMessage: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiMessage', () => ({
  useGeminiMessage: vi.fn(() => ({
    thought: { subject: '', description: '' },
    running: false,
    tokenUsage: 0,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
  })),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiQuotaFallback', () => ({
  useGeminiQuotaFallback: vi.fn(() => ({
    handleGeminiError: vi.fn(),
  })),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiInitialMessage', () => ({
  useGeminiInitialMessage: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: mockSetSendBoxHandler,
  }),
}));

vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: ['.txt'],
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: {
    secondary: '#999999',
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => mockEmitterEmit(...args),
  },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn((current: unknown) => current),
}));

vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: vi.fn(
    (input: string, files: string[], workspacePath: string) => `${input}|${files.join(',')}|${workspacePath}`
  ),
  collectSelectedFiles: vi.fn((uploadFile: string[], atPath: Array<string | { path: string }>) => [
    ...uploadFile,
    ...atPath.map((item) => (typeof item === 'string' ? item : item.path)),
  ]),
}));

vi.mock('@/renderer/utils/model/modelContextLimits', () => ({
  getModelContextLimit: vi.fn(() => 8192),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: (...args: unknown[]) => mockArcoError(...args),
    warning: (...args: unknown[]) => mockArcoWarning(...args),
    success: (...args: unknown[]) => mockArcoSuccess(...args),
  },
  Tag: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  Badge: (props: Record<string, unknown>) => React.createElement('span', { 'data-status': props.status }),
  Empty: (props: { description?: string }) => React.createElement('div', {}, props.description),
  Typography: {
    Text: (props: Record<string, unknown>) => React.createElement('span', {}, props.children as React.ReactNode),
  },
}));

vi.mock('@icon-park/react', () => ({
  Shield: () => React.createElement('span'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; backend?: string; model?: string }) =>
      options?.defaultValue ?? options?.backend ?? options?.model ?? key,
  }),
}));

import AcpSendBox from '@/renderer/pages/conversation/platforms/acp/AcpSendBox';
import GeminiSendBox from '@/renderer/pages/conversation/platforms/gemini/GeminiSendBox';
import NanobotSendBox from '@/renderer/pages/conversation/platforms/nanobot/NanobotSendBox';
import OpenClawSendBox from '@/renderer/pages/conversation/platforms/openclaw/OpenClawSendBox';

const resetQueueSpies = () => {
  for (const spy of Object.values(queueSpies)) {
    spy.mockReset();
  }
};

describe('platform send box queue integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    resetQueueSpies();

    mockShouldEnqueueConversationCommand.mockReturnValue(false);
    mockUseConversationCommandQueue.mockReturnValue({
      items: [],
      isPaused: false,
      isInteractionLocked: false,
      hasPendingCommands: false,
      ...queueSpies,
    });

    mockConversationGetInvoke.mockResolvedValue({
      status: 'idle',
      extra: {
        workspace: 'C:/workspace',
      },
    });
    mockConversationListChangedOn.mockImplementation(() => vi.fn());
    mockConversationStopInvoke.mockResolvedValue(undefined);
    mockConversationSendInvoke.mockResolvedValue({ success: true });
    mockAcpSendInvoke.mockResolvedValue({ success: true });
    mockAcpGetModeInvoke.mockResolvedValue({ success: true, data: { mode: 'default', initialized: false } });
    mockAcpSetModeInvoke.mockResolvedValue({ success: true, data: { mode: 'default' } });
    mockGeminiSendInvoke.mockResolvedValue({ success: true });
    mockOpenClawSendInvoke.mockResolvedValue({ success: true });
    mockOpenClawRuntimeInvoke.mockResolvedValue({
      success: true,
      data: {
        runtime: {
          workspace: 'C:/workspace',
          backend: 'openclaw',
          agentName: 'OpenClaw',
          cliPath: 'C:/cli/openclaw',
          model: 'model-a',
          identityHash: 'identity-1',
          hasActiveSession: true,
        },
        expected: {
          expectedWorkspace: 'C:/workspace',
          expectedBackend: 'openclaw',
          expectedAgentName: 'OpenClaw',
          expectedCliPath: 'C:/cli/openclaw',
          expectedModel: 'model-a',
          expectedIdentityHash: 'identity-1',
        },
      },
    });
    mockDatabaseMessagesInvoke.mockResolvedValue([]);
    mockUseAcpMessage.mockReturnValue({
      thought: { subject: '', description: '' },
      running: false,
      hasHydratedRunningState: true,
      acpStatus: null,
      aiProcessing: false,
      setAiProcessing: vi.fn(),
      resetState: vi.fn(),
      tokenUsage: 0,
      contextLimit: 0,
      hasThinkingMessage: false,
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it.each([
    [
      'acp',
      <AcpSendBox conversation_id='conv-acp' backend='claude' />,
      mockAcpSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toBe('queued command');
        expect(payload.conversation_id).toBe('conv-acp');
      },
    ],
    [
      'gemini',
      <GeminiSendBox
        conversation_id='conv-gemini'
        modelSelection={{
          currentModel: { useModel: 'gemini-2.5' },
          getDisplayModelName: (modelId: string) => modelId,
          providers: ['google'],
          geminiModeLookup: {},
          getAvailableModels: () => [],
          handleSelectModel: vi.fn(),
        }}
      />,
      mockGeminiSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toContain('queued command');
        expect(payload.conversation_id).toBe('conv-gemini');
      },
    ],
    [
      'nanobot',
      <NanobotSendBox conversation_id='conv-nanobot' />,
      mockConversationSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toContain('queued command');
        expect(payload.conversation_id).toBe('conv-nanobot');
      },
    ],
    [
      'openclaw',
      <OpenClawSendBox conversation_id='conv-openclaw' />,
      mockOpenClawSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toContain('queued command');
        expect(payload.conversation_id).toBe('conv-openclaw');
      },
    ],
  ])(
    'sends commands immediately for %s when queueing is not required',
    async (_name, element, sendSpy, assertPayload) => {
      render(element);

      fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

      await waitFor(() => {
        expect(sendSpy).toHaveBeenCalledTimes(1);
      });

      assertPayload(sendSpy.mock.calls[0]?.[0] as { input: string; conversation_id: string });
      expect(queueSpies.enqueue).not.toHaveBeenCalled();
      expect(mockAssertBridgeSuccess).toHaveBeenCalled();
    }
  );

  it.each([
    ['acp', <AcpSendBox conversation_id='conv-acp' backend='claude' />],
    [
      'gemini',
      <GeminiSendBox
        conversation_id='conv-gemini'
        modelSelection={{
          currentModel: { useModel: 'gemini-2.5' },
          getDisplayModelName: (modelId: string) => modelId,
          providers: ['google'],
          geminiModeLookup: {},
          getAvailableModels: () => [],
          handleSelectModel: vi.fn(),
        }}
      />,
    ],
    ['nanobot', <NanobotSendBox conversation_id='conv-nanobot' />],
    ['openclaw', <OpenClawSendBox conversation_id='conv-openclaw' />],
  ])('enqueues commands for %s when the current turn is still busy', async (_name, element) => {
    mockShouldEnqueueConversationCommand.mockReturnValue(true);

    render(element);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(queueSpies.enqueue).toHaveBeenCalledWith({
        input: 'queued command',
        files: [],
      });
    });
  });

  it('re-applies the selected ACP mode before dispatching the turn', async () => {
    const callOrder: string[] = [];
    mockAcpSetModeInvoke.mockImplementation(async () => {
      callOrder.push('set-mode');
      return { success: true, data: { mode: 'spec' } };
    });
    mockAcpSendInvoke.mockImplementation(async () => {
      callOrder.push('send');
      return { success: true };
    });

    render(<AcpSendBox conversation_id='conv-acp' backend='droid' sessionMode='spec' />);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(mockAcpSetModeInvoke).toHaveBeenCalledWith({
        conversationId: 'conv-acp',
        mode: 'spec',
      });
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(callOrder).toEqual(['set-mode', 'send']);
  });

  it('syncs the visible ACP mode pill when the conversation mode changes externally', async () => {
    let listChangedHandler: ((event: { conversationId: string; action: string }) => void) | undefined;
    mockConversationListChangedOn.mockImplementation(
      (handler: (event: { conversationId: string; action: string }) => void) => {
        listChangedHandler = handler;
        return vi.fn();
      }
    );
    mockAcpGetModeInvoke
      .mockResolvedValueOnce({ success: true, data: { mode: 'spec', initialized: false } })
      .mockResolvedValueOnce({ success: true, data: { mode: 'yolo', initialized: true } });

    render(<AcpSendBox conversation_id='conv-acp' backend='droid' sessionMode='spec' />);

    expect(screen.getByTestId('agent-mode-selector')).toHaveTextContent('spec');

    listChangedHandler?.({ conversationId: 'conv-acp', action: 'updated' });

    await waitFor(() => {
      expect(mockAcpGetModeInvoke).toHaveBeenCalledWith({ conversationId: 'conv-acp' });
      expect(screen.getByTestId('agent-mode-selector')).toHaveTextContent('yolo');
    });
  });

  it('keeps the ACP processing indicator visible while the turn is still running', () => {
    mockUseAcpMessage.mockReturnValue({
      thought: { subject: '', description: '' },
      running: true,
      hasHydratedRunningState: true,
      acpStatus: null,
      aiProcessing: false,
      setAiProcessing: vi.fn(),
      resetState: vi.fn(),
      tokenUsage: 0,
      contextLimit: 0,
      hasThinkingMessage: true,
    });

    render(<AcpSendBox conversation_id='conv-acp' backend='droid' />);

    expect(screen.getByTestId('thought-display')).toHaveAttribute('data-running', 'true');
  });

  it.each([
    ['acp', <AcpSendBox conversation_id='conv-acp' backend='claude' />],
    [
      'gemini',
      <GeminiSendBox
        conversation_id='conv-gemini'
        modelSelection={{
          currentModel: { useModel: 'gemini-2.5' },
          getDisplayModelName: (modelId: string) => modelId,
          providers: ['google'],
          geminiModeLookup: {},
          getAvailableModels: () => [],
          handleSelectModel: vi.fn(),
        }}
      />,
    ],
    ['nanobot', <NanobotSendBox conversation_id='conv-nanobot' />],
    ['openclaw', <OpenClawSendBox conversation_id='conv-openclaw' />],
  ])('renders a full-width dock wrapper for %s', (_name, element) => {
    render(element);

    const wrapper = screen.getByTestId('sendbox-loading').parentElement?.parentElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper).toHaveClass('w-full', 'flex', 'flex-col', 'mt-auto', 'mb-8px');
    expect(wrapper?.className).not.toContain('max-w-800px');
    expect(wrapper?.className).not.toContain('mx-auto');
  });

  it.each([
    ['acp', <AcpSendBox conversation_id='conv-acp' backend='claude' />],
    [
      'gemini',
      <GeminiSendBox
        conversation_id='conv-gemini'
        modelSelection={{
          currentModel: { useModel: 'gemini-2.5' },
          getDisplayModelName: (modelId: string) => modelId,
          providers: ['google'],
          geminiModeLookup: {},
          getAvailableModels: () => [],
          handleSelectModel: vi.fn(),
        }}
      />,
    ],
    ['nanobot', <NanobotSendBox conversation_id='conv-nanobot' />],
    ['openclaw', <OpenClawSendBox conversation_id='conv-openclaw' />],
  ])('resets active execution after stop for %s', async (_name, element) => {
    render(element);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-stop' }));

    await waitFor(() => {
      expect(mockConversationStopInvoke).toHaveBeenCalled();
    });

    expect(queueSpies.resetActiveExecution).toHaveBeenCalledWith('stop');
  });

  it('blocks OpenClaw dispatch when runtime validation fails', async () => {
    mockOpenClawRuntimeInvoke.mockResolvedValue({
      success: true,
      data: {
        runtime: {
          workspace: 'C:/another-workspace',
          backend: 'openclaw',
          agentName: 'OpenClaw',
          cliPath: 'C:/cli/openclaw',
          model: 'model-a',
          identityHash: 'identity-1',
          hasActiveSession: true,
        },
        expected: {
          expectedWorkspace: 'C:/workspace',
          expectedBackend: 'openclaw',
          expectedAgentName: 'OpenClaw',
          expectedCliPath: 'C:/cli/openclaw',
          expectedModel: 'model-a',
          expectedIdentityHash: 'identity-1',
        },
      },
    });

    render(<OpenClawSendBox conversation_id='conv-openclaw' />);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(mockArcoError).toHaveBeenCalledWith(expect.stringContaining('Agent switch validation failed'));
    });

    expect(mockOpenClawSendInvoke).not.toHaveBeenCalled();
  });
});

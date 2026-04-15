import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { previewState, navigateMock } = vi.hoisted(() => ({
  previewState: { isOpen: false },
  navigateMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ state: null }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, icon, ...props }: React.ComponentProps<'button'> & { icon?: React.ReactNode }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
  ConfigProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Dropdown: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Menu: Object.assign(({ children }: React.PropsWithChildren) => <div>{children}</div>, {
    Item: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  }),
  Message: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span>Down</span>,
  Left: () => <span>Left</span>,
  Robot: () => <span>Robot</span>,
  Write: () => <span>Write</span>,
}));

vi.mock('@/common/utils', () => ({
  resolveLocaleKey: () => 'zh-CN',
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: vi.fn(async () => []),
    set: vi.fn(async () => undefined),
  },
}));

vi.mock('@/common/types/acpTypes', () => ({
  ACP_BACKENDS_ALL: {
    droid: { name: 'Factory Droid' },
  },
}));

vi.mock('@/renderer/hooks/assistant', () => ({
  getAssistantBackendOptions: () => [],
  resolveAssistantPresetAgentType: () => 'droid',
  useAssistantBackends: () => ({
    availableBackends: [],
    extensionAcpAdapters: [],
  }),
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(async () => undefined),
  resolveExtensionAssetUrl: vi.fn(() => ''),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: () => undefined,
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    closeAllTabs: vi.fn(),
    openTab: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  PreviewPanel: () => <div data-testid='preview-panel'>preview-panel</div>,
  usePreviewContext: () => previewState,
}));

vi.mock('@/renderer/pages/guid/constants', () => ({
  CUSTOM_AVATAR_IMAGE_MAP: {},
}));

vi.mock('@/renderer/pages/guid/components/AgentPillBar', () => ({
  default: () => <div data-testid='agent-pill-bar' />,
}));

vi.mock('@/renderer/pages/guid/components/AssistantSelectionArea', () => ({
  default: () => <div data-testid='assistant-selection-area' />,
}));

vi.mock('@/renderer/pages/guid/components/GuidSkeleton', () => ({
  AgentPillBarSkeleton: () => <div data-testid='agent-pill-bar-skeleton' />,
}));

vi.mock('@/renderer/pages/guid/components/GuidActionRow', () => ({
  default: () => <div data-testid='guid-action-row' />,
}));

vi.mock('@/renderer/pages/guid/components/GuidInputCard', () => ({
  default: ({ actionRow }: { actionRow?: React.ReactNode }) => <div data-testid='guid-input-card'>{actionRow}</div>,
}));

vi.mock('@/renderer/pages/guid/components/GuidModelSelector', () => ({
  default: () => <div data-testid='guid-model-selector' />,
}));

vi.mock('@/renderer/pages/guid/components/MentionDropdown', () => ({
  default: () => <div data-testid='mention-dropdown' />,
  MentionSelectorBadge: () => <div data-testid='mention-selector-badge' />,
}));

vi.mock('@/renderer/pages/guid/components/QuickActionButtons', () => ({
  default: () => <div data-testid='quick-actions' />,
}));

vi.mock('@/renderer/pages/guid/components/SkillsMarketBanner', () => ({
  default: () => <div data-testid='skills-banner' />,
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidAgentSelection', () => ({
  useGuidAgentSelection: () => ({
    availableAgents: [],
    customAgentAvatarMap: {},
    selectedAgentKey: 'droid',
    setSelectedAgentKey: vi.fn(),
    selectedAgentInfo: undefined,
    selectedAgent: 'droid',
    isPresetAgent: false,
    selectedMode: 'default',
    selectedAcpModel: undefined,
    pendingConfigOptions: [],
    cachedConfigOptions: [],
    findAgentByKey: vi.fn(),
    getEffectiveAgentType: () => 'droid',
    resolvePresetRulesAndSkills: () => [],
    resolveEnabledSkills: () => [],
    isMainAgentAvailable: true,
    getAvailableFallbackAgent: () => null,
    currentEffectiveAgentInfo: { agentType: 'droid', isAvailable: true },
    customAgents: [],
    defaultAgentKey: 'droid',
    getAgentKey: (agent: { key?: string }) => agent.key ?? '',
    currentAcpCachedModelInfo: undefined,
    setSelectedAcpModel: vi.fn(),
    setSelectedMode: vi.fn(),
    setPendingConfigOption: vi.fn(),
    refreshCustomAgents: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidInput', () => ({
  useGuidInput: () => ({
    input: '',
    setInput: vi.fn(),
    files: [],
    setFiles: vi.fn(),
    dir: '',
    setDir: vi.fn(),
    setLoading: vi.fn(),
    loading: false,
    onPaste: vi.fn(),
    handleTextareaFocus: vi.fn(),
    handleTextareaBlur: vi.fn(),
    isInputFocused: false,
    isFileDragging: false,
    dragHandlers: {},
    handleRemoveFile: vi.fn(),
    handleFilesUploaded: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidMention', () => ({
  useGuidMention: () => ({
    mentionMatchRegex: /$^/,
    setMentionQuery: vi.fn(),
    setMentionOpen: vi.fn(),
    setMentionSelectorOpen: vi.fn(),
    setMentionActiveIndex: vi.fn(),
    filteredMentionOptions: [],
    mentionQuery: null,
    mentionOpen: false,
    mentionSelectorOpen: false,
    mentionSelectorVisible: false,
    selectedAgentLabel: 'Factory Droid',
    mentionMenuRef: { current: null },
    mentionMenuSelectedKey: undefined,
    selectMentionAgent: vi.fn(),
    setMentionSelectorVisible: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({
    modelList: [],
    isGoogleAuth: false,
    currentModel: undefined,
    setCurrentModel: vi.fn(),
    geminiModeLookup: {},
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidSend', () => ({
  useGuidSend: () => ({
    sendMessageHandler: vi.fn(),
    isButtonDisabled: false,
    handleSend: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useTypewriterPlaceholder', () => ({
  useTypewriterPlaceholder: () => 'placeholder',
}));

import GuidPage from '@/renderer/pages/guid/GuidPage';

describe('GuidPage preview integration', () => {
  beforeEach(() => {
    previewState.isOpen = false;
    navigateMock.mockReset();
  });

  it('keeps the preview panel hidden when no preview is open', () => {
    render(<GuidPage />);

    expect(screen.getByTestId('guid-input-card')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
  });

  it('renders the preview panel on the guid page when preview is open', () => {
    previewState.isOpen = true;

    render(<GuidPage />);

    expect(screen.getByTestId('guid-input-card')).toBeInTheDocument();
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument();
  });
});

/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { DEFAULT_MODE, getAgentModes, supportsModeSwitch, type AgentModeOption } from '@/renderer/utils/model/agentModes';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { iconColors } from '@/renderer/styles/colors';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import { Button, Dropdown, Menu, Message } from '@arco-design/web-react';
import { Down, Robot } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AllowedToolsSelector from './AllowedToolsSelector';
import MarqueePillLabel from './MarqueePillLabel';
import SkipPermissionsConfirmModal from './SkipPermissionsConfirmModal';

/**
 * Modes that trigger the "真 YOLO" skipPermissionsUnsafe confirmation flow.
 * Both canonical YOLO ids are covered so Claude's `bypassPermissions` + Droid's
 * `yolo` route through the same gate.
 */
const YOLO_MODE_IDS = new Set(['yolo', 'bypassPermissions']);
const isYoloModeId = (mode: string | undefined): boolean => !!mode && YOLO_MODE_IDS.has(mode);

export interface AgentModeSelectorProps {
  /** Agent backend type / 代理后端类型 */
  backend?: string;
  /** Display name for the agent / 代理显示名称 */
  agentName?: string;
  /** Custom agent logo (SVG path or emoji) / 自定义代理 logo */
  agentLogo?: string;
  /** Whether the logo is an emoji / logo 是否为 emoji */
  agentLogoIsEmoji?: boolean;
  /** Conversation ID for mode switching / 用于切换模式的会话 ID */
  conversationId?: string;
  /** Compact mode: only show mode label + dropdown, no logo/name / 紧凑模式：仅显示模式标签和下拉 */
  compact?: boolean;
  /** Show agent logo in compact mode / 紧凑模式是否显示代理图标 */
  showLogoInCompact?: boolean;
  /** Compact label content: mode label or agent name / 紧凑模式文案：模式名或代理名 */
  compactLabelType?: 'mode' | 'agent';
  /** Initial mode override (for Guid page pre-conversation selection) */
  initialMode?: string;
  /** Callback when mode is selected locally (no conversationId needed) */
  onModeSelect?: (mode: string) => void;
  /** Optional compact label override */
  compactLabelOverride?: string;
  /** Optional compact leading icon */
  compactLeadingIcon?: React.ReactNode;
  /** Optional display label formatter for mode options */
  modeLabelFormatter?: (mode: AgentModeOption) => string;
  /** Optional compact prefix text, e.g. "Permission" / "权限" */
  compactLabelPrefix?: string;
  /** Hide compact prefix on mobile */
  hideCompactLabelPrefixOnMobile?: boolean;
  /** Callback fired after a successful mode change (for team-mode propagation) */
  onModeChanged?: (mode: string) => void;
}

/**
 * AgentModeSelector - A dropdown component for switching agent modes
 * Displays agent logo and name, with dropdown menu for mode selection
 *
 * 代理模式选择器 - 用于切换代理模式的下拉组件
 * 显示代理 logo 和名称，通过下拉菜单选择模式
 */
const AgentModeSelector: React.FC<AgentModeSelectorProps> = ({
  backend,
  agentName,
  agentLogo,
  agentLogoIsEmoji,
  conversationId,
  compact,
  showLogoInCompact = false,
  compactLabelType = 'mode',
  initialMode,
  onModeSelect,
  compactLabelOverride,
  compactLeadingIcon,
  modeLabelFormatter,
  compactLabelPrefix,
  hideCompactLabelPrefixOnMobile = false,
  onModeChanged,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = Boolean(layout?.isMobile);
  const modes = getAgentModes(backend);
  const defaultMode = DEFAULT_MODE[backend] ?? modes[0]?.value ?? 'default';
  // Validate initialMode against available modes; fall back to backend's default
  // when the provided value doesn't match (e.g. opencode has 'build'/'plan', not 'default')
  const validInitialMode = initialMode && modes.some((m) => m.value === initialMode) ? initialMode : defaultMode;
  const [currentMode, setCurrentMode] = useState<string>(validInitialMode);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  // Pending mode waiting for "真 YOLO" second confirmation. Only set for the
  // Droid SDK backend — other backends route directly through setMode.
  //   null      → modal hidden / no pending YOLO switch
  //   <mode id> → user clicked YOLO but hasn't confirmed skipPermissionsUnsafe yet
  const [pendingYoloMode, setPendingYoloMode] = useState<string | null>(null);
  const [yoloConfirmLoading, setYoloConfirmLoading] = useState(false);
  const isDroidBackend = backend === 'droid';
  const getDisplayModeLabel = useCallback(
    (mode: AgentModeOption) => modeLabelFormatter?.(mode) ?? mode.label,
    [modeLabelFormatter]
  );

  const canSwitchMode = supportsModeSwitch(backend) && (conversationId || onModeSelect);
  // Mobile conversation header agent pill is display-only by design.
  const canInteract = canSwitchMode && !(compact && compactLabelType === 'agent');

  // When initialMode prop changes (e.g. agent switch on Guid page), update local state.
  // Validate against available modes to handle backends with non-standard default
  // (e.g. opencode uses 'build' instead of 'default').
  useEffect(() => {
    if (initialMode !== undefined) {
      const valid = modes.some((m) => m.value === initialMode) ? initialMode : defaultMode;
      setCurrentMode(valid);
    }
  }, [initialMode, modes, defaultMode]);

  // Sync mode from backend when mounting or switching conversation tabs
  useEffect(() => {
    if (!conversationId || !canSwitchMode) return;
    let cancelled = false;

    ipcBridge.acpConversation.getMode
      .invoke({ conversationId })
      .then((result) => {
        if (!cancelled && result.success && result.data) {
          // Only sync from backend when manager is initialized;
          // before first message, getMode returns { mode: 'default', initialized: false }
          // which would overwrite the correct initialMode (e.g. opencode has no 'default').
          if (result.data.initialized !== false) {
            setCurrentMode(result.data.mode);
          }
        }
      })
      .catch(() => {
        // Silent fail, keep current state
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, canSwitchMode]);

  /**
   * Actually performs the backend mode switch (no "真 YOLO" gating — callers
   * must already have confirmed or verified we're not entering YOLO for a
   * Droid backend).
   */
  const applyModeSwitch = useCallback(
    async (mode: string): Promise<boolean> => {
      if (!conversationId) return false;
      setIsLoading(true);
      try {
        const result = await ipcBridge.acpConversation.setMode.invoke({
          conversationId,
          mode,
        });

        if (result.success) {
          const nextMode = result.data?.mode ?? mode;
          setCurrentMode(nextMode);
          onModeChanged?.(nextMode);
          Message.success('Mode switched');
          return true;
        }
        const errorMsg = result.msg || 'Switch failed';
        console.warn('[AgentModeSelector] Mode switch failed:', errorMsg);
        Message.warning(errorMsg);
        return false;
      } catch (error) {
        console.error('[AgentModeSelector] Failed to switch mode:', error);
        Message.error('Switch failed');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, onModeChanged]
  );

  const handleModeChange = useCallback(
    async (mode: string) => {
      // Close dropdown immediately after selection
      setDropdownVisible(false);

      if (mode === currentMode) return;

      // Local mode (Guid page): update state and notify parent, no IPC needed
      if (!conversationId && onModeSelect) {
        setCurrentMode(mode);
        onModeSelect(mode);
        onModeChanged?.(mode);
        return;
      }

      if (!conversationId) return;

      // ── "真 YOLO" 二次确认拦截（仅 Droid 后端）──────────────────────
      // SKILL P0-3 hard rule: entering YOLO for the Droid SDK backend must
      // show an explicit second confirmation before enabling
      // `skipPermissionsUnsafe`. The mode switch itself is deferred until
      // the user confirms in the modal (see confirmYoloAndApplyMode).
      //
      // 离开 YOLO 切到其他模式时：显式地把 skipPermissionsUnsafe 关掉，
      // 避免下次再进 YOLO 时默认开启真 YOLO。
      if (isDroidBackend) {
        if (isYoloModeId(mode)) {
          // Defer the actual setMode until confirm.
          setPendingYoloMode(mode);
          return;
        }
        if (isYoloModeId(currentMode) && !isYoloModeId(mode)) {
          // Leaving YOLO — clear real-YOLO state first (best-effort; ignore
          // any unsupported/not-yet-bootstrapped failures here because the
          // session will re-sync skipPermissionsUnsafe on setMode).
          try {
            await ipcBridge.acpConversation.setSkipPermissionsUnsafe.invoke({
              conversationId,
              confirmed: false,
            });
          } catch (error) {
            console.warn('[AgentModeSelector] Failed to clear skipPermissionsUnsafe on mode leave:', error);
          }
        }
      }

      await applyModeSwitch(mode);
    },
    [applyModeSwitch, conversationId, currentMode, isDroidBackend, onModeSelect, onModeChanged]
  );

  const handleYoloConfirm = useCallback(async () => {
    if (!pendingYoloMode || !conversationId) {
      setPendingYoloMode(null);
      return;
    }
    setYoloConfirmLoading(true);
    try {
      // Flip skipPermissionsUnsafe=true BEFORE the mode switch so that the
      // session, once it transitions into yolo via setMode, already sees the
      // confirmed flag inside getSessionSettingsForMode('yolo'). When the
      // session isn't bootstrapped yet (agent not instantiated), the backend
      // returns success=false with an explicit "not yet available" message —
      // we still proceed with the mode switch and flip the flag again after.
      const skipResult = await ipcBridge.acpConversation.setSkipPermissionsUnsafe.invoke({
        conversationId,
        confirmed: true,
      });
      if (!skipResult.success) {
        console.info(
          '[AgentModeSelector] setSkipPermissionsUnsafe pre-switch returned:',
          skipResult.msg || 'no-op (session not ready)'
        );
      }
      const switched = await applyModeSwitch(pendingYoloMode);
      if (switched) {
        // Best-effort re-apply in case the first call happened before the
        // agent was instantiated. Failures here are silent — the permission
        // policy layer still auto-approves, preserving the prompt-less UX.
        try {
          await ipcBridge.acpConversation.setSkipPermissionsUnsafe.invoke({
            conversationId,
            confirmed: true,
          });
        } catch (error) {
          console.warn('[AgentModeSelector] Post-switch setSkipPermissionsUnsafe re-apply failed:', error);
        }
      }
    } finally {
      setYoloConfirmLoading(false);
      setPendingYoloMode(null);
    }
  }, [applyModeSwitch, conversationId, pendingYoloMode]);

  const handleYoloCancel = useCallback(() => {
    setPendingYoloMode(null);
  }, []);

  // Render logo based on source
  const renderLogo = () => {
    const logoContent = (() => {
      if (agentLogo) {
        if (agentLogoIsEmoji) {
          return <span className='text-14px leading-none'>{agentLogo}</span>;
        }
        return (
          <img src={agentLogo} alt={`${agentName || 'agent'} logo`} className='block w-16px h-16px object-contain' />
        );
      }
      const logo = getAgentLogo(backend);
      if (logo) {
        return <img src={logo} alt={`${backend} logo`} className='block w-16px h-16px object-contain' />;
      }
      return <Robot theme='outline' size={16} fill={iconColors.primary} />;
    })();

    return (
      <span className='inline-flex w-16px h-16px items-center justify-center shrink-0 leading-none'>{logoContent}</span>
    );
  };

  // Get display label for current mode
  const getCurrentModeLabel = () => {
    const modeOption = modes.find((m) => m.value === currentMode);
    return modeOption ? getDisplayModeLabel(modeOption) : '';
  };

  // Dropdown menu (shared between compact and full mode)
  const dropdownMenu = (
    <Menu onClickMenuItem={(key) => void handleModeChange(key)}>
      <Menu.ItemGroup title={t('agentMode.switchMode', { defaultValue: 'Switch Mode' })}>
        {modes.map((mode: AgentModeOption) => (
          <Menu.Item key={mode.value} className={currentMode === mode.value ? '!bg-2' : ''}>
            <div className='flex items-center gap-8px'>
              {currentMode === mode.value && <span className='text-primary'>✓</span>}
              <span className={currentMode !== mode.value ? 'ml-16px' : ''}>{getDisplayModeLabel(mode)}</span>
            </div>
          </Menu.Item>
        ))}
      </Menu.ItemGroup>
    </Menu>
  );

  // Compact mode: render only mode label chip in sendbox area
  if (compact) {
    const legacyCompactBehavior = !showLogoInCompact && compactLabelType === 'mode';
    const baseCompactLabel =
      compactLabelType === 'agent'
        ? agentName || backend || 'Agent'
        : canSwitchMode
          ? getCurrentModeLabel()
          : agentName || backend || 'Agent';
    const compactLabel =
      compactLabelOverride ||
      (compactLabelPrefix && compactLabelType !== 'agent'
        ? hideCompactLabelPrefixOnMobile && isMobile
          ? baseCompactLabel
          : `${compactLabelPrefix} · ${baseCompactLabel}`
        : baseCompactLabel);
    if (!canInteract && legacyCompactBehavior) {
      return null;
    }

    const compactContent = (
      <Button
        className={`sendbox-model-btn agent-mode-compact-pill ${canInteract ? '' : 'agent-mode-compact-pill--readonly'}`}
        shape='round'
        size='small'
        onClick={canInteract ? () => !isLoading && setDropdownVisible((visible) => !visible) : undefined}
        style={{
          opacity: isLoading ? 0.6 : 1,
          transition: 'opacity 0.2s',
          cursor: canInteract ? 'pointer' : 'default',
        }}
      >
        <span className='flex items-center gap-6px min-w-0 leading-none'>
          {compactLeadingIcon && <span className='shrink-0 inline-flex items-center'>{compactLeadingIcon}</span>}
          {showLogoInCompact && <span className='shrink-0 inline-flex items-center'>{renderLogo()}</span>}
          <MarqueePillLabel>{compactLabel}</MarqueePillLabel>
          {canInteract && <Down size={12} className='text-t-tertiary shrink-0' />}
        </span>
      </Button>
    );

    if (!canInteract) {
      return compactContent;
    }

    return (
      <>
        <Dropdown
          trigger='click'
          popupVisible={dropdownVisible}
          onVisibleChange={(visible) => !isLoading && setDropdownVisible(visible)}
          droplist={dropdownMenu}
        >
          {compactContent}
        </Dropdown>
        {isDroidBackend && (
          <SkipPermissionsConfirmModal
            visible={pendingYoloMode !== null}
            loading={yoloConfirmLoading}
            onConfirm={() => void handleYoloConfirm()}
            onCancel={handleYoloCancel}
          />
        )}
      </>
    );
  }

  // Full mode: logo + name + optional mode label
  const content = (
    <div
      className={`flex items-center gap-2 bg-2 w-fit rounded-full px-[8px] py-[2px] ${canSwitchMode ? 'cursor-pointer hover:bg-3' : ''}`}
      style={{ opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.2s' }}
    >
      {renderLogo()}
      <span className='text-sm text-t-primary'>{agentName || backend}</span>
      {canSwitchMode && (
        <>
          {currentMode !== defaultMode && <span className='text-xs text-t-tertiary'>({getCurrentModeLabel()})</span>}
          <Down size={12} className='text-t-tertiary' />
        </>
      )}
    </div>
  );

  // If mode switching is not supported, just render the content without dropdown
  if (!canSwitchMode) {
    return <div className='ml-16px'>{content}</div>;
  }

  // Render dropdown with mode selection menu
  return (
    <div className='ml-16px'>
      <Dropdown
        trigger='click'
        popupVisible={dropdownVisible}
        onVisibleChange={(visible) => !isLoading && setDropdownVisible(visible)}
        droplist={dropdownMenu}
      >
        {content}
      </Dropdown>
      {isDroidBackend && (
        <SkipPermissionsConfirmModal
          visible={pendingYoloMode !== null}
          loading={yoloConfirmLoading}
          onConfirm={() => void handleYoloConfirm()}
          onCancel={handleYoloCancel}
        />
      )}
      {isDroidBackend && conversationId && (
        <AllowedToolsSelector conversationId={conversationId} visible={isDroidBackend} />
      )}
    </div>
  );
};

export default AgentModeSelector;

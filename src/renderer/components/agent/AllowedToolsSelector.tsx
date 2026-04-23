/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * Allowed Tools selector for Droid SDK conversations.
 *
 * Three-state semantics (matching `DroidSdkAgent.setEnabledToolIds`):
 *   - `null`     → Use SDK defaults (clear whitelist)
 *   - `[]`       → Disable ALL tools (strict mode)
 *   - `[id, …]`  → Only allow the listed tool ids
 *
 * Only rendered when `backend === 'droid'`. When invoked for a non-droid
 * backend the IPC returns a structured failure that is surfaced as a
 * localized `Message.error`.
 */

import { ipcBridge } from '@/common';
import { Message, Select } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Predefined presets the user can pick from. */
type ToolPreset = 'default' | 'none' | 'custom';

export interface AllowedToolsSelectorProps {
  /** Current conversation ID (required for the IPC invoke). */
  conversationId: string;
  /** Whether to show the control (must be false for non-droid backends). */
  visible: boolean;
}

/**
 * Compact Select control that lets the user choose the tool availability
 * preset for the current conversation. Rendered inline below the mode
 * dropdown inside `AgentModeSelector` — hidden when `visible === false`.
 */
const AllowedToolsSelector: React.FC<AllowedToolsSelectorProps> = ({ conversationId, visible }) => {
  const { t } = useTranslation('agentMode');
  const [preset, setPreset] = useState<ToolPreset>('default');
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  /** Map the current UI preset + custom ids to the IPC payload shape. */
  const resolveToolIds = useCallback((nextPreset: ToolPreset, nextCustomIds: string[]): string[] | null => {
    switch (nextPreset) {
      case 'default':
        return null;
      case 'none':
        return [];
      case 'custom':
        return nextCustomIds;
    }
  }, []);

  /** Push the new tool whitelist to the backend via IPC. */
  const applyToolIds = useCallback(
    async (toolIds: string[] | null) => {
      setLoading(true);
      try {
        const result = await ipcBridge.acpConversation.setEnabledToolIds.invoke({
          conversationId,
          toolIds,
        });
        if (!result.success) {
          const msg =
            result.msg ||
            t('allowedToolsUnsupported', { defaultValue: 'Tool whitelist is only supported for the Droid backend' });
          Message.error(msg);
        }
      } catch (err) {
        console.error('[AllowedToolsSelector] IPC error:', err);
        Message.error(
          t('allowedToolsUnsupported', { defaultValue: 'Tool whitelist is only supported for the Droid backend' })
        );
      } finally {
        setLoading(false);
      }
    },
    [conversationId, t]
  );

  /** Handle preset change from the Select dropdown. */
  const handlePresetChange = useCallback(
    async (value: ToolPreset) => {
      setPreset(value);
      const toolIds = resolveToolIds(value, customIds);
      await applyToolIds(toolIds);
    },
    [applyToolIds, customIds, resolveToolIds]
  );

  /** Handle custom tool IDs input change. */
  const handleCustomIdsChange = useCallback(
    async (values: string[]) => {
      setCustomIds(values);
      await applyToolIds(values);
    },
    [applyToolIds]
  );

  if (!visible) {
    return null;
  }

  return (
    <div data-testid='allowed-tools-selector' className='flex flex-col gap-4px mt-4px'>
      <span className='text-12px c-text-3'>{t('allowedTools', { defaultValue: 'Allowed Tools' })}</span>
      <Select
        size='mini'
        value={preset}
        loading={loading}
        onChange={(value) => void handlePresetChange(value as ToolPreset)}
        data-testid='allowed-tools-preset'
        style={{ width: 180 }}
      >
        <Select.Option value='default'>{t('allowedToolsDefault', { defaultValue: 'Use SDK Defaults' })}</Select.Option>
        <Select.Option value='none'>{t('allowedToolsNone', { defaultValue: 'Disable All Tools' })}</Select.Option>
        <Select.Option value='custom'>{t('allowedToolsCustom', { defaultValue: 'Custom' })}</Select.Option>
      </Select>
      {preset === 'custom' && (
        <Select
          size='mini'
          mode='multiple'
          allowCreate
          placeholder='tool_id_1, tool_id_2'
          value={customIds}
          onChange={(values) => void handleCustomIdsChange(values as string[])}
          data-testid='allowed-tools-custom-input'
          style={{ width: 180 }}
        />
      )}
    </div>
  );
};

export default AllowedToolsSelector;
